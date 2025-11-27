// Multi-Asset Lending Pool Frontend
// This version is compatible with the multi-asset LendingPool contract

let provider;
let signer;
let poolContract;
let tokenContracts = {};
let config;
let deployedContracts;
let selectedAsset = null;

// ABI for the multi-asset LendingPool contract
const POOL_ABI = [
    // Core functions
    "function deposit(address _asset, uint256 _amount) external",
    "function withdraw(address _asset, uint256 _shares) external",
    "function borrow(address _asset, uint256 _amount) external",
    "function repay(address _asset, uint256 _amount) external",
    "function liquidate(address _borrower, address _borrowAsset, address _collateralAsset, uint256 _repayAmount) external",
    
    // View functions
    "function getAccountLiquidity(address _user) external view returns (uint256 totalCollateralValue, uint256 totalBorrowValue)",
    "function getTotalDebt(address _asset, address _user) external view returns (uint256)",
    "function poolAccounts(address _asset) external view returns (uint256 totalDeposits, uint256 totalBorrows, uint256 totalShares, uint256 lastUpdateBlock)",
    "function userAccounts(address _user, address _asset) external view returns (uint256 shares, uint256 borrowed, uint256 lastUpdateBlock)",
    "function supportedAssets(address _asset) external view returns (bool)",
    "function collateralFactors(address _asset) external view returns (uint256)",
    "function interestRateModels(address _asset) external view returns (address)",
    "function priceOracle() external view returns (address)",
    "function owner() external view returns (address)",
    
    // Events
    "event Deposit(address indexed user, address indexed asset, uint256 amount, uint256 shares)",
    "event Withdraw(address indexed user, address indexed asset, uint256 shares, uint256 amount)",
    "event Borrow(address indexed user, address indexed asset, uint256 amount)",
    "event Repay(address indexed user, address indexed asset, uint256 amount)",
    "event Liquidation(address indexed liquidator, address indexed borrower, address borrowAsset, address collateralAsset, uint256 repayAmount, uint256 collateralSeized)"
];

// ERC20 ABI
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
    "function name() external view returns (string)"
];

