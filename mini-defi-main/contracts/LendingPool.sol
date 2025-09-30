// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IInterestRateModel} from "./interfaces/IInterestRateModel.sol";

/// @notice Minimal single-asset lending pool with super-simplified accounting.
/// Users:
/// - deposit(asset)
/// - withdraw(asset)
/// - borrow(asset) up to 66.66% of their deposits (150% collateral requirement)
/// - repay(asset)
/// Interest:
/// - Linear simple interest on each borrower since their last action.
contract LendingPool {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant COLLATERAL_FACTOR = 666666666666666667; // 66.6666%
    uint256 private constant LIQUIDATION_BONUS = 1050000000000000000; // 1.05x seize incentive

    IERC20 public immutable asset; // single ERC20 asset
    IInterestRateModel public immutable irm; // interest rate model

    uint256 public totalDeposits; // pool total deposits
    uint256 public totalBorrows; // pool total borrows (principal only)
    uint256 public totalShares; // total shares issued for deposited collateral

    mapping(address => uint256) public deposits; // user deposit balance
    mapping(address => uint256) public shares; // user shares balance

    struct Borrow {
        uint256 principal; // what user currently owes as principal
        uint256 timestamp; // last time we updated their loan
    }
    mapping(address => Borrow) public borrows;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event InterestAccrued(address indexed user, uint256 interest);
    event Liquidated(
        address indexed liquidator,
        address indexed borrower,
        uint256 repaidAmount,
        uint256 collateralSeized
    );

        error ZeroAmount();
        error InsufficientDeposit();
        error InsufficientLiquidity();
        error BorrowLimitExceeded();
        error BorrowerHealthy();
        error NothingToRepay();

    constructor(address _asset, address _irm) {
        asset = IERC20(_asset);
        irm = IInterestRateModel(_irm);
    }

    // ===== View helpers =====

    function getSharesForAmount(uint256 amount) public view returns (uint256) {
        if (totalDeposits == 0) {
            return amount;
        }
        return (amount * totalShares) / totalDeposits;
    }

    function getAmountForShares(uint256 _shares) public view returns (uint256) {
        if (totalShares == 0) {
            return _shares;
        }
        return (_shares * totalDeposits) / totalShares;
    }

    function utilization() public view returns (uint256) {
        uint256 totalAsset = asset.balanceOf(address(this));
        if (totalAsset == 0) return 0;
        if (totalBorrows > totalAsset) return 1e18;
        return (totalBorrows * 1e18) / totalAsset;
    }

    function availableLiquidity() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// max a user can newly borrow now (ignores interest until next action)
    function maxBorrowable(address user) public view returns (uint256) {
        uint256 collateralValue = deposits[user];
        uint256 borrowLimit = (collateralValue * COLLATERAL_FACTOR) / PRECISION;
        uint256 debt = currentDebt(user);
        if (debt >= borrowLimit) return 0;
        return borrowLimit - debt;
    }

    function currentDebt(address user) public view returns (uint256) {
        Borrow memory b = borrows[user];
        if (b.principal == 0) return 0;

        uint256 elapsed = block.timestamp - b.timestamp;
        if (elapsed == 0) return b.principal;

        uint256 ratePerSecond = irm.getBorrowRatePerSecond(utilization());
        uint256 interest = (b.principal * ratePerSecond * elapsed) / PRECISION;
        return b.principal + interest;
    }

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 newShares = getSharesForAmount(amount);

        totalDeposits += amount;
        totalShares += newShares;
        deposits[msg.sender] += amount;
        shares[msg.sender] += newShares;

        asset.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 userDeposit = deposits[msg.sender];
        if (userDeposit < amount) revert InsufficientDeposit();

        uint256 newDepositBalance = userDeposit - amount;

        if (!isHealthy(msg.sender)) revert BorrowLimitExceeded();

        uint256 sharesToBurn = getSharesForAmount(amount);

        deposits[msg.sender] = newDepositBalance;
        totalDeposits -= amount;
        shares[msg.sender] -= sharesToBurn;
        totalShares -= sharesToBurn;

        asset.safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        _accrueInterest(msg.sender);

        Borrow storage b = borrows[msg.sender];
        uint256 newDebt = b.principal + amount;

        uint256 collateralValue = deposits[msg.sender];
        uint256 borrowLimit = (collateralValue * COLLATERAL_FACTOR) / PRECISION;
        if (newDebt > borrowLimit) revert BorrowLimitExceeded();

        if (availableLiquidity() < amount) revert InsufficientLiquidity();

        b.principal = newDebt;
        b.timestamp = block.timestamp;
        totalBorrows += amount;

        asset.safeTransfer(msg.sender, amount);

        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 principalBefore = borrows[msg.sender].principal;
        _accrueInterest(msg.sender);

        Borrow storage b = borrows[msg.sender];
        uint256 debt = b.principal;
        if (debt == 0) revert NothingToRepay();

        uint256 repayAmount = amount > debt ? debt : amount;

        b.principal = debt - repayAmount;
        if (b.principal == 0) {
            b.timestamp = 0;
        } else {
            b.timestamp = block.timestamp;
        }

        uint256 principalRepaid = principalBefore - b.principal;
        totalBorrows -= principalRepaid;

        asset.safeTransferFrom(msg.sender, address(this), repayAmount);

        emit Repaid(msg.sender, repayAmount);
    }

    function repayAll() external {
        _accrueInterest(msg.sender);

        Borrow storage b = borrows[msg.sender];
        uint256 debt = b.principal;
        if (debt == 0) revert NothingToRepay();

        b.principal = 0;
        b.timestamp = 0;

        totalBorrows -= debt;

        asset.safeTransferFrom(msg.sender, address(this), debt);

        emit Repaid(msg.sender, debt);
    }

    function liquidate(address borrower, uint256 repayAmount) external {
        if (repayAmount == 0) revert ZeroAmount();

        _accrueInterest(borrower);

        Borrow storage b = borrows[borrower];
        uint256 debt = b.principal;
        if (debt == 0) revert NothingToRepay();

        if (isHealthy(borrower)) revert BorrowerHealthy();

        uint256 actualRepay = repayAmount > debt ? debt : repayAmount;

        // Seize collateral
        uint256 seizeShares = (actualRepay * LIQUIDATION_BONUS) / PRECISION;
        uint256 borrowerShares = shares[borrower];
        if (seizeShares > borrowerShares) {
            seizeShares = borrowerShares;
        }
        uint256 seizeAmount = getAmountForShares(seizeShares);


        b.principal = debt - actualRepay;
        if (b.principal == 0) {
            b.timestamp = 0;
        } else {
            b.timestamp = block.timestamp;
        }
        totalBorrows -= actualRepay;

        shares[borrower] -= seizeShares;
        totalShares -= seizeShares;
        deposits[borrower] -= seizeAmount;
        totalDeposits -= seizeAmount;


        asset.safeTransferFrom(msg.sender, address(this), actualRepay);
        asset.safeTransfer(msg.sender, seizeAmount);

        emit Liquidated(msg.sender, borrower, actualRepay, seizeAmount);
    }

    // ===== Internal =====

    function _accrueInterest(address user) internal {
        Borrow storage b = borrows[user];
        if (b.principal == 0) return;

        uint256 elapsed = block.timestamp - b.timestamp;
        if (elapsed == 0) return;

        uint256 ratePerSecond = irm.getBorrowRatePerSecond(utilization());
        uint256 interest = (b.principal * ratePerSecond * elapsed) / PRECISION;

        if (interest > 0) {
            b.principal += interest;
            emit InterestAccrued(user, interest);
        }
        // always update timestamp
        b.timestamp = block.timestamp;
    }

    function isHealthy(address user) public view returns (bool) {
        uint256 debt = currentDebt(user);
        if (debt == 0) return true;

        uint256 collateralValue = deposits[user];
        uint256 borrowLimit = (collateralValue * COLLATERAL_FACTOR) / PRECISION;
        return debt <= borrowLimit;
    }
}
