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

// OpenAI API key - users must set their own key via /setkey command or localStorage
// No default key - use local Mistral-7B model instead (type /local in chat)
let openaiApiKey = localStorage.getItem('openai-api-key') || null;
let chatHistory = [];

// Local RAG server configuration
const LOCAL_RAG_URL = 'http://localhost:5000';
let useLocalRAG = localStorage.getItem('use-local-rag') === 'true';

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

function _initWhenReady() {
    // Ensure initialization runs even if this script is loaded after DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initializeApp();
            setupEventListeners();
        });
    } else {
        // DOM already ready
        initializeApp();
        setupEventListeners();
    }
}

_initWhenReady();

async function initializeApp() {
    console.log('[Mini-DeFi] Initializing app...');
    
    // Initialize theme controls first (for immediate visual feedback)
    initThemeControls();
    
    // Load contract addresses
    try {
        const response = await fetch('deployed-contracts.json');
        if (response.ok) {
            window.deployedContracts = await response.json();
            console.log('[Mini-DeFi] Loaded contracts:', window.deployedContracts);
        } else {
            console.warn('[Mini-DeFi] Failed to load deployed-contracts.json:', response.status);
        }
    } catch (e) {
        console.log('[Mini-DeFi] No deployed contracts found, will prompt for address:', e);
    }

    // Check for existing wallet connection
    if (window.ethereum && window.ethereum.selectedAddress) {
        console.log('[Mini-DeFi] Found existing connection, reconnecting...');
        await connectWallet();
    }

    // Check if we should show help
    if (!localStorage.getItem('mini-defi-help-dismissed')) {
        showHelp();
    }

    // Update network display
    updateNetworkDisplay();
    console.log('[Mini-DeFi] App initialized');
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

    // API Key UI
    document.getElementById('save-api-key')?.addEventListener('click', saveApiKey);
    document.getElementById('clear-api-key')?.addEventListener('click', clearApiKey);
    document.getElementById('api-key-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveApiKey();
    });
    
    // Initialize API key status display
    updateApiKeyStatus();

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
        console.log('[Mini-DeFi] Connecting wallet...');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        console.log('[Mini-DeFi] Connected account:', accounts[0]);

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

        console.log('[Mini-DeFi] Initializing contracts...');
        await initializeContracts();
        console.log('[Mini-DeFi] Contract initialized:', lendingPoolContract?.target);
        
        console.log('[Mini-DeFi] Loading assets...');
        await loadAllAssets();
        console.log('[Mini-DeFi] Loaded', assets.length, 'assets');
        
        await updatePortfolio();
        updateNetworkDisplay();

        showToast('Wallet connected successfully!', 'success');
    } catch (error) {
        console.error('[Mini-DeFi] Connection error:', error);
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
    console.log('[Mini-DeFi] Using pool address:', poolAddress);

    if (!poolAddress) {
        poolAddress = prompt('Enter LendingPool contract address:');
        if (!poolAddress) {
            showToast('LendingPool address required', 'error');
            return;
        }
    }

    lendingPoolContract = new ethers.Contract(poolAddress, LENDING_POOL_ABI, signer);
    console.log('[Mini-DeFi] LendingPool contract created at:', poolAddress);
}

// ============================================================================
// Asset Loading
// ============================================================================

