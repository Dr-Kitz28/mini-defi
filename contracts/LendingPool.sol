// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IInterestRateModel} from "./interfaces/IInterestRateModel.sol";

error ZeroAmount();
error InsufficientDeposit();
error BorrowLimitExceeded();
error InsufficientLiquidity();
error NothingToRepay();
error BorrowerHealthy();

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
    IInterestRateModel public irm; // interest rate model

    /// @notice One-time hook for the owner to set the interest rate model
    function setIRM(address _irm) external {
        require(address(irm) == address(0), "irm already set");
        require(_irm != address(0), "irm zero");
        irm = IInterestRateModel(_irm);
    }

    uint256 public totalDeposits; // pool total deposits (value of all shares)
    uint256 public totalBorrows; // pool total borrows (principal only)

    mapping(address => uint256) public shares;
    uint256 public totalShares;

    mapping(address => Borrow) public borrows;
    address[] public borrowers;

    struct Borrow {
        uint256 principal; // what user currently owes as principal
        uint256 timestamp; // last time we updated their loan
    }

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

    constructor(address _asset) {
        asset = IERC20(_asset);
    }

    /// @notice The current utilization of the pool's liquidity
    function utilization() public view returns (uint256) {
        uint256 totalAsset = asset.balanceOf(address(this));
        if (totalAsset == 0) return 0;
        if (totalBorrows > totalAsset) return 1e18;
        return (totalBorrows * 1e18) / totalAsset;
    }

    function availableLiquidity() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function _borrowLimit(address user) internal view returns (uint256) {
        uint256 collateralValue = getAmountForShares(shares[user]);
        return (collateralValue * COLLATERAL_FACTOR) / PRECISION;
    }

    /// max a user can newly borrow now (ignores interest until next action)
    function maxBorrowable(address user) public view returns (uint256) {
        uint256 borrowLimit = _borrowLimit(user);
        uint256 debt = borrows[user].principal;
        if (debt >= borrowLimit) return 0;
        return borrowLimit - debt;
    }

    function deposit(uint256 amount) public {
        if (amount == 0) revert ZeroAmount();
        _accrueAllInterest();
        uint256 newShares = getSharesForAmount(amount);

        totalDeposits += amount;
        totalShares += newShares;
        shares[msg.sender] += newShares;

        asset.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(msg.sender, amount);
    }

    function accrueInterest(address user) public {
        _accrueInterest(user);
    }

    /**
     * @notice Withdraws an amount of the underlying asset.
     * @dev The amount is denominated in the underlying asset. The contract will burn the corresponding number of shares.
     * @param sharesToBurn The number of shares to burn.
     */
    function withdraw(uint256 sharesToBurn) public {
        _accrueAllInterest(); // Accrue all interest before any calculations
        require(shares[msg.sender] >= sharesToBurn, "Insufficient shares");

        uint256 amountToWithdraw = getAmountForShares(sharesToBurn);
        require(availableLiquidity() >= amountToWithdraw, "Insufficient liquidity");

        totalDeposits -= amountToWithdraw;
        shares[msg.sender] -= sharesToBurn;
        totalShares -= sharesToBurn;

        asset.safeTransfer(msg.sender, amountToWithdraw);

        emit Withdraw(msg.sender, amountToWithdraw);
    }

    function withdrawAll() public {
        withdraw(shares[msg.sender]);
    }

    function borrow(uint256 amount) public {
        require(amount > 0, "Amount must be > 0");
        _accrueInterest(msg.sender);

        if (borrows[msg.sender].principal == 0) {
            borrowers.push(msg.sender);
        }

        uint256 maxBorrow = maxBorrowable(msg.sender);
        require(borrows[msg.sender].principal + amount <= maxBorrow, "Exceeds collateral factor");

        if (availableLiquidity() < amount) revert InsufficientLiquidity();

        Borrow storage b = borrows[msg.sender];
        b.principal += amount;
        b.timestamp = block.timestamp;
        totalBorrows += amount;

        asset.safeTransfer(msg.sender, amount);

        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) public {
        // Allow repay(0) to trigger interest accrual without reverting
        if (amount == 0) {
            _accrueInterest(msg.sender);
            return;
        }
        
        uint256 principalBefore = borrows[msg.sender].principal;
        _accrueInterest(msg.sender);

        Borrow storage b = borrows[msg.sender];
        uint256 debt = b.principal; // This now includes interest
        if (debt == 0) revert NothingToRepay();

        uint256 repayAmount = amount > debt ? debt : amount;

        b.principal = debt - repayAmount;
        if (b.principal == 0) {
            b.timestamp = 0;
        } else {
            b.timestamp = block.timestamp;
        }

        uint256 interestPaid = debt - principalBefore;
        uint256 principalPaid = repayAmount > interestPaid ? repayAmount - interestPaid : 0;

        totalBorrows -= principalPaid;

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

    function liquidate(address user, uint256 amount) public {
        if (amount == 0) revert ZeroAmount();

        _accrueInterest(user);

        Borrow storage b = borrows[user];
        uint256 debt = b.principal;
        if (debt == 0) revert NothingToRepay();

        if (isHealthy(user)) revert BorrowerHealthy();

        uint256 actualRepay = amount > debt ? debt : amount;

        // Seize collateral
        uint256 seizeAmount = (actualRepay * LIQUIDATION_BONUS) / PRECISION;
        uint256 seizeShares = getSharesForAmount(seizeAmount);
        uint256 borrowerShares = shares[user];
        if (seizeShares > borrowerShares) {
            seizeShares = borrowerShares;
        }
        shares[user] -= seizeShares;
        shares[msg.sender] += seizeShares;

        emit Liquidated(
            msg.sender,
            user,
            actualRepay,
            getAmountForShares(seizeShares)
        );
    }

    // ===== Internal =====

    function _accrueAllInterest() internal {
        for (uint i = 0; i < borrowers.length; i++) {
            address borrower = borrowers[i];
            if (borrows[borrower].principal > 0) {
                _accrueInterest(borrower);
            }
        }
    }

    function _accrueInterest(address user) internal {
        if (borrows[user].principal == 0) {
            return;
        }

        uint256 elapsed = block.timestamp - borrows[user].timestamp;
        if (elapsed == 0) return;

        uint256 currentRate;
        try irm.updateBorrowRate(this.utilization()) {
            // The update function in the default IRM does not return a value.
            // We just need to trigger it. After it runs, the new rate is in its `currentAPR` state.
        } catch {
            // If the call fails for some reason, we can just proceed with the last known rate.
        }
        currentRate = irm.getBorrowRatePerSecond(this.utilization());

        uint256 interest = (borrows[user].principal * currentRate * elapsed) / PRECISION;
        if (interest > 0) {
            borrows[user].principal += interest;
            totalBorrows += interest;
            totalDeposits += interest; // Interest earned increases the value of all deposits
            borrows[user].timestamp = block.timestamp;
            emit InterestAccrued(user, interest);
        }
    }

    function isHealthy(address user) public returns (bool) {
        _accrueAllInterest(); // Accrue all interest to get the latest collateral value
        uint256 borrowLimit = _borrowLimit(user);
        return borrows[user].principal <= borrowLimit;
    }

    function getAmountForShares(uint256 _shares) public view returns (uint256) {
        if (totalShares == 0) {
            return 0;
        }
        // Use rounding to prevent precision errors
        return (_shares * totalDeposits + (totalShares / 2)) / totalShares;
    }

    function getSharesForAmount(uint256 amount) public view returns (uint256) {
        if (totalDeposits == 0 || totalShares == 0) {
            return amount; // 1:1 for first deposit
        }
        // Use rounding to prevent precision errors
        return (amount * totalShares + (totalDeposits / 2)) / totalDeposits;
    }
}
