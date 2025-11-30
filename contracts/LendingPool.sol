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

contract LendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    uint256 private constant PRECISION = 1e18;

    struct AssetConfig {
        address assetAddress;
        address irmAddress;
        uint256 collateralFactor;
        uint256 liquidationBonus;
        bool isActive;
    }

    struct UserAssetAccount {
        uint256 shares;
        uint256 borrowPrincipal;
        uint256 borrowIndex;
    }

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

    mapping(address => mapping(address => UserAssetAccount)) public userAccounts;
    mapping(address => PoolAssetAccount) public poolAccounts;

    event AssetListed(address indexed asset, address irm, uint256 collateralFactor, uint256 liquidationBonus);
    event AssetConfigUpdated(address indexed asset, uint256 collateralFactor, uint256 liquidationBonus);
    event PriceOracleUpdated(address indexed newOracle);
    event Deposit(address indexed user, address indexed asset, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, address indexed asset, uint256 amount, uint256 shares);
    event Borrow(address indexed user, address indexed asset, uint256 amount);
    event Repay(address indexed user, address indexed asset, uint256 amount);
    event Liquidate(address indexed liquidator, address indexed borrower, address indexed collateralAsset, address borrowAsset, uint256 repayAmount, uint256 seizedAmount);

    constructor(address _priceOracle, address admin) Ownable(admin) {
        if (_priceOracle == address(0)) revert ZeroAddress();
        priceOracle = IPriceOracle(_priceOracle);
    }

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

    // ------- USER ACTIONS ------- //

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

        IERC20Metadata(_asset).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, _asset, amount, _shares);
    }

    function borrow(address _asset, uint256 _amount) external nonReentrant {
        if (!assetConfigs[_asset].isActive) revert AssetNotListed();

        _accrueInterest(_asset);

        if (_amount == 0) return;

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

        IERC20Metadata(_asset).safeTransfer(msg.sender, _amount);
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
        userAccount.borrowIndex = userAccount.borrowPrincipal == 0 ? 0 : poolAccount.borrowIndex;
        poolAccount.totalBorrows -= repayAmount;

        IERC20Metadata(_asset).safeTransferFrom(msg.sender, address(this), repayAmount);
        emit Repay(msg.sender, _asset, repayAmount);
    }

    // -------- INTERNAL HELPERS -------- //

    function _accrueInterest(address _asset) internal {
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];
        uint256 lastTimestamp = poolAccount.lastInterestAccruedTimestamp;
        if (lastTimestamp == 0) {
            poolAccount.lastInterestAccruedTimestamp = block.timestamp;
            poolAccount.borrowIndex = PRECISION;
            return;
        }

        uint256 elapsed = block.timestamp - lastTimestamp;
        if (elapsed == 0 || poolAccount.totalBorrows == 0) return;

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
            UserAssetAccount memory userAcc = userAccounts[_user][assetAddr];

            if (userAcc.shares > 0) {
                uint256 amount = _getAmountForShares(assetAddr, userAcc.shares);
                uint256 price = priceOracle.getPrice(assetAddr);
                uint256 value = (amount * price) / (10 ** IERC20Metadata(assetAddr).decimals());
                totalCollateralValue += (value * config.collateralFactor) / PRECISION;
            }

            if (userAcc.borrowPrincipal > 0) {
                PoolAssetAccount memory poolAcc = poolAccounts[assetAddr];
                uint256 borrowAmt = (userAcc.borrowPrincipal * poolAcc.borrowIndex) / (userAcc.borrowIndex > 0 ? userAcc.borrowIndex : PRECISION);
                uint256 price = priceOracle.getPrice(assetAddr);
                uint256 value = (borrowAmt * price) / (10 ** IERC20Metadata(assetAddr).decimals());
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
        if (poolAccount.totalShares == 0) return _shares;
        return (_shares * totalDeposits) / poolAccount.totalShares;
    }

    function _getSharesForAmount(address _asset, uint256 _amount) internal view returns (uint256) {
        PoolAssetAccount storage poolAccount = poolAccounts[_asset];
        uint256 totalDeposits = IERC20Metadata(_asset).balanceOf(address(this)) + poolAccount.totalBorrows - poolAccount.totalReserves;
        if (totalDeposits == 0) return _amount;
        return (_amount * poolAccount.totalShares) / totalDeposits;
    }

    // -------- VIEW FUNCTIONS FOR FRONTEND ------- //

    function userDeposits(address _user, address _asset) external view returns (uint256 amount) {
        amount = _getAmountForShares(_asset, userAccounts[_user][_asset].shares);
    }

    function userBorrows(address _user, address _asset) external view returns (uint256 debtAmount) {
        UserAssetAccount memory user = userAccounts[_user][_asset];
        PoolAssetAccount memory pool = poolAccounts[_asset];
        if (user.borrowPrincipal == 0) return 0;
        debtAmount = (user.borrowPrincipal * pool.borrowIndex) / (user.borrowIndex > 0 ? user.borrowIndex : PRECISION);
    }

    function getHealthFactor(address _user) external view returns (uint256 healthFactor) {
        (uint256 collateral, uint256 debt) = _getAccountLiquidity(_user);
        if (debt == 0) return type(uint256).max;
        healthFactor = (collateral * PRECISION) / debt;
    }

    function assetData(address _asset)
        external
        view
        returns (
            uint256 totalShares,
            uint256 totalBorrows,
            uint256 borrowIndex,
            uint256 lastInterestAccruedTimestamp,
            bool isActive
        )
    {
        PoolAssetAccount memory pool = poolAccounts[_asset];
        AssetConfig memory config = assetConfigs[_asset];
        return (pool.totalShares, pool.totalBorrows, pool.borrowIndex, pool.lastInterestAccruedTimestamp, config.isActive);
    }

    function calculateInterestOwed(address _asset, address _user) external view returns (uint256 interest) {
        UserAssetAccount memory user = userAccounts[_user][_asset];
        PoolAssetAccount memory pool = poolAccounts[_asset];

        if (user.borrowPrincipal == 0) return 0;
        uint256 updatedDebt = (user.borrowPrincipal * pool.borrowIndex) / (user.borrowIndex > 0 ? user.borrowIndex : PRECISION);

        interest = updatedDebt - user.borrowPrincipal;
    }

        // -------- PUBLIC TEST-COMPATIBLE EXTERNALS ------- //

    /// @notice Public wrapper for accruing interest on a specific asset
    function accrueInterest(address _asset) external {
        _accrueInterest(_asset);
    }

    /// @notice Helper to fetch the total current debt of a user for an asset
    function getTotalDebt(address _user, address _asset) external view returns (uint256) {
        UserAssetAccount memory user = userAccounts[_user][_asset];
        PoolAssetAccount memory pool = poolAccounts[_asset];

        if (user.borrowPrincipal == 0) return 0;
        return (user.borrowPrincipal * pool.borrowIndex) / 
            (user.borrowIndex > 0 ? user.borrowIndex : PRECISION);
    }

    /// @notice Liquidates unhealthy positions assuming asset = collateral
    function liquidate(address _borrower, address _asset, uint256 _repayAmount) external nonReentrant {
        if (!assetConfigs[_asset].isActive) revert AssetNotListed();
        if (_repayAmount == 0) revert ZeroAmount();

        _accrueInterest(_asset);

        (uint256 collateralValue, uint256 debtValue) = _getAccountLiquidity(_borrower);
        if (collateralValue >= debtValue) revert LiquidationNotPossible();

        UserAssetAccount storage userAcc = userAccounts[_borrower][_asset];
        PoolAssetAccount storage poolAcc = poolAccounts[_asset];

        uint256 totalDebt = (userAcc.borrowPrincipal * poolAcc.borrowIndex) /
            (userAcc.borrowIndex > 0 ? userAcc.borrowIndex : PRECISION);

        uint256 repayAmount = _repayAmount >= totalDebt ? totalDebt : _repayAmount;

        IERC20Metadata(_asset).safeTransferFrom(msg.sender, address(this), repayAmount);

        uint256 seizedShares = _getSharesForAmount(_asset, repayAmount);
        if (seizedShares > userAcc.shares) seizedShares = userAcc.shares;

        userAcc.borrowPrincipal = totalDebt - repayAmount;
        userAcc.borrowIndex = userAcc.borrowPrincipal == 0 ? 0 : poolAcc.borrowIndex;
        userAcc.shares -= seizedShares;
        poolAcc.totalBorrows -= repayAmount;
        poolAcc.totalShares -= seizedShares;

        emit Liquidate(
            msg.sender,
            _borrower,
            _asset,
            _asset,
            repayAmount,
            seizedShares
        );
    }


}