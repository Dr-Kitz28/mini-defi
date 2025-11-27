// Mini DeFi - Multi-Asset Lending Pool Frontend
// Modern UI with network detection and first-time user help

let provider;
let signer;
let poolContract;
let tokenContracts = {};
let config;
let deployedContracts;
let userBalances = {};

// Network configurations
const NETWORKS = {
  1: { name: 'Ethereum Mainnet', currency: 'ETH' },
  5: { name: 'Goerli Testnet', currency: 'ETH' },
  11155111: { name: 'Sepolia Testnet', currency: 'ETH' },
  137: { name: 'Polygon Mainnet', currency: 'MATIC' },
  80001: { name: 'Mumbai Testnet', currency: 'MATIC' },
  80002: { name: 'Amoy Testnet', currency: 'MATIC' },
  42161: { name: 'Arbitrum One', currency: 'ETH' },
  10: { name: 'Optimism', currency: 'ETH' },
  56: { name: 'BNB Chain', currency: 'BNB' },
  43114: { name: 'Avalanche', currency: 'AVAX' },
  31337: { name: 'Hardhat Local', currency: 'ETH' },
  1337: { name: 'Local Network', currency: 'ETH' }
};

// Contract ABIs
const POOL_ABI = [
  "function deposit(address _asset, uint256 _amount) external",
  "function withdraw(address _asset, uint256 _shares) external",
  "function borrow(address _asset, uint256 _amount) external",
  "function repay(address _asset, uint256 _amount) external",
  "function liquidate(address _borrower, address _borrowAsset, address _collateralAsset, uint256 _repayAmount) external",
  "function getAccountLiquidity(address _user) external view returns (uint256 totalCollateralValue, uint256 totalBorrowValue)",
  "function getTotalDebt(address _asset, address _user) external view returns (uint256)",
  "function poolAccounts(address _asset) external view returns (uint256 totalDeposits, uint256 totalBorrows, uint256 totalShares, uint256 lastUpdateBlock)",
  "function userAccounts(address _user, address _asset) external view returns (uint256 shares, uint256 borrowed, uint256 lastUpdateBlock)",
  "function supportedAssets(address _asset) external view returns (bool)",
  "function collateralFactors(address _asset) external view returns (uint256)",
  "function interestRateModels(address _asset) external view returns (address)",
  "function priceOracle() external view returns (address)",
  "function owner() external view returns (address)",
  "event Deposit(address indexed user, address indexed asset, uint256 amount, uint256 shares)",
  "event Withdraw(address indexed user, address indexed asset, uint256 shares, uint256 amount)",
  "event Borrow(address indexed user, address indexed asset, uint256 amount)",
  "event Repay(address indexed user, address indexed asset, uint256 amount)",
  "event Liquidation(address indexed liquidator, address indexed borrower, address borrowAsset, address collateralAsset, uint256 repayAmount, uint256 collateralSeized)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

// ============================================
// Utility Functions
// ============================================

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

function formatNumber(value, decimals = 4) {
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  if (num === 0) return '0.00';
  if (num < 0.0001) return '<0.0001';
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals 
  });
}

function truncateAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ============================================
// Toast Notifications
// ============================================

let toastTimeout;

function showToast(message, type = 'info') {
  const toast = document.getElementById('status-toast');
  const msgEl = toast.querySelector('.toast-message');
  
  toast.className = `toast ${type}`;
  msgEl.textContent = message;
  toast.style.display = 'flex';
  
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 5000);
  
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function hideToast() {
  const toast = document.getElementById('status-toast');
  toast.style.display = 'none';
  clearTimeout(toastTimeout);
}

// ============================================
// Help Modal
// ============================================

function initHelpModal() {
  const modal = document.getElementById('help-modal');
  const helpBtn = document.getElementById('help-btn');
  const closeBtn = document.getElementById('help-close');
  const gotItBtn = document.getElementById('help-got-it');
  const dontShowCheckbox = document.getElementById('dont-show-again');
  
  // Check if user has seen the help before
  const hasSeenHelp = localStorage.getItem('minidefi_help_seen');
  
  if (!hasSeenHelp) {
    modal.style.display = 'flex';
  }
  
  helpBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
  });
  
  closeBtn.addEventListener('click', closeHelpModal);
  gotItBtn.addEventListener('click', closeHelpModal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeHelpModal();
    }
  });
  
  function closeHelpModal() {
    if (dontShowCheckbox.checked) {
      localStorage.setItem('minidefi_help_seen', 'true');
    }
    modal.style.display = 'none';
  }
}