async function loadAllAssets() {
    if (!lendingPoolContract) {
        console.error('[Mini-DeFi] No contract initialized');
        return;
    }

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
        // First try to use pre-loaded asset data from deployed-contracts.json (faster)
        if (window.deployedContracts?.assets) {
            console.log('[Mini-DeFi] Using pre-loaded asset data');
            const assetEntries = Object.entries(window.deployedContracts.assets);
            
            for (const [symbol, assetInfo] of assetEntries) {
                try {
                    const tokenContract = new ethers.Contract(assetInfo.token, ERC20_ABI, signer);
                    const [name, decimals, balance] = await Promise.all([
                        tokenContract.name().catch(() => assetInfo.name || symbol),
                        tokenContract.decimals().catch(() => 18),
                        tokenContract.balanceOf(await signer.getAddress()).catch(() => 0n)
                    ]);
                    
                    assets.push({
                        address: assetInfo.token,
                        symbol: symbol.replace(/_\d+$/, ''), // Remove version suffix like _0, _1
                        name: name,
                        decimals: Number(decimals),
                        price: BigInt(Math.floor((parseFloat(assetInfo.price) || 1) * 1e8)),
                        collateralFactor: parseFloat(assetInfo.collateralFactor) || 0.5,
                        category: assetInfo.category || 'Other',
                        balance: balance
                    });
                    
                    updateAssetCount(assets.length);
                } catch (err) {
                    console.warn('[Mini-DeFi] Failed to load asset', symbol, err);
                }
            }
        } else {
            // Fallback: Load from contract (slower but works without deployed-contracts.json)
            console.log('[Mini-DeFi] Loading assets from contract');
            let index = 0;
            const batchSize = 50;
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
                updateAssetCount(assets.length);
            }
        }

        console.log('[Mini-DeFi] Loaded', assets.length, 'assets');

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
        console.error('[Mini-DeFi] Error loading assets:', error);
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
    const poolAddress = await lendingPoolContract.getAddress();
    userPositions = {};

    // Load positions in batches
    const batchSize = 50;
    for (let i = 0; i < assets.length; i += batchSize) {
        const batch = assets.slice(i, i + batchSize);
        const promises = batch.map(async (asset) => {
            // Default position values
            const position = {
                deposits: BigInt(0),
                borrows: BigInt(0),
                balance: BigInt(0),
                allowance: BigInt(0)
            };

            try {
                // Get deposits and borrows from lending pool (these should always work)
                const [deposits, borrows] = await Promise.all([
                    lendingPoolContract.userDeposits(userAddress, asset.address).catch(() => BigInt(0)),
                    lendingPoolContract.userBorrows(userAddress, asset.address).catch(() => BigInt(0))
                ]);
                position.deposits = deposits;
                position.borrows = borrows;

                // Try to get token balance and allowance - these may fail for invalid/mock tokens
                try {
                    const tokenContract = new ethers.Contract(asset.address, ERC20_ABI, provider);
                    // Check if the contract has code (is a valid contract)
                    const code = await provider.getCode(asset.address);
                    if (code && code !== '0x') {
                        const [balance, allowance] = await Promise.all([
                            tokenContract.balanceOf(userAddress).catch(() => BigInt(0)),
                            tokenContract.allowance(userAddress, poolAddress).catch(() => BigInt(0))
                        ]);
                        position.balance = balance;
                        position.allowance = allowance;
                    }
                } catch (tokenErr) {
                    // Token contract calls failed - use defaults
                    console.debug(`[Mini-DeFi] Token ${asset.symbol} contract call failed:`, tokenErr.message);
                }
            } catch (e) {
                console.debug(`[Mini-DeFi] Failed to load position for ${asset.symbol}:`, e.message);
            }

            userPositions[asset.address] = position;
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
        const priceFormatted = asset.price > 0n ? `$${formatUnits(asset.price, 8)}` : 'N/A';
        
        // Calculate user's value in this asset
        const depositValue = position.deposits && asset.price > 0n 
            ? formatUnits(position.deposits * asset.price / (10n ** BigInt(asset.decimals)), 8)
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
    if (!signer) {
        showToast('Please connect your wallet first', 'warning');
        return;
    }
    
    const asset = assets.find(a => a.address === address);
    if (!asset) {
        showToast('Asset not found. Try refreshing.', 'error');
        return;
    }

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

        if (asset.price > 0n) {
            // Convert USD to tokens: (usdAmount * 10^8 * 10^decimals) / price
            const amountBigInt = BigInt(Math.floor(usdAmount * 1e8)) * (10n ** BigInt(asset.decimals)) / asset.price;
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
        const skipped = [];

        for (const [address, { asset, proportion }] of selectedAssets) {
            if (proportion === 0) continue;

            // Calculate amount for this asset based on USD value and asset price
            let amount;
            if (asset.price > 0n) {
                const usdAmount = totalAmount * (proportion / 100);
                amount = BigInt(Math.floor(usdAmount * 1e8)) * (10n ** BigInt(asset.decimals)) / asset.price;
            } else {
                console.warn(`[Mini-DeFi] Skipping ${asset.symbol} - no price data`);
                skipped.push({ asset: asset.symbol, reason: 'No price data' });
                continue;
            }

            const result = await executeAssetOperation(operation, asset, amount);
            if (result?.skipped) {
                skipped.push({ asset: asset.symbol, reason: result.reason });
            } else {
                results.push({ asset: asset.symbol, status: 'success' });
            }
        }

        // Show results
        if (results.length > 0 && skipped.length === 0) {
            showToast(`Successfully executed ${operation} for ${results.length} assets`, 'success');
        } else if (results.length > 0) {
            showToast(`${operation} completed for ${results.length} assets (${skipped.length} skipped)`, 'success');
        } else if (skipped.length > 0) {
            showToast(`All ${skipped.length} assets were skipped. Try deploying contracts first.`, 'warning');
        } else {
            showToast(`No operations performed.`, 'warning');
        }

        // Refresh data
        await refreshData();
    } catch (error) {
        console.error('Batch operation error:', error);
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function executeAssetOperation(action, asset, amount) {
    const poolAddress = await lendingPoolContract.getAddress();
    const userAddress = await signer.getAddress();

    // Verify the token contract is valid before proceeding
    const code = await provider.getCode(asset.address);
    if (!code || code === '0x') {
        // Skip this token silently - it's not deployed on the current network
        console.warn(`[Mini-DeFi] Skipping ${asset.symbol} - contract not deployed at ${asset.address}`);
        return { skipped: true, reason: 'Contract not deployed' };
    }

    const tokenContract = new ethers.Contract(asset.address, ERC20_ABI, signer);

    // Check and approve if needed for deposit/repay
    if (action === 'deposit' || action === 'repay') {
        try {
            const allowance = await tokenContract.allowance(userAddress, poolAddress);
            if (allowance < amount) {
                showToast(`Approving ${asset.symbol}...`, 'info');
                const approveTx = await tokenContract.approve(poolAddress, ethers.MaxUint256);
                await approveTx.wait();
            }
        } catch (approvalErr) {
            console.warn(`[Mini-DeFi] Approval failed for ${asset.symbol}:`, approvalErr.message);
            return { skipped: true, reason: 'Approval failed' };
        }
    }

    let tx;
    try {
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
        return { success: true };
    } catch (txErr) {
        console.warn(`[Mini-DeFi] Transaction failed for ${asset.symbol}:`, txErr.message);
        return { skipped: true, reason: txErr.message };
    }
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
        if (!position || asset.price === 0n) continue;

        if (position.deposits > 0n) {
            totalCollateralUSD += position.deposits * asset.price / (10n ** BigInt(asset.decimals));
        }
        if (position.borrows > 0n) {
            totalBorrowedUSD += position.borrows * asset.price / (10n ** BigInt(asset.decimals));
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
        hfEl.textContent = hfNum > 1000 ? 'MAX' : hfNum.toFixed(2);
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
        const priceFormatted = asset.price > 0n ? `$${formatUnits(asset.price, 8)}` : 'N/A';
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
// RAG Chat Agent with OpenAI Integration
// ============================================================================

// System prompt with comprehensive knowledge about the platform
const SYSTEM_PROMPT = `You are an AI assistant for the Mini-DeFi Multi-Asset Lending Platform. You help users understand and use the platform effectively. You are also a helpful general assistant that can answer questions about cryptocurrency, blockchain, DeFi concepts, and general knowledge.

## Platform Overview
Mini-DeFi is a decentralized lending platform supporting 10,000+ asset classes. Users can:
- Deposit assets to earn interest and use as collateral
- Borrow assets against their collateral
- Manage positions across multiple assets with batch operations
- Monitor their health factor to avoid liquidation

## Key Features

### Asset Browser (Left Sidebar)
- Search assets by symbol, name, or contract address
- Filter by category: Stablecoins, Bitcoin, Ethereum, DeFi, Meme coins, L2 tokens
- Click assets to select them for batch operations
- Shows current price and user's deposited value

### Portfolio Overview
- Total Collateral: Sum of all deposited assets in USD
- Total Borrowed: Sum of all borrowed assets in USD
- Health Factor: Ratio measuring loan safety (must stay above 1.0)
- Net Worth: Collateral minus borrowed amounts

### Operations Panel
Five operations available:
1. **Deposit**: Supply assets to earn interest. Select assets, set proportions (must = 100%), enter USD amount, execute.
2. **Withdraw**: Remove deposited assets. Must maintain health factor above 1.0.
3. **Borrow**: Take loans against collateral. Interest accrues over time.
4. **Repay**: Pay back borrowed amounts plus interest.
5. **Liquidate**: Liquidate unhealthy positions (health factor < 1.0).

### Batch Operations
- Select multiple assets in the browser
- Set proportion for each (must total 100%)
- Enter total USD amount
- Platform distributes operation across selected assets

### Health Factor
- Formula: (Total Collateral x Collateral Factor) / Total Borrows
- Above 1.5: Safe (green)
- 1.0 - 1.5: Caution (yellow)
- Below 1.0: Liquidation risk (red)
- Tips: Don't max out borrowing, monitor regularly, add collateral if dropping

### Interest Rates
- Dynamic based on utilization (borrowed / deposited)
- Kink model: Low rates at low utilization, sharp increase after optimal point
- Depositors earn interest, borrowers pay interest

### Wallet Connection
- Click "Connect Wallet" button
- Approve connection in MetaMask
- Supported networks: Ethereum, Polygon, Hardhat local

## General Knowledge
You can also answer general questions about:
- Cryptocurrency and blockchain technology
- DeFi concepts (liquidity pools, AMMs, yield farming, etc.)
- Smart contracts and Ethereum
- Web3 and decentralized applications
- General knowledge questions unrelated to DeFi

## User's Current Context
${(() => {
    let context = '';
    if (assets.length > 0) context += `- ${assets.length} assets loaded\n`;
    if (selectedAssets.size > 0) context += `- ${selectedAssets.size} assets currently selected\n`;
    return context || '- No wallet connected yet';
})()}

Be helpful, concise, and friendly. You can answer questions about both the platform AND general topics. If asked about something outside your knowledge, be honest about limitations.`;

function toggleChat() {
    const modal = document.getElementById('chat-modal');
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
    
    // Update API key status when opening
    if (modal.style.display === 'flex') {
        updateApiKeyStatus();
        if (!openaiApiKey) {
            setTimeout(() => {
                addChatMessage('Welcome! To enable AI-powered assistance, enter your OpenAI API key in the settings above. Your key is stored locally only.', 'assistant');
            }, 300);
        }
    }
}

function saveApiKey() {
    console.log('[Mini-DeFi] saveApiKey called');
    const input = document.getElementById('api-key-input');
    const key = input.value.trim();
    console.log('[Mini-DeFi] Key length:', key.length);
    
    if (!key) {
        showToast('Please enter an API key', 'warning');
        return;
    }
    
    if (!key.startsWith('sk-')) {
        showToast('Invalid API key format. Keys start with "sk-"', 'error');
        return;
    }
    
    openaiApiKey = key;
    localStorage.setItem('openai-api-key', key);
    input.value = '';
    updateApiKeyStatus();
    addChatMessage('API key saved! You now have full AI assistance.', 'assistant');
    showToast('API key saved successfully', 'success');
}

function clearApiKey() {
    openaiApiKey = '';
    localStorage.removeItem('openai-api-key');
    chatHistory = [];
    document.getElementById('api-key-input').value = '';
    updateApiKeyStatus();
    addChatMessage('API key cleared. Using basic responses.', 'assistant');
    showToast('API key cleared', 'info');
}

function updateApiKeyStatus() {
    const statusEl = document.getElementById('api-key-status');
    if (!statusEl) return;
    
    if (openaiApiKey) {
        statusEl.textContent = 'API key connected - Full AI assistance enabled';
        statusEl.className = 'api-key-status connected';
    } else {
        statusEl.textContent = 'No API key set - Using basic responses';
        statusEl.className = 'api-key-status';
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (!message) return;

    // Add user message to UI
    addChatMessage(message, 'user');
    input.value = '';

    // Legacy command support (still works)
    if (message.toLowerCase().startsWith('/setkey ')) {
        const key = message.substring(8).trim();
        if (key.startsWith('sk-')) {
            openaiApiKey = key;
            localStorage.setItem('openai-api-key', key);
            updateApiKeyStatus();
            addChatMessage('API key saved successfully! You can now chat with AI assistance.', 'assistant');
        } else {
            addChatMessage('Invalid API key format. OpenAI keys start with "sk-".', 'assistant');
        }
        return;
    }

    if (message.toLowerCase() === '/clearkey') {
        clearApiKey();
        return;
    }
    
    // Command: /local - Toggle local RAG mode
    if (message.toLowerCase() === '/local') {
        toggleLocalRAG();
        return;
    }
    
    // Command: /status - Show current AI mode status
    if (message.toLowerCase() === '/status') {
        const mode = useLocalRAG ? 'Local Mistral-7B (offline)' : 'OpenAI API';
        const localHealthy = await checkLocalRAGHealth();
        const localStatus = localHealthy ? '✅ Running' : '❌ Not running';
        addChatMessage(
            `**AI Mode Status:**\n\n` +
            `• Current mode: **${mode}**\n` +
            `• Local RAG server: ${localStatus}\n` +
            `• OpenAI key: ${openaiApiKey ? '✅ Set' : '❌ Not set'}\n\n` +
            `Commands: \`/local\` to toggle mode, \`/setkey\` to set API key`,
            'assistant'
        );
        return;
    }

    // Show typing indicator
    const typingId = showTypingIndicator();

    try {
        let response;
        
        // Try local RAG first if enabled
        if (useLocalRAG) {
            const localHealthy = await checkLocalRAGHealth();
            if (localHealthy) {
                response = await getLocalRAGResponse(message);
            } else {
                // Local server not running, fallback to pattern-based
                removeTypingIndicator(typingId);
                addChatMessage(
                    '⚠️ **Local RAG server not running.**\n\n' +
                    'Start it with: `python scripts/local_rag_server.py`\n\n' +
                    'Falling back to built-in responses...',
                    'assistant'
                );
                response = generateLocalResponse(message);
                addChatMessage(response, 'assistant');
                return;
            }
        } else if (openaiApiKey) {
            response = await getOpenAIResponse(message);
        } else {
            response = generateLocalResponse(message);
        }
        
        removeTypingIndicator(typingId);
        addChatMessage(response, 'assistant');
    } catch (error) {
        removeTypingIndicator(typingId);
        console.error('Chat error:', error);
        
        if (error.message.includes('401')) {
            addChatMessage('❌ **Invalid API key.** Please check your OpenAI API key.\n\nType `/setkey YOUR_KEY` to set a new key.', 'assistant');
        } else if (error.message.includes('429')) {
            addChatMessage('⏳ **Rate limit reached.** The API quota has been exceeded.\n\nPlease wait a moment and try again, or check your OpenAI billing.\n\n**Tip:** Type `/local` to switch to local AI mode (no API needed).', 'assistant');
        } else if (error.message.includes('insufficient_quota')) {
            addChatMessage('💳 **API quota exceeded.** Your OpenAI account has no remaining credits.\n\nPlease add credits at platform.openai.com or use a different API key.\n\n**Tip:** Type `/local` to switch to local AI mode (no API needed).', 'assistant');
        } else {
            // Show error but also provide local response
            console.error('OpenAI error, falling back to local:', error.message);
            const localResponse = generateLocalResponse(message);
            addChatMessage(localResponse + '\n\n*(Using offline mode due to API error)*', 'assistant');
        }
    }
}

async function getOpenAIResponse(userMessage) {
    // Add user message to history
    chatHistory.push({ role: 'user', content: userMessage });
    
    // Keep only last 10 messages for context
    if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(-20);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...chatHistory
            ],
            max_tokens: 500,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        console.error('OpenAI API Error:', errorMessage);
        throw new Error(`OpenAI API error: ${response.status} - ${errorMessage}`);
    }

    const data = await response.json();
    const assistantMessage = data.choices[0].message.content;
    
    // Add assistant response to history
    chatHistory.push({ role: 'assistant', content: assistantMessage });
    
    return assistantMessage;
}

async function getLocalRAGResponse(userMessage) {
    /**
     * Calls the local RAG server (Mistral-7B + FAISS).
     * Server must be running: python scripts/local_rag_server.py
     */
    try {
        const response = await fetch(`${LOCAL_RAG_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });
        
        if (!response.ok) {
            throw new Error(`Local RAG server error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.response || data.answer || data.message;
    } catch (error) {
        console.error('Local RAG error:', error);
        throw error;
    }
}

async function checkLocalRAGHealth() {
    /**
     * Check if local RAG server is running and healthy.
     */
    try {
        const response = await fetch(`${LOCAL_RAG_URL}/health`, { 
            method: 'GET',
            signal: AbortSignal.timeout(2000) // 2 second timeout
        });
        return response.ok;
    } catch {
        return false;
    }
}

function toggleLocalRAG() {
    useLocalRAG = !useLocalRAG;
    localStorage.setItem('use-local-rag', useLocalRAG ? 'true' : 'false');
    const mode = useLocalRAG ? 'Local Mistral-7B (offline)' : 'OpenAI API';
    addChatMessage(`✅ Switched to **${mode}** mode.`, 'assistant');
}

function generateLocalResponse(query) {
    const q = query.toLowerCase();

    // Comprehensive knowledge base - no API key needed for basic help
    const responses = [
        // Greetings
        { match: /^(hi|hello|hey|howdy|greetings)/i, 
          response: "Hello! I'm your Mini-DeFi assistant. I can help you with:\n\n• **Depositing** assets to earn interest\n• **Borrowing** against your collateral\n• **Understanding** health factors & liquidation\n• **Managing** your DeFi portfolio\n\nWhat would you like to know?" },
        
        // Deposit questions
        { match: /how.*(deposit|supply|add funds|put money)/i,
          response: "**How to Deposit:**\n\n1) **Select Assets** - Click on assets in the left sidebar (Asset Browser)\n2) **Set Proportions** - Adjust how much goes to each asset (must total 100%)\n3) **Enter Amount** - Type the USD value in the Deposit panel\n4) **Execute** - Click 'Execute Deposit' and confirm in MetaMask\n\nTip: Use 'Equalize' to split evenly across selected assets!" },
        
        // Withdraw questions  
        { match: /how.*(withdraw|remove|take out)/i,
          response: "**How to Withdraw:**\n\n1) Select assets you've deposited in the Asset Browser\n2) Click the **Withdraw** tab in the Operation Panel\n3) Set proportions and enter amount to withdraw\n4) Click 'Execute Withdraw'\n\n**Important:** Withdrawing reduces collateral. Keep your Health Factor above 1.0 to avoid liquidation!" },
        
        // Borrow questions
        { match: /how.*(borrow|take loan|get loan)/i,
          response: "**How to Borrow:**\n\n1) First, deposit assets as collateral\n2) Select assets you want to borrow from Asset Browser\n3) Click the **Borrow** tab\n4) Enter amount (limited by your collateral x collateral factor)\n5) Execute and confirm\n\nYour borrowing power = Collateral Value x Collateral Factor" },
        
        // Repay questions
        { match: /how.*(repay|pay back|return)/i,
          response: "**How to Repay:**\n\n1) Select the assets you borrowed\n2) Click the **Repay** tab\n3) Set the amount to repay (including interest owed)\n4) Execute the transaction\n\nRepaying debt improves your Health Factor and frees up borrowing capacity." },
        
        // Health Factor
        { match: /health factor|health score/i,
          response: "**Health Factor Explained:**\n\n**Formula:** Health Factor = (Collateral x Collateral Factor) / Total Borrows\n\n- **Above 1.5** - Safe zone\n- **1.0 - 1.5** - Caution zone\n- **Below 1.0** - Liquidation risk!\n\n**Example:** $1000 collateral with 75% factor, $500 borrowed = HF of 1.5" },
        
        // Liquidation
        { match: /liquidat/i,
          response: "**Liquidation Explained:**\n\nLiquidation occurs when your Health Factor drops below 1.0.\n\n**What happens:**\n- Anyone can repay part of your debt\n- They receive your collateral at a discount (liquidation bonus)\n- You lose collateral but reduce debt\n\n**How to avoid:**\n- Keep Health Factor above 1.5\n- Monitor asset prices\n- Repay debt if HF drops" },
        
        // Collateral Factor
        { match: /collateral factor/i,
          response: "**Collateral Factor:**\n\nThe collateral factor (50-85%) determines how much you can borrow against an asset.\n\n**Example:**\n- Deposit $1000 USDC (75% collateral factor)\n- Maximum borrow = $1000 x 0.75 = $750\n\nStablecoins typically have higher factors (safer), volatile assets have lower factors." },
        
        // Interest rates
        { match: /interest|rate|apy|yield/i,
          response: "**Interest Rates:**\n\nInterest rates are dynamic based on **utilization** (borrowed/deposited):\n\n- **Low utilization** = Lower rates\n- **High utilization** = Higher rates\n\n**Depositors** earn interest (supply APY)\n**Borrowers** pay interest (borrow APY)\n\nRates adjust automatically to balance supply and demand." },
        
        // Batch operations
        { match: /batch|multiple|several assets/i,
          response: "**Batch Operations:**\n\nSelect multiple assets to deposit/withdraw/borrow/repay in one transaction!\n\n1) Click multiple assets in the Asset Browser\n2) Set proportions for each (total must = 100%)\n3) Click 'Equalize' to split evenly\n4) Enter total amount and execute\n\nSaves gas vs. individual transactions!" },
        
        // Connect wallet
        { match: /connect|wallet|metamask/i,
          response: "**Connecting Your Wallet:**\n\n1) Click **'Connect Wallet'** in the top-right corner\n2) Select MetaMask (or your wallet)\n3) Approve the connection request\n\n**Network:** Make sure you're on the correct network (Hardhat Local for testing)\n\nYour wallet address will appear once connected." },
        
        // What is this / getting started
        { match: /what is|getting started|new here|explain|tutorial/i,
          response: "**Welcome to Mini-DeFi!**\n\nThis is a decentralized lending platform where you can:\n\n- **Deposit** assets to earn interest\n- **Borrow** against your deposits\n- **Manage** a multi-asset portfolio\n\n**Getting Started:**\n1) Connect your wallet\n2) Deposit some assets as collateral\n3) (Optional) Borrow against your collateral\n4) Monitor your Health Factor\n\nAsk me about any specific feature!" },
        
        // Assets / tokens
        { match: /asset|token|coin|which/i,
          response: "**Available Assets:**\n\nThe platform supports 100+ assets across categories:\n\n• **USD Stablecoins:** USDC, USDT, DAI, etc.\n• **BTC Derivatives:** WBTC, renBTC, etc.\n• **ETH Derivatives:** WETH, stETH, rETH, etc.\n• **DeFi Tokens:** AAVE, UNI, CRV, etc.\n• **Layer 2:** ARB, OP, MATIC, etc.\n\nUse the category filter to browse, or search by name!" },
        
        // Price / oracle
        { match: /price|oracle|value/i,
          response: "**Price Feeds:**\n\nAsset prices come from our Price Oracle contract. Prices update when you:\n\n• Deposit or withdraw\n• Borrow or repay\n• Refresh the dashboard\n\nPrices affect your collateral value and Health Factor, so monitor them closely!" },
        
        // Thanks
        { match: /thank|thanks|thx/i,
          response: "You're welcome! Feel free to ask if you have more questions about DeFi lending, health factors, or anything else!" },
          
        // Help with website
        { match: /help.*(website|site|page|figur|understand|use|navigate)/i,
          response: "**Welcome! Here's how to use Mini-DeFi:**\n\n**1. Connect Wallet** (top right button)\n- Click 'Connect Wallet' and approve in MetaMask\n- Make sure you're on Hardhat Local network\n\n**2. Browse Assets** (left sidebar)\n- Click on assets to select them\n- Use search or category filter\n\n**3. Perform Operations**\n- **Deposit:** Supply tokens to earn interest\n- **Borrow:** Take loans against collateral\n- **Withdraw/Repay:** Manage your positions\n\n**4. Monitor Health Factor**\n- Keep it above 1.0 to avoid liquidation\n- Higher is safer (aim for 1.5+)\n\nWhat would you like to learn more about?" },
          
        // General/generic questions
        { match: /^(help|assist|support|guide|show)/i,
          response: "I'm here to help! I can assist you with:\n\n**Platform Operations:**\n• How to deposit assets\n• How to borrow tokens\n• Managing withdrawals & repayments\n\n**Understanding DeFi:**\n• Health Factor explained\n• Collateral & liquidation\n• Interest rates\n\n**Technical Help:**\n• Connecting your wallet\n• Selecting assets\n• Batch operations\n\nJust ask me anything!" }
    ];

    // Find matching response
    for (const item of responses) {
        if (item.match.test(q)) {
            return item.response;
        }
    }

    // Default response with suggestions
    return "I'm your Mini-DeFi assistant! Here are some things I can help with:\n\n• **\"Help me with the website\"** - Platform walkthrough\n• **\"How do I deposit?\"** - Step-by-step guide\n• **\"What is health factor?\"** - Understand liquidation risk\n• **\"How to borrow?\"** - Borrowing tutorial\n• **\"Getting started\"** - Platform overview\n\nJust ask a question and I'll guide you!";
}

function addChatMessage(text, sender) {
    const container = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = `chat-message ${sender}`;
    
    // Convert markdown-like formatting to HTML
    const formattedText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>')
        .replace(/(\d+)\)/g, '<br>$1)');
    
    if (sender === 'user') {
        msg.innerHTML = `
            <div class="message-avatar">You</div>
            <div class="message-content"><p>${escapeHtml(text)}</p></div>
        `;
    } else {
        msg.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content"><p>${formattedText}</p></div>
        `;
    }
    
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.className = 'chat-message assistant typing-indicator';
    indicator.id = 'typing-' + Date.now();
    indicator.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-content">
            <div class="typing-dots">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
    return indicator.id;
}

function removeTypingIndicator(id) {
    const indicator = document.getElementById(id);
    if (indicator) indicator.remove();
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
        success: '[OK]',
        error: '[X]',
        warning: '[!]',
        info: '[i]'
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

// ============================================================================
// Theme & Contrast Controls
// ============================================================================

/**
 * Initialize theme and contrast controls
 * Loads saved preferences from localStorage
 */
function initThemeControls() {
    const themeDayBtn = document.getElementById('theme-day');
    const themeNightBtn = document.getElementById('theme-night');
    const contrastSlider = document.getElementById('contrast-slider');
    
    // Load saved preferences
    const savedTheme = localStorage.getItem('mini-defi-theme') || 'night';
    const savedContrast = localStorage.getItem('mini-defi-contrast') || '1';
    
    // Apply saved theme
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeModeButtons(savedTheme);
    
    // Apply saved contrast
    if (contrastSlider) {
        contrastSlider.value = savedContrast;
    }
    applyContrast(savedContrast);
    
    // Add event listeners for theme buttons
    themeDayBtn?.addEventListener('click', () => setTheme('day'));
    themeNightBtn?.addEventListener('click', () => setTheme('night'));
    
    // Add event listener for contrast slider
    contrastSlider?.addEventListener('input', (e) => applyContrast(e.target.value));
    
    console.log(`[Mini-DeFi] Theme controls initialized: theme=${savedTheme}, contrast=${savedContrast}`);
}

/**
 * Set the current theme (day or night)
 */
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mini-defi-theme', theme);
    updateThemeModeButtons(theme);
    console.log(`[Mini-DeFi] Theme changed to: ${theme}`);
}

/**
 * Update theme mode buttons (Day/Night toggle)
 */
function updateThemeModeButtons(theme) {
    const themeDayBtn = document.getElementById('theme-day');
    const themeNightBtn = document.getElementById('theme-night');
    
    if (theme === 'day') {
        themeDayBtn?.classList.add('active');
        themeNightBtn?.classList.remove('active');
    } else {
        themeDayBtn?.classList.remove('active');
        themeNightBtn?.classList.add('active');
    }
}

/**
 * Apply contrast level
 * @param {string} level - 0 = Low, 1 = Medium, 2 = High, 3 = Very High
 */
function applyContrast(level) {
    const levels = ['low', 'medium', 'high', 'very-high'];
    const labels = ['Low', 'Medium', 'High', 'Very High'];
    const contrastValue = document.getElementById('contrast-value');
    
    const levelIndex = parseInt(level) || 1;
    const contrastLevel = levels[levelIndex] || 'medium';
    
    document.documentElement.setAttribute('data-contrast', contrastLevel);
    
    if (contrastValue) {
        contrastValue.textContent = labels[levelIndex] || 'Medium';
    }
    
    localStorage.setItem('mini-defi-contrast', level.toString());
}

// Make functions available globally
window.toggleAssetSelection = toggleAssetSelection;
window.removeFromSelection = removeFromSelection;
window.updateProportion = updateProportion;
window.quickAction = quickAction;
window.loadAllAssets = loadAllAssets;
window.setTheme = setTheme;
window.applyContrast = applyContrast;
