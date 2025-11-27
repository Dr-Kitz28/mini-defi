# Mini DeFi – Multi-Asset Lending Pool

A production-ready decentralized lending protocol built with Hardhat/Solidity. Supports **multiple assets**, **cross-collateral borrowing**, and **dynamic interest rates pegged to real-world repo rates** for fiat currency integration.

---

## Features

### ✅ Multi-Asset Lending Pool
- Deposit and earn interest on multiple ERC-20 tokens
- Borrow one asset using another as collateral (cross-collateral)
- Per-asset configuration: collateral factors, liquidation bonuses, interest rate models
- Secure liquidation mechanism with configurable bonuses

### ✅ Fiat Currency Pegging via Global Repo Rates
- **GlobalRepoRateOracle** — on-chain oracle storing global repo rates (mirrors central bank rates)
- **DynamicInterestRateModel** — borrow rates adjust based on:
  - Base rate + Utilization component + **Global repo rate**
- Enables fiat-pegged stablecoin lending with rates tied to real-world monetary policy

### ✅ Multiple Interest Rate Models
| Model | Description |
|-------|-------------|
| `LinearInterestRateModel` | Simple linear curve based on utilization |
| `KinkInterestRateModel` | Compound/Aave-style with optimal utilization "kink" |
| `ExponentialInterestRateModel` | Smooth convex curve |
| `TimeWeightedInterestRateModel` | Fraxlend-style adaptive controller |
| `DynamicInterestRateModel` | **Repo-rate-aware** for fiat pegging |

---

## Quick Start

### Install dependencies
```powershell
npm install
```

### Run tests
```powershell
npm test
```

### Start local blockchain
```powershell
npx hardhat node
```

### Deploy contracts (in a new terminal)
```powershell
npx hardhat run scripts/deploy.js --network localhost
```

### Use the frontend
1. Serve the frontend directory:
   ```powershell
   npx http-server frontend -p 8000
   ```
2. Open http://127.0.0.1:8000 in your browser
3. Connect MetaMask to Hardhat Local (Chain ID: 31337, RPC: http://127.0.0.1:8545)
4. Import a Hardhat test account private key into MetaMask
5. Deposit, borrow, repay, withdraw, and liquidate positions

---

## Architecture

```
contracts/
├── LendingPool.sol              # Core multi-asset lending pool
├── MockERC20.sol                # Test ERC-20 token
├── InterestRateModel.sol        # Base interest rate model
├── interfaces/
│   ├── IInterestRateModel.sol   # Interest model interface
│   └── IPriceOracle.sol         # Price oracle interface
├── interest/
│   ├── LinearInterestRateModel.sol
│   ├── KinkInterestRateModel.sol
│   ├── ExponentialInterestRateModel.sol
│   ├── TimeWeightedInterestRateModel.sol
│   └── DynamicInterestRateModel.sol  # Repo-rate-aware model
├── oracles/
│   └── GlobalRepoRateOracle.sol      # Global repo rate oracle
├── governance/
│   └── RateGovernor.sol              # Timelock for parameter updates
└── test/
    ├── MockPriceOracle.sol
    ├── MockLendingPool.sol
    ├── MaliciousERC20.sol
    └── ReentrancyAttacker.sol
```

---

## Core Contracts

### `LendingPool.sol`
The heart of the protocol — a **multi-asset lending pool** with:

- **`deposit(address asset, uint256 amount)`** — Deposit tokens, receive shares
- **`withdraw(address asset, uint256 shares)`** — Burn shares, receive tokens + interest
- **`borrow(address asset, uint256 amount)`** — Borrow against collateral
- **`repay(address asset, uint256 amount)`** — Repay borrowed amount
- **`liquidate(address borrower, address borrowAsset, address collateralAsset, uint256 repayAmount)`** — Liquidate unhealthy positions

### `GlobalRepoRateOracle.sol`
Stores the global repo rate (e.g., central bank rate) that `DynamicInterestRateModel` uses to peg lending rates to real-world fiat rates.

```solidity
// Owner updates repo rate (e.g., 5% = 5e16)
oracle.setRepoRate(5e16);

// Interest model reads it
uint256 rate = oracle.getRepoRate();
```

### `DynamicInterestRateModel.sol`
Calculates borrow rates as:
```
borrowRate = baseRate + (utilization × multiplier) + repoRate
```

This ties on-chain DeFi rates to off-chain monetary policy, enabling fiat-pegged stablecoin markets.

---

## How Multi-Asset Lending Works

### Shares-Based Accounting
Each asset has its own share token. When you deposit:
1. You receive shares proportional to your deposit
2. As borrowers pay interest, total deposits grow but shares stay constant
3. Your shares become worth more over time
4. On withdrawal, you receive your principal + accrued interest

### Cross-Collateral Borrowing
- Deposit Token A as collateral
- Borrow Token B against it
- Collateral factor determines max borrow (e.g., 75% means $100 collateral → $75 max borrow)
- If collateral value drops below threshold, position becomes liquidatable

### Liquidation
- Anyone can liquidate unhealthy positions
- Liquidator repays part of borrower's debt
- Liquidator receives equivalent collateral + bonus (e.g., 5%)
- Protects the protocol from bad debt

---

## Fiat Currency Integration

The `DynamicInterestRateModel` + `GlobalRepoRateOracle` combo enables:

1. **Single-asset pegging**: Set repo rate to match a central bank rate (e.g., Fed Funds Rate)
2. **Multi-asset pegging**: Deploy multiple oracles for different currencies
3. **Dynamic proportions**: Governance can adjust weights based on global monetary conditions

Example: A USD stablecoin pool could use the Fed Funds Rate, while a EUR pool uses the ECB rate.

---

## Test Coverage

```
  DynamicInterestRateModel
    ✔ should calculate the borrow rate correctly
    ✔ should update the borrow rate when the repo rate changes
    ✔ should only allow the owner to set parameters

  TimeWeightedInterestRateModel
    ✔ Should set parameters correctly
    ✔ Should increase APR when utilization is above the upper bound
    ✔ Should decrease APR when utilization is below the lower bound
    ... (12 tests)

  LendingPool (Multi-Asset)
    ✔ should allow a user to deposit an asset
    ✔ should allow borrowing one asset against another
    ✔ should prevent borrowing beyond collateral factor
    ✔ should accrue interest and allow repayment
    ✔ should allow partial/full liquidation
    ... (7 tests)

  Reentrancy Attack
    ✔ Should prevent re-entrant calls to the withdraw function

  20 passing
```

---

## Governance

The `RateGovernor` contract provides a timelock for parameter updates:
- Queue parameter changes with a delay
- Community can review before execution
- See `docs/governance-tooling.md` for workflow

---

## Documentation

- `docs/interest-rate-research-summary.md` — Research on DeFi interest rate models
- `docs/governance-tooling.md` — How to use the governance timelock

---

## Security

- ReentrancyGuard on all state-changing functions
- Comprehensive test suite including reentrancy attack tests
- See `SECURITY.md` for reporting vulnerabilities

---

## License

MIT
