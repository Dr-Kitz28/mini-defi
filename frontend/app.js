/**
 * Mini-DeFi Multi-Asset Dashboard
 * Supports 10,000+ assets with batch operations and RAG chat assistance
 */

// ============================================================================
// Configuration & State
// ============================================================================

let provider = null;
let signer = null;
let lendingPoolContract = null;
let assets = []; // All loaded assets
let selectedAssets = new Map(); // address -> { asset, proportion }
let userPositions = {}; // User's positions per asset
let currentOperation = 'deposit';

// Contract ABIs (minimal for required functions)
const LENDING_POOL_ABI = [
    "function listedAssets(uint256) view returns (address)",
    "function assetData(address) view returns (address oracle, address interestRateModel, uint256 collateralFactor, uint256 totalDeposits, uint256 totalBorrows, uint256 lastUpdateTime, uint256 borrowIndex)",
    "function deposit(address asset, uint256 amount) external",
    "function withdraw(address asset, uint256 amount) external",
    "function borrow(address asset, uint256 amount) external",
    "function repay(address asset, uint256 amount) external",
    "function liquidate(address borrower, address collateralAsset, address borrowAsset, uint256 repayAmount) external",
    "function userDeposits(address user, address asset) view returns (uint256)",
    "function userBorrows(address user, address asset) view returns (uint256)",
    "function getHealthFactor(address user) view returns (uint256)",
    "function calculateInterestOwed(address user, address asset) view returns (uint256)"
];

const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
];

const PRICE_ORACLE_ABI = [
    "function getPrice(address asset) view returns (uint256)"
];

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    // Load contract addresses
    try {
        const response = await fetch('deployed-contracts.json');
        if (response.ok) {
            window.deployedContracts = await response.json();
        }
    } catch (e) {
        console.log('No deployed contracts found, will prompt for address');
    }

    // Check for existing wallet connection
    if (window.ethereum && window.ethereum.selectedAddress) {
        await connectWallet();
    }

    // Check if we should show help
    if (!localStorage.getItem('mini-defi-help-dismissed')) {
        showHelp();
    }

    // Update network display
    updateNetworkDisplay();
}

function setupEventListeners() {
    // Connect wallet button
    document.getElementById('connect-btn').addEventListener('click', connectWallet);

    // Search and filter
    document.getElementById('asset-search').addEventListener('input', debounce(filterAssets, 300));
    document.getElementById('category-filter')?.addEventListener('change', filterAssets);

    // Selection buttons
    document.getElementById('select-all-btn')?.addEventListener('click', selectAllVisible);
    document.getElementById('clear-selection-btn')?.addEventListener('click', clearSelection);

    // Operation tabs
    document.querySelectorAll('[data-op]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchOperation(e.target.dataset.op);
        });
    });

    // Proportion controls
    document.getElementById('equalize-btn')?.addEventListener('click', equalizeProportions);
    document.getElementById('reset-proportions-btn')?.addEventListener('click', resetProportions);

    // Execute buttons
    document.getElementById('execute-deposit')?.addEventListener('click', () => executeBatchOperation('deposit'));
    document.getElementById('execute-withdraw')?.addEventListener('click', () => executeBatchOperation('withdraw'));
    document.getElementById('execute-borrow')?.addEventListener('click', () => executeBatchOperation('borrow'));
    document.getElementById('execute-repay')?.addEventListener('click', () => executeBatchOperation('repay'));
    document.getElementById('execute-liquidate')?.addEventListener('click', executeLiquidation);

    // Amount input change -> update preview
    ['deposit-total', 'withdraw-total', 'borrow-total', 'repay-total'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updatePreview);
    });

    // Chat
    document.getElementById('chat-btn')?.addEventListener('click', toggleChat);
    document.getElementById('chat-close')?.addEventListener('click', toggleChat);
    document.getElementById('chat-send')?.addEventListener('click', sendChatMessage);
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // Help modal
    document.getElementById('help-btn')?.addEventListener('click', showHelp);
    document.getElementById('help-close')?.addEventListener('click', hideHelp);
    document.getElementById('help-got-it')?.addEventListener('click', () => {
        if (document.getElementById('dont-show-again')?.checked) {
            localStorage.setItem('mini-defi-help-dismissed', 'true');
        }
        hideHelp();
    });

    // Refresh button
    document.getElementById('refresh-stats')?.addEventListener('click', refreshData);

    // Toast close
    document.querySelector('.toast-close')?.addEventListener('click', hideToast);

    // Network change listener
    if (window.ethereum) {
        window.ethereum.on('chainChanged', () => {
            window.location.reload();
        });
        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length === 0) {
                disconnectWallet();
            } else {
                connectWallet();
            }
        });
    }
}

// ============================================================================
// Wallet Connection
// ============================================================================

