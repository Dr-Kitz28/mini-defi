# How to Use the Mini-DeFi Dashboard

## Getting Started

### Step 1: Connect Your Wallet

1. Click the "Connect Wallet" button in the top-right corner of the dashboard
2. MetaMask will prompt you to connect
3. Make sure you're on the Hardhat Local network (Chain ID 31337)
4. Your wallet address will appear once connected

### Step 2: Browse Available Assets

The left sidebar shows the Asset Browser with all available tokens:

- Use the search box to find specific assets by name or symbol
- Use the category dropdown to filter (Stablecoins, DeFi, Layer 2, etc.)
- Click on an asset to select it for operations
- Selected assets appear highlighted

### Step 3: Perform Operations

The center panel has tabs for different operations:

**Deposit Tab:**
1. Select assets you want to deposit
2. Adjust proportions (must total 100%)
3. Click "Equalize" to split evenly
4. Enter total USD amount
5. Click "Execute Deposit"
6. Confirm in MetaMask

**Withdraw Tab:**
1. Select assets you've deposited
2. Set proportions for each
3. Enter amount to withdraw
4. Click "Execute Withdraw"
5. Your collateral will decrease - watch your Health Factor!

**Borrow Tab:**
1. First, you need deposits as collateral
2. Select assets you want to borrow
3. Set proportions and amount
4. Your max borrow = Collateral × Collateral Factor
5. Click "Execute Borrow"

**Repay Tab:**
1. Select the assets you borrowed
2. Set the repayment amounts
3. Include interest owed
4. Click "Execute Repay"

**Liquidate Tab:**
1. Enter a borrower's address
2. Select collateral and borrow assets
3. Enter repay amount
4. Receive collateral + liquidation bonus

## Dashboard Sections

### Top Bar
- Network indicator (Hardhat Local)
- Connected wallet address
- Connect Wallet button

### Asset Browser (Left Panel)
- Search and filter assets
- Select multiple assets
- View asset prices
- See your positions

### Operation Panel (Center)
- Deposit/Withdraw/Borrow/Repay/Liquidate tabs
- Proportion sliders
- Amount inputs
- Execute buttons

### Position Summary (Right Panel)
- Total deposited value
- Total borrowed value
- Health Factor display
- Selected assets preview

### AI Chat Assistant
- Click the chat icon in the bottom-right
- Ask questions about DeFi, the platform, or get help
- Commands: /local, /status, /setkey, /clearkey
