# Frontend JavaScript Reference (app.js)

## Application State

The app maintains these global state variables:

```javascript
let provider = null;           // ethers.js provider for blockchain
let signer = null;             // Connected wallet signer
let lendingPoolContract = null; // LendingPool contract instance
let assets = [];               // Array of all loaded assets
let selectedAssets = new Map(); // address -> { asset, proportion }
let userPositions = {};        // User's positions per asset
let currentOperation = 'deposit'; // Current active tab
```

## Initialization Flow

1. `initializeApp()` runs on page load
2. Loads `deployed-contracts.json` with contract addresses
3. Checks for existing MetaMask connection
4. Sets up theme controls

## Wallet Connection

```javascript
async function connectWallet() {
    // Request MetaMask connection
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    
    // Create contract instance
    lendingPoolContract = new ethers.Contract(
        contractAddress,
        LENDING_POOL_ABI,
        signer
    );
    
    // Load assets and user positions
    await loadAssets();
    await updateUserPositions();
}
```

## Asset Loading

```javascript
async function loadAssets() {
    // Get listed assets from contract
    const assetAddresses = await lendingPoolContract.listedAssets();
    
    for (const address of assetAddresses) {
        // Get asset data: oracle, IRM, collateral factor, etc.
        const data = await lendingPoolContract.assetData(address);
        
        // Get ERC20 token info
        const token = new ethers.Contract(address, ERC20_ABI, provider);
        const name = await token.name();
        const symbol = await token.symbol();
        
        assets.push({ address, name, symbol, ...data });
    }
}
```

## Batch Operations

```javascript
async function executeBatchOperation(type) {
    // type = 'deposit', 'withdraw', 'borrow', 'repay'
    
    const totalAmount = document.getElementById(`${type}-total`).value;
    
    for (const [address, { proportion }] of selectedAssets) {
        const amount = (totalAmount * proportion) / 100;
        
        if (type === 'deposit') {
            await approveToken(address, amount);
            await lendingPoolContract.deposit(address, amount);
        }
        // Similar for withdraw, borrow, repay
    }
}
```

## Health Factor Display

```javascript
async function updateHealthFactor() {
    const hf = await lendingPoolContract.getHealthFactor(userAddress);
    
    // Display with color coding
    if (hf > 1.5e18) {
        // Green - safe
    } else if (hf > 1.0e18) {
        // Yellow - caution
    } else {
        // Red - liquidation risk
    }
}
```

## AI Chat System

```javascript
async function sendChatMessage() {
    const message = document.getElementById('chat-input').value;
    
    // Special commands
    if (message === '/local') toggleLocalRAG();
    if (message === '/status') showAIStatus();
    
    // Get response
    if (useLocalRAG) {
        response = await getLocalRAGResponse(message);
    } else if (openaiApiKey) {
        response = await getOpenAIResponse(message);
    } else {
        response = generateLocalResponse(message);
    }
    
    addChatMessage(response, 'assistant');
}
```

## Theme System

```javascript
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}
```

## Key Event Handlers

- `connect-btn click` → connectWallet()
- `asset-search input` → filterAssets()
- `[data-op] click` → switchOperation()
- `execute-deposit click` → executeBatchOperation('deposit')
- `chat-send click` → sendChatMessage()
- `theme-toggle click` → toggleTheme()

## Contract ABIs Used

```javascript
const LENDING_POOL_ABI = [
    "function deposit(address asset, uint256 amount)",
    "function withdraw(address asset, uint256 amount)",
    "function borrow(address asset, uint256 amount)",
    "function repay(address asset, uint256 amount)",
    "function getHealthFactor(address user) view returns (uint256)",
    // ... more functions
];

const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function approve(address spender, uint256 amount)",
    "function balanceOf(address) view returns (uint256)",
];
```