async function connectWallet() {
    if (!window.ethereum) {
        showToast('Please install MetaMask to use this dApp', 'error');
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();

        const address = accounts[0];
        const connectBtn = document.getElementById('connect-btn');
        connectBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
            </svg>
            <span>${address.slice(0, 6)}...${address.slice(-4)}</span>
        `;
        connectBtn.disabled = true;
        connectBtn.classList.add('connected');

        await initializeContracts();
        await loadAllAssets();
        await updatePortfolio();
        updateNetworkDisplay();

        showToast('Wallet connected successfully!', 'success');
    } catch (error) {
        console.error('Connection error:', error);
        showToast('Failed to connect wallet', 'error');
    }
}

function disconnectWallet() {
    provider = null;
    signer = null;
    lendingPoolContract = null;
    assets = [];
    selectedAssets.clear();
    userPositions = {};

    const connectBtn = document.getElementById('connect-btn');
    connectBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <path d="M22 10H2"/>
        </svg>
        <span>Connect Wallet</span>
    `;
    connectBtn.disabled = false;
    connectBtn.classList.remove('connected');

    renderAssetList([]);
    updatePortfolio();
}

async function updateNetworkDisplay() {
    const networkName = document.getElementById('network-name');
    const networkBadge = document.getElementById('network-badge');
    
    if (!window.ethereum) {
        networkName.textContent = 'No Wallet';
        return;
    }

    try {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const chainIdInt = parseInt(chainId, 16);

        const networks = {
            1: { name: 'Ethereum', class: 'mainnet' },
            5: { name: 'Goerli', class: 'testnet' },
            11155111: { name: 'Sepolia', class: 'testnet' },
            137: { name: 'Polygon', class: 'mainnet' },
            80001: { name: 'Mumbai', class: 'testnet' },
            31337: { name: 'Hardhat', class: 'local' },
            1337: { name: 'Local', class: 'local' }
        };

        const network = networks[chainIdInt] || { name: `Chain ${chainIdInt}`, class: 'unknown' };
        networkName.textContent = network.name;
        networkBadge.className = `network-badge ${network.class}`;
    } catch (e) {
        networkName.textContent = 'Unknown';
    }
}

// ============================================================================
// Contract Initialization
// ============================================================================

async function initializeContracts() {
    let poolAddress = window.deployedContracts?.lendingPool;

    if (!poolAddress) {
        poolAddress = prompt('Enter LendingPool contract address:');
        if (!poolAddress) {
            showToast('LendingPool address required', 'error');
            return;
        }
    }

    lendingPoolContract = new ethers.Contract(poolAddress, LENDING_POOL_ABI, signer);
}

// ============================================================================
// Asset Loading
// ============================================================================

async function loadAllAssets() {
    if (!lendingPoolContract) return;

    showToast('Loading assets...', 'info');
    assets = [];
    updateAssetCount(0);

    const assetList = document.getElementById('asset-list');
    assetList.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading assets...</p>
        </div>
    `;

    try {
        // Load assets in batches for performance
        let index = 0;
        const batchSize = 100;
        let hasMore = true;

        while (hasMore) {
            const batch = [];
            for (let i = 0; i < batchSize; i++) {
                batch.push(loadAssetAtIndex(index + i));
            }

            const results = await Promise.allSettled(batch);
            let loadedInBatch = 0;

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    assets.push(result.value);
                    loadedInBatch++;
                }
            }

            if (loadedInBatch < batchSize) {
                hasMore = false;
            }

            index += batchSize;

            // Update progress
            updateAssetCount(assets.length);
        }

        // Load user positions for all assets
        await loadUserPositions();

        // Render asset list
        filterAssets();

        // Update positions table
        updatePositionsTable();

        // Populate liquidation dropdowns
        populateLiquidationDropdowns();

        showToast(`Loaded ${assets.length} assets`, 'success');
    } catch (error) {
        console.error('Error loading assets:', error);
        showToast('Error loading assets', 'error');
        assetList.innerHTML = `
            <div class="empty-state">
                <p>Error loading assets</p>
                <button class="btn btn-secondary btn-sm" onclick="loadAllAssets()">Retry</button>
            </div>
        `;
    }
}

async function loadAssetAtIndex(index) {
    try {
        const assetAddress = await lendingPoolContract.listedAssets(index);
        if (!assetAddress || assetAddress === ethers.ZeroAddress) {
            return null;
        }

        const tokenContract = new ethers.Contract(assetAddress, ERC20_ABI, provider);
        const assetData = await lendingPoolContract.assetData(assetAddress);

        const [name, symbol, decimals] = await Promise.all([
            tokenContract.name(),
            tokenContract.symbol(),
            tokenContract.decimals()
        ]);

        // Get price from oracle
        let price = BigInt(0);
        try {
            const oracleContract = new ethers.Contract(assetData[0], PRICE_ORACLE_ABI, provider);
            price = await oracleContract.getPrice(assetAddress);
        } catch (e) {
            console.log(`Could not get price for ${symbol}`);
        }

        // Determine category from symbol
        const category = categorizeAsset(symbol);

        return {
            address: assetAddress,
            name,
            symbol,
            decimals: Number(decimals),
            oracle: assetData[0],
            interestRateModel: assetData[1],
            collateralFactor: assetData[2],
            totalDeposits: assetData[3],
            totalBorrows: assetData[4],
            price,
            category
        };
    } catch (error) {
        return null;
    }
}

function categorizeAsset(symbol) {
    const upper = symbol.toUpperCase();
    if (upper.includes('USD') || upper.includes('DAI') || upper.includes('USDT') || upper.includes('USDC')) return 'USD';
    if (upper.includes('BTC') || upper.includes('WBTC')) return 'BTC';
    if (upper.includes('ETH') || upper.includes('WETH')) return 'ETH';
    if (upper.includes('LINK') || upper.includes('UNI') || upper.includes('AAVE') || upper.includes('COMP')) return 'ALT';
    if (upper.includes('DOGE') || upper.includes('SHIB') || upper.includes('PEPE')) return 'MEME';
    if (upper.includes('OP') || upper.includes('ARB') || upper.includes('MATIC')) return 'L2';
    return 'DFI'; // Default to DeFi tokens
}

async function loadUserPositions() {
    if (!signer || assets.length === 0) return;

    const userAddress = await signer.getAddress();
    userPositions = {};

    // Load positions in batches
    const batchSize = 50;
    for (let i = 0; i < assets.length; i += batchSize) {
        const batch = assets.slice(i, i + batchSize);
        const promises = batch.map(async (asset) => {
            try {
                const [deposits, borrows, balance, allowance] = await Promise.all([
                    lendingPoolContract.userDeposits(userAddress, asset.address),
                    lendingPoolContract.userBorrows(userAddress, asset.address),
                    new ethers.Contract(asset.address, ERC20_ABI, provider).balanceOf(userAddress),
                    new ethers.Contract(asset.address, ERC20_ABI, provider).allowance(userAddress, await lendingPoolContract.getAddress())
                ]);

                userPositions[asset.address] = {
                    deposits,
                    borrows,
                    balance,
                    allowance
                };
            } catch (e) {
                userPositions[asset.address] = {
                    deposits: BigInt(0),
                    borrows: BigInt(0),
                    balance: BigInt(0),
                    allowance: BigInt(0)
                };
            }
        });

        await Promise.all(promises);
    }
}

// ============================================================================
// Asset Display
// ============================================================================

function updateAssetCount(count) {
    document.getElementById('asset-count').textContent = `${count} assets`;
    document.getElementById('filtered-count').textContent = count;
}

function filterAssets() {
    const searchTerm = document.getElementById('asset-search').value.toLowerCase();
    const categoryFilter = document.getElementById('category-filter')?.value || '';
    
    let filtered = assets;
    
    if (searchTerm) {
        filtered = filtered.filter(asset => 
            asset.symbol.toLowerCase().includes(searchTerm) ||
            asset.name.toLowerCase().includes(searchTerm) ||
            asset.address.toLowerCase().includes(searchTerm)
        );
    }

    if (categoryFilter) {
        filtered = filtered.filter(asset => asset.category === categoryFilter);
    }

    document.getElementById('filtered-count').textContent = filtered.length;
    renderAssetList(filtered);
}

function renderAssetList(assetList) {
    const container = document.getElementById('asset-list');

    if (assetList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <p>${assets.length === 0 ? 'Connect wallet to load assets' : 'No assets match your search'}</p>
            </div>
        `;
        return;
    }

    // Limit displayed items for performance (virtual scrolling can be added later)
    const displayLimit = 200;
    const displayedAssets = assetList.slice(0, displayLimit);

    container.innerHTML = displayedAssets.map(asset => {
        const isSelected = selectedAssets.has(asset.address);
        const position = userPositions[asset.address] || {};
        const priceFormatted = asset.price > 0 ? `$${formatUnits(asset.price, 8)}` : 'N/A';
        
        // Calculate user's value in this asset
        const depositValue = position.deposits && asset.price > 0 
            ? formatUnits(position.deposits * asset.price / BigInt(10 ** asset.decimals), 8)
            : '0';

        return `
            <div class="asset-item ${isSelected ? 'selected' : ''}" data-address="${asset.address}" onclick="toggleAssetSelection('${asset.address}')">
                <div class="asset-main">
                    <div class="asset-icon">${asset.symbol.slice(0, 2)}</div>
                    <div class="asset-info">
                        <span class="asset-symbol">${asset.symbol}</span>
                        <span class="asset-name">${asset.name}</span>
                    </div>
                </div>
                <div class="asset-meta">
                    <span class="asset-price">${priceFormatted}</span>
                    ${position.deposits > 0 ? `<span class="asset-deposited">$${depositValue}</span>` : ''}
                </div>
                <div class="asset-select ${isSelected ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
            </div>
        `;
    }).join('');

    if (assetList.length > displayLimit) {
        container.innerHTML += `
            <div class="asset-more">
                <p>Showing ${displayLimit} of ${assetList.length} assets. Use search to narrow results.</p>
            </div>
        `;
    }
}

