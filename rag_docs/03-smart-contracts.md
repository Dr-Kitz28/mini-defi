# Smart Contract Architecture

## Core Contracts

### LendingPool.sol
The main contract managing all lending operations.

**Key Functions:**
- `deposit(address asset, uint256 amount)` - Deposit tokens to earn interest
- `withdraw(address asset, uint256 amount)` - Withdraw your deposits
- `borrow(address asset, uint256 amount)` - Borrow against collateral
- `repay(address asset, uint256 amount)` - Repay borrowed amounts
- `liquidate(borrower, collateralAsset, borrowAsset, repayAmount)` - Liquidate unhealthy positions
- `getHealthFactor(address user)` - Check user's health factor
- `calculateInterestOwed(address user, address asset)` - Get interest owed

**Key State:**
- `userDeposits[user][asset]` - User's deposit amount per asset
- `userBorrows[user][asset]` - User's borrow amount per asset
- `assetData[asset]` - Asset configuration (oracle, interest model, collateral factor)
- `listedAssets[]` - Array of all supported assets

### MockERC20.sol
Test ERC-20 token implementation for local development.

**Functions:**
- Standard ERC-20 (transfer, approve, balanceOf, etc.)
- `mint(address to, uint256 amount)` - Mint new tokens (for testing)

## Interest Rate Models

### LinearInterestRateModel.sol
Simple linear curve: rate increases linearly with utilization.
- Formula: `rate = baseRate + (utilization × slope)`

### KinkInterestRateModel.sol
Compound/Aave-style with optimal utilization "kink":
- Below kink: gradual rate increase
- Above kink: steep rate increase
- Encourages optimal utilization

### ExponentialInterestRateModel.sol
Smooth convex curve that accelerates at high utilization.

### TimeWeightedInterestRateModel.sol
Fraxlend-style adaptive controller:
- Adjusts rates based on historical utilization
- Smooths out volatility

### DynamicInterestRateModel.sol
Repo-rate-aware model for fiat pegging:
- Formula: `rate = baseRate + (utilization × multiplier) + repoRate`
- Ties on-chain rates to real-world central bank rates

## Oracles

### MockPriceOracle.sol
Returns mock prices for testing.
- `getPrice(address asset)` - Returns asset price in USD (18 decimals)
- `setPrice(address asset, uint256 price)` - Set mock price

### GlobalRepoRateOracle.sol
Stores global repo rate for DynamicInterestRateModel:
- `getRepoRate()` - Returns current repo rate
- `setRepoRate(uint256 rate)` - Update repo rate (owner only)

## Governance

### RateGovernor.sol
Timelock contract for parameter updates:
- Queue parameter changes with delay
- Community can review before execution
- Protects against malicious governance attacks

## Test Contracts

### MaliciousERC20.sol
Token that attempts reentrancy attacks (for security testing).

### ReentrancyAttacker.sol
Contract that exploits reentrancy vulnerabilities (for testing).

### MockLendingPool.sol
Simplified lending pool for unit testing.

## Security Features

- ReentrancyGuard on all state-changing functions
- Access control (Ownable) on admin functions
- Input validation and overflow protection
- Comprehensive test suite including attack simulations