// ============================================
// Network Detection
// ============================================

async function updateNetworkDisplay() {
  const badge = document.getElementById('network-badge');
  const nameEl = document.getElementById('network-name');
  
  if (!provider) {
    badge.className = 'network-badge';
    nameEl.textContent = 'Not Connected';
    return;
  }
  
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const networkInfo = NETWORKS[chainId];
    
    if (networkInfo) {
      nameEl.textContent = networkInfo.name;
      badge.className = 'network-badge connected';
    } else {
      nameEl.textContent = `Chain ${chainId}`;
      badge.className = 'network-badge connected';
    }
    
    // Check if on expected network (Hardhat local by default)
    const expectedChainId = config?.defaultChainId ? parseInt(config.defaultChainId) : 31337;
    if (chainId !== expectedChainId) {
      badge.className = 'network-badge wrong-network';
      nameEl.textContent = networkInfo?.name || `Chain ${chainId}`;
    }
  } catch (e) {
    console.error('Error getting network:', e);
    badge.className = 'network-badge';
    nameEl.textContent = 'Unknown';
  }
}

function setupNetworkListeners() {
  if (window.ethereum) {
    window.ethereum.on('chainChanged', async (chainId) => {
      console.log('Network changed to:', chainId);
      await updateNetworkDisplay();
      // Reload contracts for new network if connected
      if (signer) {
        showToast('Network changed. Please reconnect your wallet.', 'info');
      }
    });
    
    window.ethereum.on('accountsChanged', async (accounts) => {
      console.log('Accounts changed:', accounts);
      if (accounts.length === 0) {
        // User disconnected
        resetConnection();
        showToast('Wallet disconnected', 'info');
      } else {
        // User switched accounts
        await connectWallet();
      }
    });
  }
}