// ============================================================================
// Asset Selection
// ============================================================================

function toggleAssetSelection(address) {
    const asset = assets.find(a => a.address === address);
    if (!asset) return;

    if (selectedAssets.has(address)) {
        selectedAssets.delete(address);
    } else {
        // Add with default proportion
        selectedAssets.set(address, { asset, proportion: 0 });
        equalizeProportions();
    }

    // Update UI
    updateAssetItemUI(address);
    updateSelectedAssetsPanel();
    updatePreview();
}

function updateAssetItemUI(address) {
    const item = document.querySelector(`.asset-item[data-address="${address}"]`);
    if (!item) return;

    const isSelected = selectedAssets.has(address);
    item.classList.toggle('selected', isSelected);
    item.querySelector('.asset-select').classList.toggle('active', isSelected);
}

function selectAllVisible() {
    const visibleItems = document.querySelectorAll('.asset-item');
    visibleItems.forEach(item => {
        const address = item.dataset.address;
        const asset = assets.find(a => a.address === address);
        if (asset && !selectedAssets.has(address)) {
            selectedAssets.set(address, { asset, proportion: 0 });
        }
    });
    equalizeProportions();
    filterAssets(); // Re-render to show selection
    updateSelectedAssetsPanel();
}

function clearSelection() {
    selectedAssets.clear();
    filterAssets();
    updateSelectedAssetsPanel();
    updatePreview();
}