// Helper: Wait for ethers to be available
async function ensureEthersAvailable(maxWait = 10000) {
    const start = Date.now();
    while (typeof ethers === 'undefined') {
        if (Date.now() - start > maxWait) {
            throw new Error('ethers.js failed to load within timeout');
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return ethers;
}

// Load configuration
async function loadConfig() {
    try {
        const configResponse = await fetch('config.json');
        config = await configResponse.json();
        
        const contractsResponse = await fetch('deployed-contracts.json');
        deployedContracts = await contractsResponse.json();
        
        console.log('Config loaded:', config);
        console.log('Deployed contracts:', deployedContracts);
        
        return true;
    } catch (error) {
        console.error('Failed to load configuration:', error);
        showStatus('Failed to load configuration: ' + error.message, 'error');
        return false;
    }
}

// Connect wallet
async function connectWallet() {
    console.log('connectWallet() called');
    
    try {
        await ensureEthersAvailable();
        console.log('ethers available:', typeof ethers);
    } catch (e) {
        showStatus('ethers.js not loaded. Please refresh the page.', 'error');
        return;
    }
    
    if (typeof window.ethereum === 'undefined') {
        showStatus('MetaMask not detected. Please install MetaMask.', 'error');
        return;
    }
    
    try {
        showStatus('Connecting wallet...', 'info');
        
        // Request account access
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        console.log('Accounts:', accounts);
        
        // Create provider and signer
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        const address = await signer.getAddress();
        
        console.log('Connected address:', address);
        
        // Load config if not loaded
        if (!deployedContracts) {
            const loaded = await loadConfig();
            if (!loaded) return;
        }
        
        // Create contract instances
        poolContract = new ethers.Contract(deployedContracts.lendingPool, POOL_ABI, signer);
        console.log('Pool contract:', poolContract.target);
        
        // Create token contracts
        if (deployedContracts.assets) {
            for (const [symbol, assetInfo] of Object.entries(deployedContracts.assets)) {
                tokenContracts[symbol] = {
                    contract: new ethers.Contract(assetInfo.token, ERC20_ABI, signer),
                    address: assetInfo.token,
                    symbol: symbol
                };
                console.log(`Token ${symbol} at ${assetInfo.token}`);
            }
        }
        
        // Update UI
        document.getElementById('wallet-address').textContent = `Connected: ${address.slice(0, 6)}...${address.slice(-4)}`;
        document.getElementById('connect-btn').textContent = 'Connected';
        document.getElementById('connect-btn').disabled = true;
        
        // Populate asset selectors
        populateAssetSelectors();
        
        showStatus('Wallet connected successfully!', 'success');
        
        // Auto-refresh stats
        await refreshStats();
        
    } catch (error) {
        console.error('Wallet connection error:', error);
        showStatus('Wallet connection failed: ' + error.message, 'error');
    }
}

// Populate asset dropdown selectors
function populateAssetSelectors() {
    const selectors = document.querySelectorAll('.asset-selector');
    
    selectors.forEach(selector => {
        selector.innerHTML = '<option value="">Select Asset</option>';
        
        for (const [symbol, tokenInfo] of Object.entries(tokenContracts)) {
            const option = document.createElement('option');
            option.value = tokenInfo.address;
            option.textContent = symbol;
            option.dataset.symbol = symbol;
            selector.appendChild(option);
        }
    });
}

// Refresh stats for all assets
async function refreshStats() {
    if (!poolContract || !signer) {
        showStatus('Please connect wallet first', 'error');
        return;
    }
    
    try {
        showStatus('Loading stats...', 'info');
        
        const userAddress = await signer.getAddress();
        let statsHtml = '';
        
        // Get account liquidity
        try {
            const [totalCollateral, totalBorrow] = await poolContract.getAccountLiquidity(userAddress);
            const collateralFormatted = ethers.formatEther(totalCollateral);
            const borrowFormatted = ethers.formatEther(totalBorrow);
            
            statsHtml += `
                <div class="stat-card account-summary">
                    <h4>Account Summary</h4>
                    <p><strong>Total Collateral Value:</strong> $${parseFloat(collateralFormatted).toFixed(4)}</p>
                    <p><strong>Total Borrow Value:</strong> $${parseFloat(borrowFormatted).toFixed(4)}</p>
                    <p><strong>Health Factor:</strong> ${totalBorrow > 0 ? (parseFloat(collateralFormatted) / parseFloat(borrowFormatted)).toFixed(2) : '∞'}</p>
                </div>
            `;
        } catch (e) {
            console.warn('Could not get account liquidity:', e);
        }
        
        // Get stats for each asset
        for (const [symbol, tokenInfo] of Object.entries(tokenContracts)) {
            try {
                // Pool stats
                const poolAccount = await poolContract.poolAccounts(tokenInfo.address);
                const totalDeposits = ethers.formatEther(poolAccount.totalDeposits || poolAccount[0] || 0n);
                const totalBorrows = ethers.formatEther(poolAccount.totalBorrows || poolAccount[1] || 0n);
                const totalShares = ethers.formatEther(poolAccount.totalShares || poolAccount[2] || 0n);
                
                // User stats
                const userAccount = await poolContract.userAccounts(userAddress, tokenInfo.address);
                const userShares = ethers.formatEther(userAccount.shares || userAccount[0] || 0n);
                const userBorrowed = ethers.formatEther(userAccount.borrowed || userAccount[1] || 0n);
                
                // Token balance
                const tokenBalance = await tokenInfo.contract.balanceOf(userAddress);
                const balanceFormatted = ethers.formatEther(tokenBalance);
                
                // Total debt (includes interest)
                let totalDebt = '0';
                try {
                    const debt = await poolContract.getTotalDebt(tokenInfo.address, userAddress);
                    totalDebt = ethers.formatEther(debt);
                } catch (e) {
                    totalDebt = userBorrowed;
                }
                
                // Calculate utilization
                const utilization = parseFloat(totalDeposits) > 0 
                    ? ((parseFloat(totalBorrows) / parseFloat(totalDeposits)) * 100).toFixed(2)
                    : '0.00';
                
                statsHtml += `
                    <div class="stat-card">
                        <h4>${symbol}</h4>
                        <div class="pool-stats">
                            <p><strong>Pool Total Deposits:</strong> ${parseFloat(totalDeposits).toFixed(4)}</p>
                            <p><strong>Pool Total Borrows:</strong> ${parseFloat(totalBorrows).toFixed(4)}</p>
                            <p><strong>Utilization:</strong> ${utilization}%</p>
                        </div>
                        <div class="user-stats">
                            <p><strong>Your Wallet Balance:</strong> ${parseFloat(balanceFormatted).toFixed(4)}</p>
                            <p><strong>Your Shares:</strong> ${parseFloat(userShares).toFixed(4)}</p>
                            <p><strong>Your Debt:</strong> ${parseFloat(totalDebt).toFixed(4)}</p>
                        </div>
                    </div>
                `;
            } catch (e) {
                console.warn(`Could not get stats for ${symbol}:`, e);
                statsHtml += `
                    <div class="stat-card error">
                        <h4>${symbol}</h4>
                        <p>Error loading stats</p>
                    </div>
                `;
            }
        }
        
        document.getElementById('stats-container').innerHTML = statsHtml || '<p>No assets configured</p>';
        showStatus('Stats loaded successfully!', 'success');
        
    } catch (error) {
        console.error('Error refreshing stats:', error);
        showStatus('Error loading stats: ' + error.message, 'error');
    }
}

// Handle deposit
async function handleDeposit() {
    const assetSelector = document.getElementById('deposit-asset');
    const amountInput = document.getElementById('deposit-amount');
    
    const assetAddress = assetSelector.value;
    const amount = amountInput.value;
    
    if (!assetAddress) {
        showStatus('Please select an asset', 'error');
        return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }
    
    try {
        showStatus('Processing deposit...', 'info');
        
        const amountWei = ethers.parseEther(amount);
        const symbol = assetSelector.options[assetSelector.selectedIndex].dataset.symbol;
        const tokenContract = tokenContracts[symbol].contract;
        
        // Check and approve if needed
        const userAddress = await signer.getAddress();
        const allowance = await tokenContract.allowance(userAddress, deployedContracts.lendingPool);
        
        if (allowance < amountWei) {
            showStatus('Approving token spend...', 'info');
            const approveTx = await tokenContract.approve(deployedContracts.lendingPool, ethers.MaxUint256);
            await approveTx.wait();
            showStatus('Approval confirmed, depositing...', 'info');
        }
        
        // Deposit
        const tx = await poolContract.deposit(assetAddress, amountWei);
        showStatus('Transaction submitted, waiting for confirmation...', 'info');
        
        const receipt = await tx.wait();
        showStatus(`Deposit successful! Tx: ${receipt.hash.slice(0, 10)}...`, 'success');
        
        amountInput.value = '';
        await refreshStats();
        
    } catch (error) {
        console.error('Deposit error:', error);
        showStatus('Deposit failed: ' + (error.reason || error.message), 'error');
    }
}

// Handle withdraw
async function handleWithdraw() {
    const assetSelector = document.getElementById('withdraw-asset');
    const amountInput = document.getElementById('withdraw-amount');
    
    const assetAddress = assetSelector.value;
    const amount = amountInput.value;
    
    if (!assetAddress) {
        showStatus('Please select an asset', 'error');
        return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
        showStatus('Please enter a valid amount (shares)', 'error');
        return;
    }
    
    try {
        showStatus('Processing withdrawal...', 'info');
        
        const sharesWei = ethers.parseEther(amount);
        
        const tx = await poolContract.withdraw(assetAddress, sharesWei);
        showStatus('Transaction submitted, waiting for confirmation...', 'info');
        
        const receipt = await tx.wait();
        showStatus(`Withdrawal successful! Tx: ${receipt.hash.slice(0, 10)}...`, 'success');
        
        amountInput.value = '';
        await refreshStats();
        
    } catch (error) {
        console.error('Withdraw error:', error);
        showStatus('Withdrawal failed: ' + (error.reason || error.message), 'error');
    }
}

// Handle borrow
async function handleBorrow() {
    const assetSelector = document.getElementById('borrow-asset');
    const amountInput = document.getElementById('borrow-amount');
    
    const assetAddress = assetSelector.value;
    const amount = amountInput.value;
    
    if (!assetAddress) {
        showStatus('Please select an asset', 'error');
        return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }
    
    try {
        showStatus('Processing borrow...', 'info');
        
        const amountWei = ethers.parseEther(amount);
        
        const tx = await poolContract.borrow(assetAddress, amountWei);
        showStatus('Transaction submitted, waiting for confirmation...', 'info');
        
        const receipt = await tx.wait();
        showStatus(`Borrow successful! Tx: ${receipt.hash.slice(0, 10)}...`, 'success');
        
        amountInput.value = '';
        await refreshStats();
        
    } catch (error) {
        console.error('Borrow error:', error);
        showStatus('Borrow failed: ' + (error.reason || error.message), 'error');
    }
}

// Handle repay
async function handleRepay() {
    const assetSelector = document.getElementById('repay-asset');
    const amountInput = document.getElementById('repay-amount');
    
    const assetAddress = assetSelector.value;
    const amount = amountInput.value;
    
    if (!assetAddress) {
        showStatus('Please select an asset', 'error');
        return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
        showStatus('Please enter a valid amount', 'error');
        return;
    }
    
    try {
        showStatus('Processing repayment...', 'info');
        
        const amountWei = ethers.parseEther(amount);
        const symbol = assetSelector.options[assetSelector.selectedIndex].dataset.symbol;
        const tokenContract = tokenContracts[symbol].contract;
        
        // Check and approve if needed
        const userAddress = await signer.getAddress();
        const allowance = await tokenContract.allowance(userAddress, deployedContracts.lendingPool);
        
        if (allowance < amountWei) {
            showStatus('Approving token spend...', 'info');
            const approveTx = await tokenContract.approve(deployedContracts.lendingPool, ethers.MaxUint256);
            await approveTx.wait();
            showStatus('Approval confirmed, repaying...', 'info');
        }
        
        const tx = await poolContract.repay(assetAddress, amountWei);
        showStatus('Transaction submitted, waiting for confirmation...', 'info');
        
        const receipt = await tx.wait();
        showStatus(`Repayment successful! Tx: ${receipt.hash.slice(0, 10)}...`, 'success');
        
        amountInput.value = '';
        await refreshStats();
        
    } catch (error) {
        console.error('Repay error:', error);
        showStatus('Repayment failed: ' + (error.reason || error.message), 'error');
    }
}

// Handle liquidation
async function handleLiquidate() {
    const borrowerInput = document.getElementById('liquidate-borrower');
    const borrowAssetSelector = document.getElementById('liquidate-borrow-asset');
    const collateralAssetSelector = document.getElementById('liquidate-collateral-asset');
    const amountInput = document.getElementById('liquidate-amount');
    
    const borrower = borrowerInput.value;
    const borrowAsset = borrowAssetSelector.value;
    const collateralAsset = collateralAssetSelector.value;
    const amount = amountInput.value;
    
    if (!borrower || !ethers.isAddress(borrower)) {
        showStatus('Please enter a valid borrower address', 'error');
        return;
    }
    
    if (!borrowAsset || !collateralAsset) {
        showStatus('Please select both borrow and collateral assets', 'error');
        return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
        showStatus('Please enter a valid repay amount', 'error');
        return;
    }
    
    try {
        showStatus('Processing liquidation...', 'info');
        
        const amountWei = ethers.parseEther(amount);
        
        // Get symbol and approve borrow asset
        const borrowSymbol = borrowAssetSelector.options[borrowAssetSelector.selectedIndex].dataset.symbol;
        const tokenContract = tokenContracts[borrowSymbol].contract;
        
        const userAddress = await signer.getAddress();
        const allowance = await tokenContract.allowance(userAddress, deployedContracts.lendingPool);
        
        if (allowance < amountWei) {
            showStatus('Approving token spend...', 'info');
            const approveTx = await tokenContract.approve(deployedContracts.lendingPool, ethers.MaxUint256);
            await approveTx.wait();
            showStatus('Approval confirmed, liquidating...', 'info');
        }
        
        const tx = await poolContract.liquidate(borrower, borrowAsset, collateralAsset, amountWei);
        showStatus('Transaction submitted, waiting for confirmation...', 'info');
        
        const receipt = await tx.wait();
        showStatus(`Liquidation successful! Tx: ${receipt.hash.slice(0, 10)}...`, 'success');
        
        borrowerInput.value = '';
        amountInput.value = '';
        await refreshStats();
        
    } catch (error) {
        console.error('Liquidation error:', error);
        showStatus('Liquidation failed: ' + (error.reason || error.message), 'error');
    }
}

// Show status message
function showStatus(message, type) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `status ${type}`;
    }
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Bootstrap function
async function bootstrap() {
    console.log('Bootstrapping app...');
    
    // Load config on page load
    await loadConfig();
    
    // Bind event handlers
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', connectWallet);
    }
    
    const refreshBtn = document.getElementById('refresh-stats');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshStats);
    }
    
    const depositBtn = document.getElementById('deposit-btn');
    if (depositBtn) {
        depositBtn.addEventListener('click', handleDeposit);
    }
    
    const withdrawBtn = document.getElementById('withdraw-btn');
    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', handleWithdraw);
    }
    
    const borrowBtn = document.getElementById('borrow-btn');
    if (borrowBtn) {
        borrowBtn.addEventListener('click', handleBorrow);
    }
    
    const repayBtn = document.getElementById('repay-btn');
    if (repayBtn) {
        repayBtn.addEventListener('click', handleRepay);
    }
    
    const liquidateBtn = document.getElementById('liquidate-btn');
    if (liquidateBtn) {
        liquidateBtn.addEventListener('click', handleLiquidate);
    }
    
    console.log('App bootstrapped successfully');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    // DOM already loaded
    bootstrap();
}
