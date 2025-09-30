# Mini DeFi – Lending Pool Playground

This repository contains a self-contained, production-ready decentralized finance (DeFi) prototype built with Hardhat. It implements a single-asset lending pool where users can lend, borrow, and earn interest on their crypto assets.

## 1. The Problem: Decentralized Lending

In the world of Decentralized Finance (DeFi), one of the core building blocks is the ability to lend and borrow assets without relying on traditional financial intermediaries like banks. This requires a system that is transparent, autonomous, and secure, where users can:

-   **Lend**: Deposit their assets into a pool to earn interest, putting their capital to work.
-   **Borrow**: Access liquidity by providing collateral, without having to sell their own assets.

The challenge is to build a system that can manage these operations efficiently, calculate interest rates dynamically based on supply and demand, and handle liquidations securely if a borrower's position becomes too risky.

## 2. The Solution: A Smart Contract-Powered Lending Pool

This project implements a minimal, single-asset lending pool on the Ethereum blockchain using smart contracts. It creates a decentralized money market where all rules are enforced by code.

The core of the system is the `LendingPool.sol` contract, which allows users to interact with the pool's liquidity. The architectural foundation of this pool is a **shares-based accounting model**.

### How the Shares Model Works

Instead of tracking each user's individual interest gains, the pool mints "shares" to depositors. The value of each share appreciates over time as interest is paid into the pool by borrowers.

-   **On Deposit**: When a user deposits assets, they receive a number of shares proportional to their deposit relative to the total assets in the pool.
-   **Interest Accrual**: As borrowers pay interest, the `totalDeposits` in the pool grow, but the `totalShares` remains the same. This means each share is now worth more of the underlying asset.
-   **On Withdraw**: When a user withdraws, they burn their shares and receive the corresponding, now higher, value in the underlying asset. Their profit is the difference between the value of their shares at withdrawal versus at deposit.

This elegant model simplifies accounting, reduces computational overhead (gas costs), and ensures that interest is distributed fairly and continuously among all lenders.

## 3. Quick Start: How to Run the Codebase

Install dependencies:

```powershell
npm install
```

Run the test suite to verify everything is working correctly:

```powershell
npm test
```

Start a local Hardhat chain:

```powershell
npx hardhat node
```

In a second terminal, deploy the stack to the local node (make sure the node above is running):

```powershell
npx hardhat run scripts/deploy.js --network localhost
```

The script prints the deployed `MockERC20`, `LendingPoolFactory`, and each pool/model pair—keep them handy for the UI.

## 4. How It Works: Key Components

### `contracts/LendingPool.sol`

This is the heart of the protocol. It manages all core user-facing functions:

-   `deposit(uint256 amount)`: Allows a user to deposit assets and receive shares.
-   `withdraw(uint256 sharesToBurn)`: Allows a user to burn their shares to withdraw their underlying assets plus accrued interest.
-   `borrow(uint256 amount)`: Allows a user to borrow assets, provided they have sufficient collateral deposited (up to 66.67% of their collateral value).
-   `repay(uint256 amount)`: Allows a user to repay their loan.
-   `liquidate(address user, uint256 amount)`: Allows a third party (a liquidator) to repay the debt of an "unhealthy" borrower in exchange for a portion of their collateral at a 5% bonus. This is a critical function for maintaining system solvency.
-   `isHealthy(address user)`: A crucial check to determine if a borrower's debt exceeds their borrowing limit.

### `contracts/interest/TimeWeightedInterestRateModel.sol`

This contract is responsible for dynamically calculating the interest rate for borrowing based on the pool's **utilization rate** (the percentage of deposited assets that are currently being borrowed).

-   **Low Utilization**: If there are many assets available, the interest rate is low to encourage borrowing.
-   **High Utilization**: If most assets are borrowed, the interest rate is high to encourage repayments and new deposits.

This contract uses a time-weighted approach to smoothly adjust the rate, preventing extreme volatility. Other models (Linear, Kinked Jump, Exponential) are also available in the `contracts/interest/` directory.

### `contracts/LendingPoolFactory.sol`

This is a factory contract. Its sole purpose is to deploy new `LendingPool` instances for different assets, making the system extensible.

### `test/`

This directory contains the automated tests for the entire system. The tests, written using Hardhat and Chai, simulate various user interactions and edge cases to ensure the contracts behave as expected.

-   `TimeWeightedInterestRateModel.js`: Contains 9 tests that validate the interest rate calculation logic.
-   `LendingPool.js`: Contains 3 comprehensive tests that cover depositing, earning interest, borrowing, enforcing collateral limits, and liquidation.

## 5. What We Achieved

Through a rigorous process of auditing, debugging, and refactoring, we have built a functional and robust DeFi lending protocol. The key achievements include:

1.  **Fixed a Critical Architectural Flaw**: The initial codebase did not correctly accrue interest for lenders. This was resolved by re-architecting the `LendingPool` to use the shares-based accounting model.
2.  **Developed a Robust Interest Rate Mechanism**: The `TimeWeightedInterestRateModel` provides a stable and responsive way to manage the cost of borrowing.
3.  **Ensured System Solvency**: The liquidation mechanism is fully functional, protecting the pool and its lenders from bad debt.
4.  **Achieved Full Test Coverage**: The entire codebase is validated by a comprehensive test suite, with all 12 tests passing. This provides a high degree of confidence in the code's reliability.
5.  **Production-Ready Code**: The contracts are now logically sound, tested, and structured in a way that is ready for deployment on a live blockchain network.

## 6. Using the Browser UI

1. Open `frontend/index.html` in a static file server (for example the VS Code Live Server extension). Directly opening the file from disk works in most browsers too.
2. (Optional) Update `frontend/config.json` with the deployed addresses so the UI loads them automatically based on the connected chain ID. If the file is absent or empty you can still paste addresses manually.
3. Connect MetaMask to the Hardhat local network (`Chain ID 31337`).
4. Paste or confirm the token and pool addresses.
5. Use the widgets to deposit, withdraw, borrow, repay, liquidate unhealthy positions, and refresh stats. All numbers are denominated in the ERC-20 token.

The UI uses ethers.js v6 directly in the browser and requests approvals automatically before any action that requires token transfers.

## 7. Governance and Extending the Project

- **Governance**: The optional `RateGovernor` timelock (`contracts/governance/RateGovernor.sol`) can be used to queue parameter updates for interest models. `docs/governance-tooling.md` walks through the workflow.
- **Extending**: You can extend the project by adding multi-asset support with oracles, experimenting with new interest rate strategies, or enhancing the frontend.

Happy hacking! If you add new features or discover bugs, contributions and issues are welcome.