function updateSelectedAssetsPanel() {
    const container = document.getElementById('selected-assets-list');
    const countEl = document.getElementById('selected-count');
    
    countEl.textContent = `${selectedAssets.size} selected`;

    if (selectedAssets.size === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M12 8v8M8 12h8"/>
                </svg>
                <p>Click assets in the browser to add them here</p>
            </div>
        `;
        updateAllocationDisplay();
        return;
    }

    let html = '';
    for (const [address, { asset, proportion }] of selectedAssets) {
        html += `
            <div class="selected-asset-item" data-address="${address}">
                <div class="selected-asset-info">
                    <span class="selected-asset-symbol">${asset.symbol}</span>
                    <button class="remove-asset-btn" onclick="removeFromSelection('${address}', event)">&times;</button>
                </div>
                <div class="proportion-slider-group">
                    <input type="range" class="proportion-slider" 
                        min="0" max="100" value="${proportion}"
                        oninput="updateProportion('${address}', this.value)">
                    <input type="number" class="proportion-input" 
                        min="0" max="100" value="${proportion}"
                        onchange="updateProportion('${address}', this.value)">
                    <span class="proportion-unit">%</span>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
    updateAllocationDisplay();
}

function removeFromSelection(address, event) {
    event?.stopPropagation();
    selectedAssets.delete(address);
    updateAssetItemUI(address);
    updateSelectedAssetsPanel();
    equalizeProportions();
    updatePreview();
}

function updateProportion(address, value) {
    const data = selectedAssets.get(address);
    if (data) {
        data.proportion = Math.min(100, Math.max(0, parseInt(value) || 0));
        selectedAssets.set(address, data);
        
        // Update both inputs
        const item = document.querySelector(`.selected-asset-item[data-address="${address}"]`);
        if (item) {
            item.querySelector('.proportion-slider').value = data.proportion;
            item.querySelector('.proportion-input').value = data.proportion;
        }
        
        updateAllocationDisplay();
        updatePreview();
    }
}

function equalizeProportions() {
    if (selectedAssets.size === 0) return;

    const equalProp = Math.floor(100 / selectedAssets.size);
    let remainder = 100 - (equalProp * selectedAssets.size);

    for (const [address, data] of selectedAssets) {
        data.proportion = equalProp + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        selectedAssets.set(address, data);
    }

    updateSelectedAssetsPanel();
    updatePreview();
}

function resetProportions() {
    for (const [address, data] of selectedAssets) {
        data.proportion = 0;
        selectedAssets.set(address, data);
    }
    updateSelectedAssetsPanel();
    updatePreview();
}

function updateAllocationDisplay() {
    let total = 0;
    for (const { proportion } of selectedAssets.values()) {
        total += proportion;
    }

    const totalEl = document.getElementById('allocation-total');
    const fillEl = document.getElementById('proportion-fill');

    if (totalEl) {
        totalEl.textContent = `${total}%`;
        totalEl.style.color = total === 100 ? 'var(--success)' : (total > 100 ? 'var(--error)' : 'var(--warning)');
    }

    if (fillEl) {
        fillEl.style.width = `${Math.min(100, total)}%`;
        fillEl.style.background = total === 100 ? 'var(--success)' : (total > 100 ? 'var(--error)' : 'var(--primary)');
    }
}

// ============================================================================
// Operation Switching
// ============================================================================

function switchOperation(op) {
    currentOperation = op;

    // Update tab buttons
    document.querySelectorAll('[data-op]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.op === op);
    });

    // Show correct form
    ['deposit', 'withdraw', 'borrow', 'repay', 'liquidate'].forEach(formOp => {
        const form = document.getElementById(`form-${formOp}`);
        if (form) {
            form.style.display = formOp === op ? 'block' : 'none';
        }
    });

    updatePreview();
}

