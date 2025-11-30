# Mini DeFi - Multi-Asset Lending Pool

A production-ready decentralized lending protocol built with Hardhat/Solidity. Supports **multiple assets**, **cross-collateral borrowing**, **dynamic interest rates pegged to real-world repo rates**, and an **AI-powered RAG assistant** using Mistral-7B for user guidance.

[![GitHub](https://img.shields.io/badge/GitHub-Dr--Kitz28%2Fmini--defi-blue?logo=github)](https://github.com/Dr-Kitz28/mini-defi)

---

## Features

### Multi-Asset Lending Pool
- Deposit and earn interest on multiple ERC-20 tokens
- Borrow one asset using another as collateral (cross-collateral)
- Per-asset configuration: collateral factors, liquidation bonuses, interest rate models
- Secure liquidation mechanism with configurable bonuses

### Fiat Currency Pegging via Global Repo Rates
- **GlobalRepoRateOracle** - on-chain oracle storing global repo rates (mirrors central bank rates)
- **DynamicInterestRateModel** - borrow rates adjust based on:
  - Base rate + Utilization component + **Global repo rate**
- Enables fiat-pegged stablecoin lending with rates tied to real-world monetary policy

### Multiple Interest Rate Models
| Model | Description |
|-------|-------------|
| `LinearInterestRateModel` | Simple linear curve based on utilization |
| `KinkInterestRateModel` | Compound/Aave-style with optimal utilization "kink" |
| `ExponentialInterestRateModel` | Smooth convex curve |
| `TimeWeightedInterestRateModel` | Fraxlend-style adaptive controller |
| `DynamicInterestRateModel` | **Repo-rate-aware** for fiat pegging |

### Modern Web Dashboard
- Day/Night theme toggle
- Adjustable contrast levels (Low, Medium, High, Very High)
- 3D button effects with hover and click animations
- Real-time asset prices and positions
- AI-powered chat assistant for DeFi guidance
- Batch operations for multi-asset deposits/withdrawals

---

## 🚀 Developer Setup Guide

This section provides detailed instructions for developers to set up and run the complete Mini-DeFi platform, including the blockchain, frontend, and AI assistant.

### Prerequisites

Before starting, ensure you have the following installed:

| Dependency | Version | Purpose |
|------------|---------|---------|
| **Node.js** | v18+ | JavaScript runtime |
| **npm** | v9+ | Package manager |
| **Python** | 3.9+ | Local RAG server |
| **MetaMask** | Latest | Wallet connection |
| **Git** | Latest | Version control |

### Step 1: Clone the Repository

```powershell
git clone https://github.com/Dr-Kitz28/mini-defi.git
cd mini-defi
```

### Step 2: Install Node.js Dependencies

```powershell
npm install
```

### Step 3: Install Python Dependencies (for AI Assistant)

```powershell
pip install flask sentence-transformers faiss-cpu ctransformers python-dotenv
```

Or use the requirements file:

```powershell
pip install -r requirements-local-rag.txt
```

### Step 4: Download the AI Model (Mistral-7B)

The AI chat assistant uses **Mistral-7B-Instruct** (4-bit quantized, ~4.4GB). Download it to the `models/` folder:

**Option A: PowerShell (Windows)**

```powershell
New-Item -ItemType Directory -Force -Path "models"
Invoke-WebRequest -Uri "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf" -OutFile "models/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
```

**Option B: curl (Linux/Mac)**

```bash
mkdir -p models
curl -L -o models/mistral-7b-instruct-v0.2.Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
```

**Option C: Direct Download**

Download manually from: [Hugging Face - TheBloke/Mistral-7B-Instruct-v0.2-GGUF](https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/blob/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf)

Place the file in: `mini-defi/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf`

---

## 🖥️ Running the Platform (3 Terminals)

You need **3 separate terminal windows** to run all components:

### Terminal 1: Hardhat Blockchain Node

```powershell
cd mini-defi
npx hardhat node
```

Keep this terminal running. You should see:
```
Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/
```

### Terminal 2: Deploy Contracts & Start Frontend

```powershell
cd mini-defi

# Deploy 100 assets (wait for Hardhat node to be ready first)
npx hardhat run scripts/deploy-many-assets.js --network localhost

# Start the frontend server
npm run serve
```

The frontend will be available at: **http://localhost:8000**

### Terminal 3: Local RAG Server (AI Assistant)

```powershell
cd mini-defi
python scripts/local_rag_server.py --threads 8
```

Adjust `--threads` based on your CPU (recommended: number of performance cores).

You should see:
```
[RAG] Server starting on http://localhost:5000
[RAG] LLM loaded successfully!
```

---

## ✅ Verifying All Services Are Running

Run these commands to check each service:

```powershell
# Check Hardhat node (port 8545)
netstat -ano | findstr ":8545"

# Check Frontend (port 8000)
netstat -ano | findstr ":8000"

# Check RAG Server (port 5000)
netstat -ano | findstr ":5000"
```

All three should show `LISTENING` status.

---

## 💬 Using the AI Chat Assistant

1. Open the website at http://localhost:8000
2. Click the **chat button** (bottom-right corner)
3. Type `/local` to switch to local Mistral-7B mode
4. Type `/status` to verify the AI is connected
5. Ask questions like:
   - "How do I deposit assets?"
   - "What is health factor?"
   - "How does liquidation work?"
   - "Explain the smart contracts"

### Chat Commands

| Command | Description |
|---------|-------------|
| `/local` | Toggle between OpenAI API and local Mistral-7B |
| `/status` | Check current AI mode and server health |
| `/setkey YOUR_KEY` | Set OpenAI API key (optional) |
| `/clearkey` | Clear saved API key |

---

## 🔧 Hardware Requirements for AI

The local Mistral-7B model runs on CPU. Recommended specs:

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **RAM** | 8GB | 16GB+ |
| **CPU** | 4 cores | 8+ cores |
| **Storage** | 5GB free | 10GB free |

**Note:** GPU acceleration is not required. The model uses efficient 4-bit quantization.

---

## Quick Start (Windows)

### Option 1: One-Click Start (Recommended)
Double-click `start.bat` to automatically:
1. Install dependencies
2. Compile contracts
3. Start the blockchain node
4. Deploy contracts with 100 assets
5. Launch the frontend

### Option 2: PowerShell Script
```powershell
.\start-servers.ps1
```

### Option 3: Manual Setup

#### Install dependencies
```powershell
npm install
```

#### Run tests
```powershell
npm test
```

#### Start local blockchain (Terminal 1)
```powershell
npx hardhat node
```

#### Deploy contracts (Terminal 2)
```powershell
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/deploy-many-assets.js --network localhost
```

#### Start frontend server (Terminal 3)
```powershell
cd frontend
python -m http.server 3000
```

#### Open the dashboard
Navigate to http://localhost:3000 in your browser

---

## Connecting MetaMask

1. Open MetaMask and add a custom network:
   - **Network Name**: Hardhat Local
   - **RPC URL**: http://127.0.0.1:8545
   - **Chain ID**: 31337
   - **Currency Symbol**: ETH

2. Import a test account (Hardhat provides 20 pre-funded accounts):
   - Copy a private key from the Hardhat node output
   - In MetaMask: Account icon -> Import Account -> Paste private key

3. Click "Connect Wallet" in the dashboard

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
