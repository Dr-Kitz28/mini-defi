# Mini-DeFi Platform Overview

## What is Mini-DeFi?

Mini-DeFi is a decentralized lending protocol built on Ethereum. It allows users to:
- **Deposit** cryptocurrency assets to earn interest
- **Borrow** assets by using other assets as collateral
- **Manage** a multi-asset portfolio with batch operations
- **Monitor** their health factor to avoid liquidation

## Key Concepts

### Deposits
When you deposit an asset, you supply tokens to the lending pool. In return, you receive "shares" representing your ownership of the pool. As borrowers pay interest, the pool grows, making your shares worth more over time.

### Borrowing
You can borrow one asset using another as collateral. For example, deposit ETH and borrow USDC. The amount you can borrow depends on the collateral factor (typically 50-85%).

### Health Factor
The health factor measures your position's safety:
- Formula: Health Factor = (Collateral Value × Collateral Factor) / Total Borrows
- Above 1.5: Safe zone (recommended)
- 1.0 to 1.5: Caution zone
- Below 1.0: Liquidation risk!

### Liquidation
If your health factor drops below 1.0, anyone can "liquidate" your position:
- They repay part of your debt
- They receive your collateral at a discount (liquidation bonus)
- This protects the protocol from bad debt

### Interest Rates
Interest rates are dynamic based on utilization (how much is borrowed vs deposited):
- Low utilization = Lower rates
- High utilization = Higher rates
- Depositors earn supply APY
- Borrowers pay borrow APY

## Available Assets

The platform supports 100+ assets across categories:
- **USD Stablecoins**: USDC, USDT, DAI, FRAX, LUSD, etc.
- **BTC Derivatives**: WBTC, renBTC, sBTC, etc.
- **ETH Derivatives**: WETH, stETH, rETH, cbETH, etc.
- **DeFi Tokens**: AAVE, UNI, CRV, MKR, COMP, etc.
- **Layer 2 Tokens**: ARB, OP, MATIC, etc.
- **Meme Coins**: DOGE, SHIB, PEPE (with lower collateral factors)

## Network Information

- **Network**: Hardhat Local (for testing)
- **RPC URL**: http://127.0.0.1:8545
- **Chain ID**: 31337
- **Currency**: ETH (for gas fees)