// ============================================================================
// Transaction Preview
// ============================================================================

function updatePreview() {
    const previewList = document.getElementById('preview-list');
    
    if (selectedAssets.size === 0) {
        previewList.innerHTML = '<p class="muted">Select assets and enter an amount to preview</p>';
        return;
    }

    let total = 0;
    for (const { proportion } of selectedAssets.values()) {
        total += proportion;
    }

    if (total !== 100) {
        previewList.innerHTML = '<p class="muted warning">Allocation must equal 100%</p>';
        return;
    }

    // Get amount from current operation input
    const amountInput = document.getElementById(`${currentOperation}-total`);
    const totalAmount = parseFloat(amountInput?.value || 0);

    if (totalAmount <= 0 && currentOperation !== 'liquidate') {
        previewList.innerHTML = '<p class="muted">Enter an amount to preview transactions</p>';
        return;
    }

    let html = '<div class="preview-transactions">';
    
    for (const [address, { asset, proportion }] of selectedAssets) {
        if (proportion === 0) continue;

        const usdAmount = totalAmount * (proportion / 100);
        let tokenAmount = 'N/A';

        if (asset.price > 0) {
            // Convert USD to tokens: (usdAmount * 10^8 * 10^decimals) / price
            const amountBigInt = BigInt(Math.floor(usdAmount * 1e8)) * BigInt(10 ** asset.decimals) / asset.price;
            tokenAmount = formatUnits(amountBigInt, asset.decimals);
        }

        html += `
            <div class="preview-item">
                <div class="preview-asset">
                    <span class="preview-symbol">${asset.symbol}</span>
                    <span class="preview-proportion">${proportion}%</span>
                </div>
                <div class="preview-amounts">
                    <span class="preview-usd">$${usdAmount.toFixed(2)}</span>
                    <span class="preview-tokens">${tokenAmount} ${asset.symbol}</span>
                </div>
            </div>
        `;
    }

    html += '</div>';
    previewList.innerHTML = html;
}

// ============================================================================
// Batch Operations
// ============================================================================