function resetConnection() {
  provider = null;
  signer = null;
  poolContract = null;
  tokenContracts = {};
  
  document.getElementById('connect-btn').textContent = 'Connect Wallet';
  document.getElementById('connect-btn').disabled = false;
  document.getElementById('connect-btn').innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <path d="M22 10H2"/>
    </svg>
    <span>Connect Wallet</span>
  `;
  
  updateNetworkDisplay();
  resetStatsDisplay();
}

// ============================================
// Configuration Loading
// ============================================

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
    showToast('Failed to load configuration: ' + error.message, 'error');
    return false;
  }
}

// ============================================
// Wallet Connection
// ============================================

async function connectWallet() {
  console.log('connectWallet() called');
  
  try {
    await ensureEthersAvailable();
  } catch (e) {
    showToast('ethers.js not loaded. Please refresh the page.', 'error');
    return;
  }
  
  if (typeof window.ethereum === 'undefined') {
    showToast('MetaMask not detected. Please install MetaMask.', 'error');
    return;
  }
  
  try {
    showToast('Connecting wallet...', 'info');
    
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    console.log('Accounts:', accounts);
    
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
    const connectBtn = document.getElementById('connect-btn');
    connectBtn.innerHTML = `
      <span class="connected-address">${truncateAddress(address)}</span>
    `;
    connectBtn.disabled = true;
    
    // Update network display
    await updateNetworkDisplay();
    
    // Populate asset selectors
    populateAssetSelectors();
    
    showToast('Wallet connected successfully!', 'success');
    
    // Auto-refresh stats
    await refreshStats();
    
  } catch (error) {
    console.error('Wallet connection error:', error);
    showToast('Wallet connection failed: ' + error.message, 'error');
  }
}

// ============================================
// Asset Selectors
// ============================================

function populateAssetSelectors() {
  const selectors = document.querySelectorAll('.form-select');
  
  selectors.forEach(selector => {
    selector.innerHTML = '<option value="">Select asset</option>';
    
    for (const [symbol, tokenInfo] of Object.entries(tokenContracts)) {
      const option = document.createElement('option');
      option.value = tokenInfo.address;
      option.textContent = symbol;
      option.dataset.symbol = symbol;
      selector.appendChild(option);
    }
  });
}

// ============================================
// Stats Display
// ============================================

function resetStatsDisplay() {
  document.getElementById('total-collateral').textContent = '$0.00';
  document.getElementById('total-borrowed').textContent = '$0.00';
  document.getElementById('health-factor').textContent = '-';
  document.getElementById('health-factor').className = 'overview-value';
  document.getElementById('net-worth').textContent = '$0.00';
  
  document.getElementById('markets-tbody').innerHTML = `
    <tr class="empty-row">
      <td colspan="7">Connect wallet to view markets</td>
    </tr>
  `;
}

async function refreshStats() {
  if (!poolContract || !signer) {
    showToast('Please connect wallet first', 'error');
    return;
  }
  
  try {
    showToast('Loading stats...', 'info');
    
    const userAddress = await signer.getAddress();
    let totalCollateral = 0;
    let totalBorrow = 0;
    
    // Get account liquidity
    try {
      const [collateralValue, borrowValue] = await poolContract.getAccountLiquidity(userAddress);
      totalCollateral = parseFloat(ethers.formatEther(collateralValue));
      totalBorrow = parseFloat(ethers.formatEther(borrowValue));
    } catch (e) {
      console.warn('Could not get account liquidity:', e);
    }
    
    // Update overview cards
    document.getElementById('total-collateral').textContent = `$${formatNumber(totalCollateral)}`;
    document.getElementById('total-borrowed').textContent = `$${formatNumber(totalBorrow)}`;
    
    // Calculate health factor
    const healthFactorEl = document.getElementById('health-factor');
    if (totalBorrow > 0) {
      const healthFactor = totalCollateral / totalBorrow;
      healthFactorEl.textContent = healthFactor.toFixed(2);
      
      if (healthFactor >= 1.5) {
        healthFactorEl.className = 'overview-value health-good';
      } else if (healthFactor >= 1.0) {
        healthFactorEl.className = 'overview-value health-warning';
      } else {
        healthFactorEl.className = 'overview-value health-danger';
      }
    } else {
      healthFactorEl.textContent = '∞';
      healthFactorEl.className = 'overview-value health-good';
    }
    
    // Net worth
    const netWorth = totalCollateral - totalBorrow;
    document.getElementById('net-worth').textContent = `$${formatNumber(netWorth)}`;
    
    // Build markets table
    let tableHtml = '';
    
    for (const [symbol, tokenInfo] of Object.entries(tokenContracts)) {
      try {
        // Pool stats
        const poolAccount = await poolContract.poolAccounts(tokenInfo.address);
        const totalDeposits = ethers.formatEther(poolAccount.totalDeposits || poolAccount[0] || 0n);
        const totalBorrows = ethers.formatEther(poolAccount.totalBorrows || poolAccount[1] || 0n);
        
        // User stats
        const userAccount = await poolContract.userAccounts(userAddress, tokenInfo.address);
        const userShares = ethers.formatEther(userAccount.shares || userAccount[0] || 0n);
        const userBorrowed = ethers.formatEther(userAccount.borrowed || userAccount[1] || 0n);
        
        // Token balance
        const tokenBalance = await tokenInfo.contract.balanceOf(userAddress);
        const balanceFormatted = ethers.formatEther(tokenBalance);
        
        // Store for MAX button functionality
        userBalances[symbol] = {
          wallet: balanceFormatted,
          shares: userShares,
          debt: userBorrowed
        };
        
        // Total debt (includes interest)
        let totalDebt = userBorrowed;
        try {
          const debt = await poolContract.getTotalDebt(tokenInfo.address, userAddress);
          totalDebt = ethers.formatEther(debt);
        } catch (e) {
          // Use borrowed amount if getTotalDebt not available
        }
        
        // Calculate utilization
        const utilization = parseFloat(totalDeposits) > 0 
          ? ((parseFloat(totalBorrows) / parseFloat(totalDeposits)) * 100).toFixed(1)
          : '0.0';
        
        tableHtml += `
          <tr>
            <td>
              <div class="asset-cell">
                <div class="asset-icon">${symbol.charAt(0)}</div>
                ${symbol}
              </div>
            </td>
            <td>${formatNumber(totalDeposits)}</td>
            <td>${formatNumber(totalBorrows)}</td>
            <td>${utilization}%</td>
            <td>${formatNumber(balanceFormatted)}</td>
            <td>${formatNumber(userShares)}</td>
            <td>${formatNumber(totalDebt)}</td>
          </tr>
        `;
      } catch (e) {
        console.warn(`Could not get stats for ${symbol}:`, e);
        tableHtml += `
          <tr>
            <td>
              <div class="asset-cell">
                <div class="asset-icon">${symbol.charAt(0)}</div>
                ${symbol}
              </div>
            </td>
            <td colspan="6" style="color: var(--color-danger);">Error loading data</td>
          </tr>
        `;
      }
    }
    
    document.getElementById('markets-tbody').innerHTML = tableHtml || `
      <tr class="empty-row">
        <td colspan="7">No assets configured</td>
      </tr>
    `;
    
    showToast('Stats refreshed', 'success');
    
  } catch (error) {
    console.error('Error refreshing stats:', error);
    showToast('Error loading stats: ' + error.message, 'error');
  }
}

// ============================================
// Transaction Handlers
// ============================================

async function handleDeposit() {
  const assetSelector = document.getElementById('deposit-asset');
  const amountInput = document.getElementById('deposit-amount');
  
  const assetAddress = assetSelector.value;
  const amount = amountInput.value;
  
  if (!assetAddress) {
    showToast('Please select an asset', 'error');
    return;
  }
  
  if (!amount || parseFloat(amount) <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }
  
  try {
    showToast('Processing deposit...', 'info');
    
    const amountWei = ethers.parseEther(amount);
    const symbol = assetSelector.options[assetSelector.selectedIndex].dataset.symbol;
    const tokenContract = tokenContracts[symbol].contract;
    
    // Check and approve if needed
    const userAddress = await signer.getAddress();
    const allowance = await tokenContract.allowance(userAddress, deployedContracts.lendingPool);
    
    if (allowance < amountWei) {
      showToast('Approving token spend...', 'info');
      const approveTx = await tokenContract.approve(deployedContracts.lendingPool, ethers.MaxUint256);
      await approveTx.wait();
      showToast('Approval confirmed, depositing...', 'info');
    }
    
    // Deposit
    const tx = await poolContract.deposit(assetAddress, amountWei);
    showToast('Transaction submitted...', 'info');
    
    const receipt = await tx.wait();
    showToast(`Deposited ${amount} ${symbol} successfully!`, 'success');
    
    amountInput.value = '';
    await refreshStats();
    
  } catch (error) {
    console.error('Deposit error:', error);
    showToast('Deposit failed: ' + (error.reason || error.message), 'error');
  }
}

async function handleWithdraw() {
  const assetSelector = document.getElementById('withdraw-asset');
  const amountInput = document.getElementById('withdraw-amount');
  
  const assetAddress = assetSelector.value;
  const amount = amountInput.value;
  
  if (!assetAddress) {
    showToast('Please select an asset', 'error');
    return;
  }
  
  if (!amount || parseFloat(amount) <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }
  
  try {
    showToast('Processing withdrawal...', 'info');
    
    const sharesWei = ethers.parseEther(amount);
    const symbol = assetSelector.options[assetSelector.selectedIndex].dataset.symbol;
    
    const tx = await poolContract.withdraw(assetAddress, sharesWei);
    showToast('Transaction submitted...', 'info');
    
    const receipt = await tx.wait();
    showToast(`Withdrew ${amount} ${symbol} shares successfully!`, 'success');
    
    amountInput.value = '';
    await refreshStats();
    
  } catch (error) {
    console.error('Withdraw error:', error);
    showToast('Withdrawal failed: ' + (error.reason || error.message), 'error');
  }
}

async function handleBorrow() {
  const assetSelector = document.getElementById('borrow-asset');
  const amountInput = document.getElementById('borrow-amount');
  
  const assetAddress = assetSelector.value;
  const amount = amountInput.value;
  
  if (!assetAddress) {
    showToast('Please select an asset', 'error');
    return;
  }
  
  if (!amount || parseFloat(amount) <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }
  
  try {
    showToast('Processing borrow...', 'info');
    
    const amountWei = ethers.parseEther(amount);
    const symbol = assetSelector.options[assetSelector.selectedIndex].dataset.symbol;
    
    const tx = await poolContract.borrow(assetAddress, amountWei);
    showToast('Transaction submitted...', 'info');
    
    const receipt = await tx.wait();
    showToast(`Borrowed ${amount} ${symbol} successfully!`, 'success');
    
    amountInput.value = '';
    await refreshStats();
    
  } catch (error) {
    console.error('Borrow error:', error);
    showToast('Borrow failed: ' + (error.reason || error.message), 'error');
  }
}

async function handleRepay() {
  const assetSelector = document.getElementById('repay-asset');
  const amountInput = document.getElementById('repay-amount');
  
  const assetAddress = assetSelector.value;
  const amount = amountInput.value;
  
  if (!assetAddress) {
    showToast('Please select an asset', 'error');
    return;
  }
  
  if (!amount || parseFloat(amount) <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }
  
  try {
    showToast('Processing repayment...', 'info');
    
    const amountWei = ethers.parseEther(amount);
    const symbol = assetSelector.options[assetSelector.selectedIndex].dataset.symbol;
    const tokenContract = tokenContracts[symbol].contract;
    
    // Check and approve if needed
    const userAddress = await signer.getAddress();
    const allowance = await tokenContract.allowance(userAddress, deployedContracts.lendingPool);
    
    if (allowance < amountWei) {
      showToast('Approving token spend...', 'info');
      const approveTx = await tokenContract.approve(deployedContracts.lendingPool, ethers.MaxUint256);
      await approveTx.wait();
      showToast('Approval confirmed, repaying...', 'info');
    }
    
    const tx = await poolContract.repay(assetAddress, amountWei);
    showToast('Transaction submitted...', 'info');
    
    const receipt = await tx.wait();
    showToast(`Repaid ${amount} ${symbol} successfully!`, 'success');
    
    amountInput.value = '';
    await refreshStats();
    
  } catch (error) {
    console.error('Repay error:', error);
    showToast('Repayment failed: ' + (error.reason || error.message), 'error');
  }
}

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
    showToast('Please enter a valid borrower address', 'error');
    return;
  }
  
  if (!borrowAsset || !collateralAsset) {
    showToast('Please select both debt and collateral assets', 'error');
    return;
  }
  
  if (!amount || parseFloat(amount) <= 0) {
    showToast('Please enter a valid repay amount', 'error');
    return;
  }
  
  try {
    showToast('Processing liquidation...', 'info');
    
    const amountWei = ethers.parseEther(amount);
    
    // Get symbol and approve borrow asset
    const borrowSymbol = borrowAssetSelector.options[borrowAssetSelector.selectedIndex].dataset.symbol;
    const tokenContract = tokenContracts[borrowSymbol].contract;
    
    const userAddress = await signer.getAddress();
    const allowance = await tokenContract.allowance(userAddress, deployedContracts.lendingPool);
    
    if (allowance < amountWei) {
      showToast('Approving token spend...', 'info');
      const approveTx = await tokenContract.approve(deployedContracts.lendingPool, ethers.MaxUint256);
      await approveTx.wait();
      showToast('Approval confirmed, liquidating...', 'info');
    }
    
    const tx = await poolContract.liquidate(borrower, borrowAsset, collateralAsset, amountWei);
    showToast('Transaction submitted...', 'info');
    
    const receipt = await tx.wait();
    showToast('Liquidation successful!', 'success');
    
    borrowerInput.value = '';
    amountInput.value = '';
    await refreshStats();
    
  } catch (error) {
    console.error('Liquidation error:', error);
    showToast('Liquidation failed: ' + (error.reason || error.message), 'error');
  }
}

// ============================================
// MAX Button Handlers
// ============================================

function setupMaxButtons() {
  document.querySelectorAll('.btn-max').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.target;
      const assetSelector = document.getElementById(`${target}-asset`);
      const amountInput = document.getElementById(`${target}-amount`);
      
      if (!assetSelector.value) {
        showToast('Please select an asset first', 'error');
        return;
      }
      
      const symbol = assetSelector.options[assetSelector.selectedIndex].dataset.symbol;
      const balances = userBalances[symbol];
      
      if (!balances) {
        showToast('Please refresh stats first', 'error');
        return;
      }
      
      let maxValue;
      switch (target) {
        case 'deposit':
          maxValue = balances.wallet;
          break;
        case 'withdraw':
          maxValue = balances.shares;
          break;
        case 'repay':
          maxValue = Math.min(parseFloat(balances.wallet), parseFloat(balances.debt));
          break;
        default:
          maxValue = 0;
      }
      
      amountInput.value = parseFloat(maxValue).toFixed(6);
    });
  });
}

// ============================================
// Bootstrap
// ============================================

async function bootstrap() {
  console.log('Bootstrapping Mini DeFi app...');
  
  // Initialize help modal
  initHelpModal();
  
  // Setup network listeners
  setupNetworkListeners();
  
  // Load config on page load
  await loadConfig();
  
  // Setup MAX buttons
  setupMaxButtons();
  
  // Bind event handlers
  document.getElementById('connect-btn').addEventListener('click', connectWallet);
  document.getElementById('refresh-stats').addEventListener('click', refreshStats);
  document.getElementById('deposit-btn').addEventListener('click', handleDeposit);
  document.getElementById('withdraw-btn').addEventListener('click', handleWithdraw);
  document.getElementById('borrow-btn').addEventListener('click', handleBorrow);
  document.getElementById('repay-btn').addEventListener('click', handleRepay);
  document.getElementById('liquidate-btn').addEventListener('click', handleLiquidate);
  
  // Toast close button
  document.querySelector('.toast-close').addEventListener('click', hideToast);
  
  console.log('Mini DeFi app ready');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
