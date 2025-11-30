# Smart Contract Source Code Reference

## LendingPool.sol - Core Lending Contract

This is the main contract managing all lending operations.

### Contract Overview

```solidity
contract LendingPool is Ownable, ReentrancyGuard {
    // Uses SafeERC20 for secure token transfers
    // Uses ReentrancyGuard to prevent reentrancy attacks
}
```

### Key Data Structures

**AssetConfig** - Configuration for each listed asset:
- `assetAddress` - Token address
- `irmAddress` - Interest rate model address
- `collateralFactor` - e.g., 75e16 for 75%
- `liquidationBonus` - e.g., 5e16 for 5%
- `isActive` - Whether asset is active

**UserAssetAccount** - Per-user accounting:
- `shares` - Number of shares representing deposit
- `borrowPrincipal` - Amount borrowed
- `borrowIndex` - For interest calculation

**PoolAssetAccount** - Pool-wide accounting:
- `totalShares` - Total deposit shares
- `totalBorrows` - Total borrowed
- `borrowIndex` - Interest accumulator
- `lastInterestAccruedTimestamp` - Last update time
- `totalReserves` - Protocol reserves

### Key Functions

**deposit(address asset, uint256 amount)**
1. Checks asset is listed and amount > 0
2. Accrues interest first
3. Calculates shares for the deposit amount
4. Updates user and pool shares
5. Transfers tokens from user to pool

**withdraw(address asset, uint256 shares)**
1. Accrues interest
2. Calculates amount for shares
3. Checks user won't become undercollateralized
4. Burns shares and transfers tokens back

**borrow(address asset, uint256 amount)**
1. Accrues interest
2. Checks liquidity (collateral covers borrow)
3. Updates user borrow principal and index
4. Updates pool total borrows
5. Transfers tokens to user

**repay(address asset, uint256 amount)**
1. Accrues interest
2. Calculates interest owed
3. Updates user borrow principal
4. Updates pool total borrows
5. Transfers tokens from user to pool

**liquidate(borrower, collateralAsset, borrowAsset, repayAmount)**
1. Checks borrower's health factor < 1
2. Calculates seized collateral (with bonus)
3. Transfers collateral to liquidator
4. Repays borrower's debt

### Interest Calculation

Interest accrues every block using the interest rate model:
```solidity
function _accrueInterest(address _asset) internal {
    // Calculate time elapsed
    // Get borrow rate from interest rate model
    // Update borrow index
    // Update last accrued timestamp
}
```

### Health Factor Calculation

```solidity
function getHealthFactor(address user) public view returns (uint256) {
    // collateralValue = sum(deposit * price * collateralFactor)
    // borrowValue = sum(borrow * price)
    // healthFactor = collateralValue / borrowValue
}
```

## MockERC20.sol - Test Token

Simple ERC-20 implementation for testing:
- Standard transfer, approve, balanceOf functions
- `mint(address to, uint256 amount)` - Creates new tokens

## Interest Rate Models

All implement IInterestRateModel interface:
```solidity
interface IInterestRateModel {
    function getBorrowRate(uint256 utilization) external view returns (uint256);
    function getSupplyRate(uint256 utilization, uint256 reserveFactor) external view returns (uint256);
}
```

### LinearInterestRateModel
- Rate = baseRate + (utilization * slope)
- Simple and predictable

### KinkInterestRateModel
- Has optimal utilization "kink" point
- Rate increases slowly below kink
- Rate increases steeply above kink
- Used by Compound and Aave

### DynamicInterestRateModel
- Rate = baseRate + (utilization * multiplier) + repoRate
- Includes global repo rate for fiat pegging
- Connected to GlobalRepoRateOracle