async function executeBatchOperation(operation) {
    const amountInput = document.getElementById(`${operation}-total`);
    const totalAmount = parseFloat(amountInput?.value || 0);

    if (selectedAssets.size === 0) {
        showToast('Please select at least one asset', 'error');
        return;
    }

    let total = 0;
    for (const { proportion } of selectedAssets.values()) {
        total += proportion;
    }

    if (total !== 100) {
        showToast('Allocation must equal 100%', 'error');
        return;
    }

    if (totalAmount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    showToast(`Executing batch ${operation}...`, 'info');

    try {
        const results = [];
        const errors = [];

        for (const [address, { asset, proportion }] of selectedAssets) {
            if (proportion === 0) continue;

            // Calculate amount for this asset based on USD value and asset price
            let amount;
            if (asset.price > 0) {
                const usdAmount = totalAmount * (proportion / 100);
                amount = BigInt(Math.floor(usdAmount * 1e8)) * BigInt(10 ** asset.decimals) / asset.price;
            } else {
                showToast(`Cannot calculate amount for ${asset.symbol} (no price)`, 'warning');
                continue;
            }

            try {
                await executeAssetOperation(operation, asset, amount);
                results.push({ asset: asset.symbol, status: 'success' });
            } catch (error) {
                console.error(`Error for ${asset.symbol}:`, error);
                errors.push({ asset: asset.symbol, error: error.message });
            }
        }

        // Show results
        if (errors.length === 0) {
            showToast(`Successfully executed ${operation} for ${results.length} assets`, 'success');
        } else if (results.length > 0) {
            showToast(`Completed with ${errors.length} errors. Check console for details.`, 'warning');
        } else {
            showToast(`All operations failed. Check console for details.`, 'error');
        }

        // Refresh data
        await refreshData();
    } catch (error) {
        console.error('Batch operation error:', error);
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function executeAssetOperation(action, asset, amount) {
    const tokenContract = new ethers.Contract(asset.address, ERC20_ABI, signer);
    const poolAddress = await lendingPoolContract.getAddress();

    // Check and approve if needed for deposit/repay
    if (action === 'deposit' || action === 'repay') {
        const allowance = await tokenContract.allowance(await signer.getAddress(), poolAddress);
        if (allowance < amount) {
            showToast(`Approving ${asset.symbol}...`, 'info');
            const approveTx = await tokenContract.approve(poolAddress, ethers.MaxUint256);
            await approveTx.wait();
        }
    }

    let tx;
    switch (action) {
        case 'deposit':
            tx = await lendingPoolContract.deposit(asset.address, amount);
            break;
        case 'withdraw':
            tx = await lendingPoolContract.withdraw(asset.address, amount);
            break;
        case 'borrow':
            tx = await lendingPoolContract.borrow(asset.address, amount);
            break;
        case 'repay':
            tx = await lendingPoolContract.repay(asset.address, amount);
            break;
        default:
            throw new Error('Unknown action');
    }

    showToast(`Waiting for ${action} confirmation...`, 'info');
    await tx.wait();
}

// ============================================================================
// Liquidation
// ============================================================================

function populateLiquidationDropdowns() {
    const debtSelect = document.getElementById('liquidate-debt-asset');
    const collateralSelect = document.getElementById('liquidate-collateral-asset');

    if (!debtSelect || !collateralSelect) return;

    const options = assets.map(a => `<option value="${a.address}">${a.symbol}</option>`).join('');
    debtSelect.innerHTML = '<option value="">Select debt asset</option>' + options;
    collateralSelect.innerHTML = '<option value="">Select collateral</option>' + options;
}

async function executeLiquidation() {
    const borrower = document.getElementById('liquidate-borrower')?.value;
    const debtAsset = document.getElementById('liquidate-debt-asset')?.value;
    const collateralAsset = document.getElementById('liquidate-collateral-asset')?.value;
    const amount = document.getElementById('liquidate-amount')?.value;

    if (!borrower || !debtAsset || !collateralAsset || !amount) {
        showToast('Please fill all liquidation fields', 'error');
        return;
    }

    try {
        showToast('Executing liquidation...', 'info');

        const asset = assets.find(a => a.address === debtAsset);
        const repayAmount = ethers.parseUnits(amount, asset?.decimals || 18);

        // Approve debt asset if needed
        const tokenContract = new ethers.Contract(debtAsset, ERC20_ABI, signer);
        const poolAddress = await lendingPoolContract.getAddress();
        const allowance = await tokenContract.allowance(await signer.getAddress(), poolAddress);

        if (allowance < repayAmount) {
            const approveTx = await tokenContract.approve(poolAddress, ethers.MaxUint256);
            await approveTx.wait();
        }

        const tx = await lendingPoolContract.liquidate(borrower, collateralAsset, debtAsset, repayAmount);
        await tx.wait();

        showToast('Liquidation successful!', 'success');
        await refreshData();
    } catch (error) {
        console.error('Liquidation error:', error);
        showToast(`Liquidation failed: ${error.message}`, 'error');
    }
}

// ============================================================================
// Portfolio & Positions
// ============================================================================

async function updatePortfolio() {
    if (!signer || !lendingPoolContract) {
        document.getElementById('total-collateral').textContent = '$0.00';
        document.getElementById('total-borrowed').textContent = '$0.00';
        document.getElementById('health-factor').textContent = '-';
        document.getElementById('net-worth').textContent = '$0.00';
        return;
    }

    let totalCollateralUSD = BigInt(0);
    let totalBorrowedUSD = BigInt(0);

    for (const asset of assets) {
        const position = userPositions[asset.address];
        if (!position || asset.price === BigInt(0)) continue;

        if (position.deposits > 0) {
            totalCollateralUSD += position.deposits * asset.price / BigInt(10 ** asset.decimals);
        }
        if (position.borrows > 0) {
            totalBorrowedUSD += position.borrows * asset.price / BigInt(10 ** asset.decimals);
        }
    }

    document.getElementById('total-collateral').textContent = '$' + formatUnits(totalCollateralUSD, 8);
    document.getElementById('total-borrowed').textContent = '$' + formatUnits(totalBorrowedUSD, 8);

    // Get health factor
    try {
        const healthFactor = await lendingPoolContract.getHealthFactor(await signer.getAddress());
        const hfFormatted = formatUnits(healthFactor, 18);
        const hfNum = parseFloat(hfFormatted);
        
        const hfEl = document.getElementById('health-factor');
        hfEl.textContent = hfNum > 1000 ? '∞' : hfNum.toFixed(2);
        hfEl.className = `overview-value ${hfNum >= 1.5 ? 'health-good' : (hfNum >= 1.0 ? 'health-warning' : 'health-danger')}`;
    } catch (e) {
        document.getElementById('health-factor').textContent = '-';
    }

    // Net worth = collateral - borrows
    const netWorth = totalCollateralUSD - totalBorrowedUSD;
    document.getElementById('net-worth').textContent = '$' + formatUnits(netWorth >= 0 ? netWorth : BigInt(0), 8);
}

function updatePositionsTable() {
    const tbody = document.getElementById('positions-tbody');
    
    if (!signer) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Connect wallet to view positions</td></tr>';
        return;
    }

    // Filter to assets with positions
    const assetsWithPositions = assets.filter(asset => {
        const pos = userPositions[asset.address];
        return pos && (pos.deposits > 0 || pos.borrows > 0);
    });

    if (assetsWithPositions.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No positions yet</td></tr>';
        return;
    }

    tbody.innerHTML = assetsWithPositions.map(asset => {
        const pos = userPositions[asset.address];
        const priceFormatted = asset.price > 0 ? `$${formatUnits(asset.price, 8)}` : 'N/A';
        const depositsFormatted = formatUnits(pos.deposits, asset.decimals);
        const borrowsFormatted = formatUnits(pos.borrows, asset.decimals);
        const cfFormatted = formatUnits(asset.collateralFactor, 16) + '%';

        return `
            <tr>
                <td>
                    <div class="table-asset">
                        <span class="table-asset-icon">${asset.symbol.slice(0, 2)}</span>
                        <div>
                            <span class="table-asset-symbol">${asset.symbol}</span>
                            <span class="table-asset-name">${asset.name}</span>
                        </div>
                    </div>
                </td>
                <td>${priceFormatted}</td>
                <td>${depositsFormatted}</td>
                <td>${borrowsFormatted}</td>
                <td>${cfFormatted}</td>
                <td>
                    <button class="btn btn-ghost btn-sm" onclick="quickAction('${asset.address}', 'withdraw')">Withdraw</button>
                    <button class="btn btn-ghost btn-sm" onclick="quickAction('${asset.address}', 'repay')">Repay</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function quickAction(address, action) {
    const asset = assets.find(a => a.address === address);
    if (!asset) return;

    const pos = userPositions[address];
    const maxAmount = action === 'withdraw' ? pos?.deposits : pos?.borrows;

    if (!maxAmount || maxAmount === BigInt(0)) {
        showToast(`No ${action === 'withdraw' ? 'deposits' : 'borrows'} to ${action}`, 'warning');
        return;
    }

    const amountStr = prompt(`Enter amount to ${action} (max: ${formatUnits(maxAmount, asset.decimals)} ${asset.symbol}):`);
    if (!amountStr) return;

    try {
        const amount = ethers.parseUnits(amountStr, asset.decimals);
        showToast(`Executing ${action}...`, 'info');
        await executeAssetOperation(action, asset, amount);
        showToast(`${action} successful!`, 'success');
        await refreshData();
    } catch (error) {
        console.error(`${action} error:`, error);
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function refreshData() {
    showToast('Refreshing data...', 'info');
    await loadUserPositions();
    filterAssets();
    updatePositionsTable();
    await updatePortfolio();
    showToast('Data refreshed', 'success');
}

// ============================================================================
// RAG Chat Agent
// ============================================================================

const ragKnowledgeBase = {
    // General
    'what is this': 'This is the Mini-DeFi Multi-Asset Lending Platform. You can deposit assets as collateral, borrow against them, and manage positions across thousands of asset classes.',
    'how does it work': 'The platform allows you to: 1) Deposit assets to earn interest and use as collateral. 2) Borrow other assets against your collateral. 3) Repay loans with interest. 4) Withdraw your deposits. Your health factor must stay above 1.0 to avoid liquidation.',
    
    // Deposit
    'how to deposit': 'To deposit: 1) Click assets in the Asset Browser to select them. 2) Adjust proportions in the Operation Panel (must total 100%). 3) Enter the total USD value. 4) Click "Execute Deposit". Your funds will be distributed across selected assets based on proportions.',
    'deposit': 'Depositing adds your tokens to the lending pool. You earn interest on deposits and can use them as collateral for borrowing.',
    
    // Withdraw
    'how to withdraw': 'To withdraw: 1) Select assets in the browser. 2) Click the "Withdraw" tab. 3) Set proportions and amount. 4) Execute. Note: You can only withdraw if your health factor stays above 1.0.',
    'withdraw': 'Withdrawing removes your deposited tokens from the pool. Ensure you have enough remaining collateral to cover any borrows.',
    
    // Borrow
    'how to borrow': 'To borrow: 1) First, deposit collateral. 2) Select assets to borrow in the browser. 3) Click "Borrow" tab. 4) Set proportions and amount. 5) Execute. Your borrow capacity depends on collateral value and factors.',
    'borrow': 'Borrowing lets you take loans against your deposited collateral. Interest accrues on borrows. Keep your health factor above 1.0.',
    
    // Repay
    'how to repay': 'To repay: 1) Select borrowed assets. 2) Click "Repay" tab. 3) Set proportions and amount. 4) Execute. This reduces your debt and improves your health factor.',
    'repay': 'Repaying reduces your borrowed amount. You need to repay principal plus accrued interest.',
    
    // Health Factor
    'health factor': 'Health Factor = (Total Collateral × Collateral Factor) / Total Borrows. If it drops below 1.0, you can be liquidated. Keep it above 1.5 for safety.',
    'what is health factor': 'The health factor measures your loan safety. Above 1.0 = safe. Below 1.0 = liquidation risk. Higher is better.',
    
    // Liquidation
    'liquidation': 'Liquidation occurs when health factor drops below 1.0. Others can repay your debt and claim your collateral at a discount.',
    'how to avoid liquidation': 'To avoid liquidation: 1) Monitor health factor. 2) Keep it above 1.5. 3) Repay borrows if it drops. 4) Add more collateral. 5) Don\'t max out borrowing.',
    
    // Batch Operations
    'batch': 'Batch operations let you act on multiple assets at once. Select assets, set proportions (must = 100%), enter total USD amount, and execute.',
    'proportions': 'Proportions determine how your amount is distributed. They must sum to 100%. Use sliders or click "Equalize" for even distribution.',
    
    // Interest
    'interest': 'Interest rates are dynamic based on utilization. Higher utilization = higher rates. Depositors earn, borrowers pay.',
    'interest rate': 'Interest follows a kink model: low rates at low utilization, increasing sharply after optimal utilization.',
    
    // Assets
    'how many assets': `The platform supports 10,000+ asset classes. Use the search and category filters to find specific assets.`,
    'search': 'Use the search box to filter by symbol, name, or address. Use category dropdown to filter by asset type.',
    
    // Wallet
    'connect wallet': 'Click "Connect Wallet" in the top right. Approve the connection in MetaMask when prompted.',
    'wallet': 'A Web3 wallet like MetaMask is required. It holds your keys and signs transactions.',
    
    // Help
    'help': 'I can help with: deposits, withdrawals, borrowing, repaying, health factors, liquidation, batch operations, and more. Just ask!',
    'commands': 'Try: "how to deposit", "how to borrow", "what is health factor", "how to avoid liquidation", "batch operations"'
};

function toggleChat() {
    const modal = document.getElementById('chat-modal');
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (!message) return;

    // Add user message
    addChatMessage(message, 'user');
    input.value = '';

    // Generate response
    const response = generateRagResponse(message);
    
    // Simulate typing delay
    setTimeout(() => {
        addChatMessage(response, 'assistant');
    }, 500);
}

function addChatMessage(text, sender) {
    const container = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = `chat-message ${sender}`;
    
    if (sender === 'user') {
        msg.innerHTML = `
            <div class="message-avatar">You</div>
            <div class="message-content"><p>${escapeHtml(text)}</p></div>
        `;
    } else {
        msg.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content"><p>${text}</p></div>
        `;
    }
    
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function generateRagResponse(query) {
    const queryLower = query.toLowerCase();

    // Search knowledge base
    let bestMatch = null;
    let bestScore = 0;

    for (const [key, value] of Object.entries(ragKnowledgeBase)) {
        const keyWords = key.toLowerCase().split(' ');
        let score = 0;

        for (const word of keyWords) {
            if (queryLower.includes(word)) {
                score += word.length;
            }
        }

        if (queryLower.includes(key.toLowerCase())) {
            score += 100;
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = value;
        }
    }

    if (bestMatch && bestScore > 2) {
        return bestMatch;
    }

    // Fallback responses
    if (queryLower.includes('hello') || queryLower.includes('hi')) {
        return 'Hello! I\'m your DeFi assistant. I can help with deposits, borrowing, positions, and more. What would you like to know?';
    }

    if (queryLower.includes('thank')) {
        return 'You\'re welcome! Let me know if you have other questions.';
    }

    return 'I\'m not sure about that. Try asking about: deposits, withdrawing, borrowing, repaying, health factor, liquidation, or batch operations. Say "help" for more options.';
}

// ============================================================================
// Help Modal
// ============================================================================

function showHelp() {
    document.getElementById('help-modal').style.display = 'flex';
}

function hideHelp() {
    document.getElementById('help-modal').style.display = 'none';
}

// ============================================================================
// Toast Notifications
// ============================================================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('status-toast');
    const msgEl = toast.querySelector('.toast-message');
    const iconEl = toast.querySelector('.toast-icon');
    
    msgEl.textContent = message;
    toast.className = `toast toast-${type}`;
    
    // Set icon
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    iconEl.textContent = icons[type] || icons.info;
    
    toast.style.display = 'flex';

    // Auto-hide after 4 seconds
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(hideToast, 4000);
}

function hideToast() {
    const toast = document.getElementById('status-toast');
    toast.style.display = 'none';
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatUnits(value, decimals) {
    if (!value) return '0';
    const str = value.toString();
    if (str === '0') return '0';

    // Handle negative values
    const negative = str.startsWith('-');
    const absStr = negative ? str.slice(1) : str;

    const padded = absStr.padStart(decimals + 1, '0');
    const intPart = padded.slice(0, -decimals) || '0';
    const decPart = padded.slice(-decimals);

    // Trim trailing zeros and limit decimal places
    const trimmed = decPart.replace(/0+$/, '').slice(0, 4);
    const result = trimmed ? `${intPart}.${trimmed}` : intPart;
    return negative ? `-${result}` : result;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Make functions available globally
window.toggleAssetSelection = toggleAssetSelection;
window.removeFromSelection = removeFromSelection;
window.updateProportion = updateProportion;
window.quickAction = quickAction;
window.loadAllAssets = loadAllAssets;
