// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IInterestRateModel} from "./interfaces/IInterestRateModel.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

error AssetNotListed();
error InsufficientCollateral();
error InsufficientLiquidity();
error LiquidationNotPossible();
error ZeroAddress();
error AssetAlreadyListed();
error ZeroAmount();

/// @title Multi-Asset Lending Pool
/// @notice A lending pool that supports multiple assets, cross-collateral borrowing, and isolated asset configurations.
contract LendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    uint256 private constant PRECISION = 1e18;

    /// @notice Configuration for each listed asset.
    struct AssetConfig {
        address assetAddress;
        address irmAddress;
        uint256 collateralFactor; // e.g., 75e16 for 75%
        uint256 liquidationBonus; // e.g., 5e16 for 5%
        bool isActive;
    }

    /// @notice Per-user accounting for a specific asset.
    struct UserAssetAccount {
        uint256 shares; // Number of shares representing the user's deposit
        uint256 borrowPrincipal;
        uint256 borrowIndex;
    }

    /// @notice Per-asset accounting for the entire pool.
    struct PoolAssetAccount {
        uint256 totalShares;
        uint256 totalBorrows;
        uint256 borrowIndex;
        uint256 lastInterestAccruedTimestamp;
        uint256 totalReserves;
    }

    IPriceOracle public priceOracle;

    mapping(address => AssetConfig) public assetConfigs;
    address[] public listedAssets;

    mapping(address => mapping(address => UserAssetAccount)) public userAccounts; // user => asset => account
    mapping(address => PoolAssetAccount) public poolAccounts; // asset => account

    event AssetListed(address indexed asset, address irm, uint256 collateralFactor, uint256 liquidationBonus);
    event AssetConfigUpdated(address indexed asset, uint256 collateralFactor, uint256 liquidationBonus);
    event PriceOracleUpdated(address indexed newOracle);
    event Deposit(address indexed user, address indexed asset, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, address indexed asset, uint256 amount, uint256 shares);
    event Borrow(address indexed user, address indexed asset, uint256 amount);
    event Repay(address indexed user, address indexed asset, uint256 amount);
    event Liquidate(
        address indexed liquidator,
        address indexed borrower,
        address indexed collateralAsset,
        address borrowAsset, // Removed indexed
        uint256 repayAmount,
        uint256 seizedAmount
    );

    constructor(address _priceOracle, address admin) Ownable(admin) {
        if (_priceOracle == address(0)) revert ZeroAddress();
        priceOracle = IPriceOracle(_priceOracle);
    }

    // --- Admin Functions ---

    function setPriceOracle(address _newOracle) external onlyOwner {
        if (_newOracle == address(0)) revert ZeroAddress();
        priceOracle = IPriceOracle(_newOracle);
        emit PriceOracleUpdated(_newOracle);
    }

    function listAsset(
        address _asset,
        address _irm,
        uint256 _collateralFactor,
        uint256 _liquidationBonus
    ) external onlyOwner {
        if (assetConfigs[_asset].isActive) revert AssetAlreadyListed();
        if (_asset == address(0) || _irm == address(0)) revert ZeroAddress();

        assetConfigs[_asset] = AssetConfig({
            assetAddress: _asset,
            irmAddress: _irm,
            collateralFactor: _collateralFactor,
            liquidationBonus: _liquidationBonus,
            isActive: true
        });
        listedAssets.push(_asset);

        emit AssetListed(_asset, _irm, _collateralFactor, _liquidationBonus);
    }

    function updateAssetConfig(
        address _asset,
        uint256 _collateralFactor,
        uint256 _liquidationBonus
    ) external onlyOwner {
        if (!assetConfigs[_asset].isActive) revert AssetNotListed();
        assetConfigs[_asset].collateralFactor = _collateralFactor;
        assetConfigs[_asset].liquidationBonus = _liquidationBonus;
        emit AssetConfigUpdated(_asset, _collateralFactor, _liquidationBonus);
    }

    // --- User Functions ---

    function deposit(address _asset, uint256 _amount) external nonReentrant {
        if (!assetConfigs[_asset].isActive) revert AssetNotListed();
        if (_amount == 0) revert ZeroAmount();

        _accrueInterest(_asset);

        UserAssetAccount storage userAccount = userAccounts[msg.sender][_asset];
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];

        uint256 shares = _getSharesForAmount(_asset, _amount);
        userAccount.shares += shares;
        poolAccount.totalShares += shares;

        IERC20Metadata(_asset).safeTransferFrom(msg.sender, address(this), _amount);
        emit Deposit(msg.sender, _asset, _amount, shares);
    }

    function withdraw(address _asset, uint256 _shares) external nonReentrant {
        if (!assetConfigs[_asset].isActive) revert AssetNotListed();
        if (_shares == 0) revert ZeroAmount();

        _accrueInterest(_asset);

        UserAssetAccount storage userAccount = userAccounts[msg.sender][_asset];
        if (userAccount.shares < _shares) revert InsufficientCollateral();

        uint256 amount = _getAmountForShares(_asset, _shares);
        
        (, uint256 totalBorrowValue) = _getAccountLiquidity(msg.sender);
        uint256 collateralValueAfter = _getCollateralValue(msg.sender, _asset, userAccount.shares - _shares);
        
        if (totalBorrowValue > collateralValueAfter) revert InsufficientCollateral();

        userAccount.shares -= _shares;
        poolAccounts[_asset].totalShares -= _shares;

        // The external call is made AFTER the state change.
        IERC20Metadata(_asset).safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, _asset, amount, _shares);
    }

    function borrow(address _asset, uint256 _amount) external nonReentrant {
        if (!assetConfigs[_asset].isActive) revert AssetNotListed();

        _accrueInterest(_asset);

        if (_amount == 0) {
            // Allow zero-amount borrows to trigger interest accrual without further checks
            return;
        }

        (uint256 totalCollateralValue, uint256 totalBorrowValue) = _getAccountLiquidity(msg.sender);
        uint256 assetPrice = priceOracle.getPrice(_asset);
        uint256 borrowValue = (_amount * assetPrice) / (10 ** IERC20Metadata(_asset).decimals());

        if (totalBorrowValue + borrowValue > totalCollateralValue) revert InsufficientCollateral();
        if (IERC20Metadata(_asset).balanceOf(address(this)) < _amount) revert InsufficientLiquidity();

        UserAssetAccount storage userAccount = userAccounts[msg.sender][_asset];
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];

        uint256 previousDebt = (userAccount.borrowPrincipal * poolAccount.borrowIndex) / (userAccount.borrowIndex > 0 ? userAccount.borrowIndex : PRECISION);
        userAccount.borrowPrincipal = previousDebt + _amount;
        userAccount.borrowIndex = poolAccount.borrowIndex > 0 ? poolAccount.borrowIndex : PRECISION;
        poolAccount.totalBorrows += _amount;

        SafeERC20.safeTransfer(IERC20Metadata(_asset), msg.sender, _amount);
        emit Borrow(msg.sender, _asset, _amount);
    }

    function repay(address _asset, uint256 _amount) external nonReentrant {
        if (!assetConfigs[_asset].isActive) revert AssetNotListed();
        if (_amount == 0) revert ZeroAmount();

        _accrueInterest(_asset);

        UserAssetAccount storage userAccount = userAccounts[msg.sender][_asset];
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];

        uint256 totalDebt = (userAccount.borrowPrincipal * poolAccount.borrowIndex) / (userAccount.borrowIndex > 0 ? userAccount.borrowIndex : PRECISION);
        uint256 repayAmount = _amount >= totalDebt ? totalDebt : _amount;

        userAccount.borrowPrincipal = totalDebt - repayAmount;
        if (userAccount.borrowPrincipal == 0) {
            userAccount.borrowIndex = 0;
        } else {
            userAccount.borrowIndex = poolAccount.borrowIndex > 0 ? poolAccount.borrowIndex : PRECISION;
        }
        poolAccount.totalBorrows -= repayAmount;

        SafeERC20.safeTransferFrom(IERC20Metadata(_asset), msg.sender, address(this), repayAmount);
        emit Repay(msg.sender, _asset, repayAmount);
    }

    function liquidate(address _borrower, address _borrowAsset, address _collateralAsset, uint256 _repayAmount) external nonReentrant {
        _validateLiquidationPrerequisites(_borrower, _borrowAsset, _collateralAsset);

        (uint256 repayAmount, uint256 seizedShares) = _calculateLiquidationAmounts(
            _borrower,
            _borrowAsset,
            _collateralAsset,
            _repayAmount
        );

        _performLiquidation(
            msg.sender,
            _borrower,
            _borrowAsset,
            _collateralAsset,
            repayAmount,
            seizedShares
        );
    }

    function _validateLiquidationPrerequisites(address _borrower, address _borrowAsset, address _collateralAsset) internal {
        if (!assetConfigs[_borrowAsset].isActive || !assetConfigs[_collateralAsset].isActive) revert AssetNotListed();

        _accrueInterest(_borrowAsset);
        _accrueInterest(_collateralAsset);

        (uint256 totalCollateralValue, uint256 totalBorrowValue) = _getAccountLiquidity(_borrower);
        if (totalBorrowValue == 0 || totalCollateralValue >= totalBorrowValue) revert LiquidationNotPossible();
    }

    function _calculateLiquidationAmounts(
        address _borrower,
        address _borrowAsset,
        address _collateralAsset,
        uint256 _repayAmount
    ) internal view returns (uint256 repayAmount, uint256 seizedShares) {
        UserAssetAccount storage borrowerBorrowAcc = userAccounts[_borrower][_borrowAsset];
        PoolAssetAccount storage poolAccount = poolAccounts[_borrowAsset];
        uint256 totalDebt = (borrowerBorrowAcc.borrowPrincipal * poolAccount.borrowIndex) / (borrowerBorrowAcc.borrowIndex > 0 ? borrowerBorrowAcc.borrowIndex : PRECISION);
        
        // Allow liquidating the full debt by passing max uint
        if (_repayAmount == type(uint256).max) {
            repayAmount = totalDebt;
        } else {
            repayAmount = _repayAmount > totalDebt ? totalDebt : _repayAmount;
        }

        uint256 borrowAssetPrice = priceOracle.getPrice(_borrowAsset);
        uint256 collateralAssetPrice = priceOracle.getPrice(_collateralAsset);

        // The value of collateral to be seized is the value of debt repaid plus a bonus
        uint256 seizedValue = (repayAmount * borrowAssetPrice * (PRECISION + assetConfigs[_borrowAsset].liquidationBonus)) / (collateralAssetPrice * PRECISION);
        uint256 seizedAmount = (seizedValue * (10 ** IERC20Metadata(_collateralAsset).decimals())) / (10**18);
        
        seizedShares = _getSharesForAmount(_collateralAsset, seizedAmount);
        
        UserAssetAccount storage borrowerCollateralAcc = userAccounts[_borrower][_collateralAsset];
        if (seizedShares > borrowerCollateralAcc.shares) {
            seizedShares = borrowerCollateralAcc.shares;
        }
    }

    function _performLiquidation(
        address _liquidator,
        address _borrower,
        address _borrowAsset,
        address _collateralAsset,
        uint256 _repayAmount,
        uint256 _seizedShares
    ) internal {
        // Seize collateral
        userAccounts[_borrower][_collateralAsset].shares -= _seizedShares;
        userAccounts[_liquidator][_collateralAsset].shares += _seizedShares;

        // Repay borrow
        UserAssetAccount storage borrowerBorrowAcc = userAccounts[_borrower][_borrowAsset];
        PoolAssetAccount storage poolAccount = poolAccounts[_borrowAsset];
        
        uint256 totalDebt = (borrowerBorrowAcc.borrowPrincipal * poolAccount.borrowIndex) / (borrowerBorrowAcc.borrowIndex > 0 ? borrowerBorrowAcc.borrowIndex : PRECISION);
        borrowerBorrowAcc.borrowPrincipal = totalDebt - _repayAmount;
        if (borrowerBorrowAcc.borrowPrincipal == 0) {
            borrowerBorrowAcc.borrowIndex = 0;
        } else {
            borrowerBorrowAcc.borrowIndex = poolAccount.borrowIndex > 0 ? poolAccount.borrowIndex : PRECISION;
        }
        poolAccount.totalBorrows -= _repayAmount;

        SafeERC20.safeTransferFrom(IERC20Metadata(_borrowAsset), _liquidator, address(this), _repayAmount);

        uint256 seizedAmount = _getAmountForShares(_collateralAsset, _seizedShares);
        emit Liquidate(_liquidator, _borrower, _collateralAsset, _borrowAsset, _repayAmount, seizedAmount);
    }

    function getAccountLiquidity(address _user)
        public
        view
        returns (uint256 totalCollateralValue, uint256 totalBorrowValue)
    {
        return _getAccountLiquidity(_user);
    }

    function getAmountForShares(address _asset, uint256 _shares) public view returns (uint256) {
        return _getAmountForShares(_asset, _shares);
    }

    function getTotalDebt(address _asset, address _user) public view returns (uint256) {
        UserAssetAccount memory userAccount = userAccounts[_user][_asset];
        if (userAccount.borrowPrincipal == 0) {
            return 0;
        }
        PoolAssetAccount memory poolAccount = poolAccounts[_asset];
        // This function reads the state as of the last accrual.
        // For up-to-the-second debt, accrueInterest must be called first by a state-changing transaction.
        return (userAccount.borrowPrincipal * poolAccount.borrowIndex) / (userAccount.borrowIndex > 0 ? userAccount.borrowIndex : PRECISION);
    }

    // --- Internal Functions ---

    function _accrueInterest(address _asset) internal {
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];
        uint256 lastTimestamp = poolAccount.lastInterestAccruedTimestamp;
        if (lastTimestamp == 0) { // Handle first interaction
            poolAccount.lastInterestAccruedTimestamp = block.timestamp;
            poolAccount.borrowIndex = PRECISION; // Initialize borrow index
            return;
        }

        uint256 elapsed = block.timestamp - lastTimestamp;
        if (elapsed == 0 || poolAccount.totalBorrows == 0) {
            return;
        }

        uint256 totalDeposits = _getAmountForShares(_asset, poolAccount.totalShares);
        uint256 utilization = totalDeposits == 0 ? 0 : (poolAccount.totalBorrows * PRECISION) / totalDeposits;

        IInterestRateModel irm = IInterestRateModel(assetConfigs[_asset].irmAddress);
        uint256 borrowRatePerSecond = irm.getBorrowRatePerSecond(utilization);

        uint256 interest = (poolAccount.totalBorrows * borrowRatePerSecond * elapsed) / PRECISION;
        poolAccount.totalBorrows += interest;
        poolAccount.borrowIndex = poolAccount.borrowIndex * (PRECISION + (borrowRatePerSecond * elapsed)) / PRECISION;
        poolAccount.lastInterestAccruedTimestamp = block.timestamp;
    }

    function _getAccountLiquidity(address _user)
        internal
        view
        returns (uint256 totalCollateralValue, uint256 totalBorrowValue)
    {
        uint256 assetsLength = listedAssets.length;
        for (uint i = 0; i < assetsLength; i++) {
            address assetAddr = listedAssets[i];
            AssetConfig memory config = assetConfigs[assetAddr];
            UserAssetAccount memory userAccount = userAccounts[_user][assetAddr];

            // Calculate collateral value
            if (userAccount.shares > 0) {
                uint256 amount = _getAmountForShares(assetAddr, userAccount.shares);
                uint256 price = priceOracle.getPrice(assetAddr);
                uint256 value = (amount * price) / (10 ** IERC20Metadata(assetAddr).decimals());
                totalCollateralValue += (value * config.collateralFactor) / PRECISION;
            }

            // Calculate borrow value
            if (userAccount.borrowPrincipal > 0) {
                PoolAssetAccount memory poolAccount = poolAccounts[assetAddr];
                uint256 borrowAmount = (userAccount.borrowPrincipal * poolAccount.borrowIndex) / (userAccount.borrowIndex > 0 ? userAccount.borrowIndex : PRECISION);
                uint256 price = priceOracle.getPrice(assetAddr);
                uint256 value = (borrowAmount * price) / (10 ** IERC20Metadata(assetAddr).decimals());
                totalBorrowValue += value;
            }
        }
    }
    
    function _getCollateralValue(address /*_user*/, address _asset, uint256 _shares) internal view returns (uint256) {
        AssetConfig storage config = assetConfigs[_asset];
        uint256 amount = _getAmountForShares(_asset, _shares);
        uint256 price = priceOracle.getPrice(_asset);
        return (amount * price * config.collateralFactor) / (PRECISION * (10 ** IERC20Metadata(_asset).decimals()));
    }

    function _getAmountForShares(address _asset, uint256 _shares) internal view returns (uint256) {
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];
        uint256 totalDeposits = IERC20Metadata(_asset).balanceOf(address(this)) + poolAccount.totalBorrows - poolAccount.totalReserves;
        if (poolAccount.totalShares == 0) return _shares; // 1:1 for first deposit
        return (_shares * totalDeposits) / poolAccount.totalShares;
    }

    function accrueInterest(address _asset) external {
        _accrueInterest(_asset);
    }

    function _getSharesForAmount(address _asset, uint256 _amount) internal view returns (uint256) {
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];
        uint256 totalDeposits = IERC20Metadata(_asset).balanceOf(address(this)) + poolAccount.totalBorrows - poolAccount.totalReserves;
        if (totalDeposits == 0) return _amount; // 1:1 for first deposit
        return (_amount * poolAccount.totalShares) / totalDeposits;
    }
}
