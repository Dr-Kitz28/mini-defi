const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

// Configuration - adjust as needed
// Default to 10,000 assets, can override with NUM_ASSETS env variable
const NUM_ASSETS = process.env.NUM_ASSETS ? parseInt(process.env.NUM_ASSETS) : 10000;

// Test wallet addresses to fund with tokens (add your MetaMask addresses here)
const TEST_WALLETS = [
  "0xa8a2082b012d8e84fd3463561cd94c15efda3bdd", // User's MetaMask wallet
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Hardhat default deployer
];

// Asset categories with realistic naming - expanded for 10,000+ assets
const ASSET_CATEGORIES = [
  // Stablecoins (various regions and types)
  { prefix: "USD", names: ["USDC", "USDT", "DAI", "BUSD", "TUSD", "USDP", "GUSD", "LUSD", "FRAX", "MIM", "USDD", "USDJ", "UST", "CUSD", "SUSD", "HUSD", "OUSD", "MUSD", "DUSD", "PUSD"], basePrice: 1 },
  { prefix: "EUR", names: ["EURS", "EURT", "EURC", "sEUR", "AGEUR", "CEUR", "JEUR", "PAR", "EURA", "EURB"], basePrice: 1.08 },
  { prefix: "GBP", names: ["GBPT", "sGBP", "GBPC", "TGBP", "BGBP", "CGBP", "DGBP", "EGBP", "FGBP", "GGBP"], basePrice: 1.27 },
  { prefix: "JPY", names: ["JPYC", "GJPY", "sJPY", "TJPY", "BJPY", "CJPY", "DJPY", "EJPY", "FJPY", "HJPY"], basePrice: 0.0067 },
  { prefix: "CNY", names: ["CNHT", "CNYD", "sCNY", "TCNY", "BCNY", "CCNY", "DCNY", "ECNY", "FCNY", "GCNY"], basePrice: 0.14 },
  
  // Major cryptocurrencies
  { prefix: "BTC", names: ["WBTC", "renBTC", "sBTC", "tBTC", "HBTC", "imBTC", "pBTC", "oBTC", "BTCB", "xBTC", "aBTC", "bBTC", "cBTC", "dBTC", "eBTC", "fBTC", "gBTC", "hBTC", "iBTC", "jBTC"], basePrice: 40000 },
  { prefix: "ETH", names: ["WETH", "stETH", "rETH", "cbETH", "frxETH", "ankrETH", "sETH2", "BETH", "aETH", "bETH", "cETH", "dETH", "eETH", "fETH", "gETH", "hETH", "iETH", "jETH", "kETH", "lETH"], basePrice: 2000 },
  { prefix: "SOL", names: ["wSOL", "stSOL", "mSOL", "jitoSOL", "bSOL", "cSOL", "dSOL", "eSOL", "fSOL", "gSOL", "hSOL", "iSOL", "jSOL", "kSOL", "lSOL", "nSOL", "oSOL", "pSOL", "qSOL", "rSOL"], basePrice: 100 },
  { prefix: "BNB", names: ["WBNB", "sBNB", "aBNB", "bBNB", "cBNB", "dBNB", "eBNB", "fBNB", "gBNB", "hBNB", "iBNB", "jBNB", "kBNB", "lBNB", "mBNB", "nBNB", "oBNB", "pBNB", "qBNB", "rBNB"], basePrice: 300 },
  { prefix: "XRP", names: ["wXRP", "sXRP", "aXRP", "bXRP", "cXRP", "dXRP", "eXRP", "fXRP", "gXRP", "hXRP", "iXRP", "jXRP", "kXRP", "lXRP", "mXRP", "nXRP", "oXRP", "pXRP", "qXRP", "rXRP"], basePrice: 0.5 },
  { prefix: "ADA", names: ["wADA", "sADA", "aADA", "bADA", "cADA", "dADA", "eADA", "fADA", "gADA", "hADA", "iADA", "jADA", "kADA", "lADA", "mADA", "nADA", "oADA", "pADA", "qADA", "rADA"], basePrice: 0.4 },
  { prefix: "AVAX", names: ["WAVAX", "sAVAX", "aAVAX", "bAVAX", "cAVAX", "dAVAX", "eAVAX", "fAVAX", "gAVAX", "hAVAX", "iAVAX", "jAVAX", "kAVAX", "lAVAX", "mAVAX", "nAVAX", "oAVAX", "pAVAX", "qAVAX", "rAVAX"], basePrice: 35 },
  { prefix: "DOT", names: ["wDOT", "sDOT", "aDOT", "bDOT", "cDOT", "dDOT", "eDOT", "fDOT", "gDOT", "hDOT", "iDOT", "jDOT", "kDOT", "lDOT", "mDOT", "nDOT", "oDOT", "pDOT", "qDOT", "rDOT"], basePrice: 7 },
  
  // DeFi tokens
  { prefix: "DFI", names: ["AAVE", "UNI", "CRV", "MKR", "COMP", "SNX", "YFI", "SUSHI", "BAL", "1INCH", "DYDX", "LDO", "RPL", "CVX", "FXS", "LQTY", "SPELL", "ALCX", "TRIBE", "RBN"], basePrice: 50 },
  { prefix: "DEX", names: ["CAKE", "JOE", "QUICK", "VELO", "THENA", "AERO", "RTRM", "EQUAL", "SPIRIT", "SPOOK", "BOO", "LQDR", "SOLID", "THE", "CHRONO", "PEARL", "STRA", "DEUS", "RADP", "FUSE"], basePrice: 5 },
  { prefix: "LEND", names: ["RDNT", "GEIST", "TECT", "GRAN", "LEND", "BEND", "VEND", "FEND", "SEND", "MEND", "REND", "WEND", "TEND", "PEND", "DEND", "HEND", "JEND", "KEND", "NEND", "QEND"], basePrice: 0.5 },
  
  // Layer 2 & Scaling
  { prefix: "L2", names: ["ARB", "OP", "MATIC", "IMX", "LRC", "METIS", "BOBA", "ZKS", "STARK", "MINA", "CELO", "NEAR", "FTM", "KAVA", "ONE", "ROSE", "MOVR", "GLMR", "ASTR", "SDN"], basePrice: 1.5 },
  { prefix: "ZK", names: ["ZKF", "ZKML", "ZKP", "ZKR", "ZKT", "ZKV", "ZKW", "ZKX", "ZKY", "ZKZ", "ZKAA", "ZKAB", "ZKAC", "ZKAD", "ZKAE", "ZKAF", "ZKAG", "ZKAH", "ZKAI", "ZKAJ"], basePrice: 0.8 },
  
  // Gaming & Metaverse
  { prefix: "GAME", names: ["AXS", "SAND", "MANA", "ENJ", "GALA", "ILV", "MAGIC", "PRIME", "PIXEL", "BEAM", "BIGTIME", "GODS", "IME", "PYR", "ATLAS", "POLIS", "SLP", "RON", "WEMIX", "NAKA"], basePrice: 2 },
  { prefix: "META", names: ["APE", "BLUR", "LOOKS", "X2Y2", "RARI", "SUPER", "HIGH", "RARE", "DG", "WHALE", "NFT", "PUNK", "BAYC", "MAYC", "AZUKI", "CLONE", "DOOD", "MOON", "COOL", "PUDGY"], basePrice: 3 },
  
  // AI & Data
  { prefix: "AI", names: ["FET", "AGIX", "OCEAN", "NMR", "GRT", "RNDR", "TAO", "ARKM", "WLD", "PRIME", "AIOZ", "CTXC", "DBC", "ORAI", "VIDT", "XCAD", "LPT", "THETA", "TFUEL", "ALEPH"], basePrice: 5 },
  { prefix: "DATA", names: ["LINK", "BAND", "API3", "DIA", "TRB", "UMA", "NEST", "DOS", "ORAI", "RAZOR", "DEXT", "PARSIQ", "GRT", "KYVE", "KWENTA", "SLINKY", "PYTH", "REDSTONE", "COVAL", "DIONE"], basePrice: 15 },
  
  // Infrastructure
  { prefix: "INFRA", names: ["FIL", "AR", "STORJ", "SC", "HOT", "BTT", "ANKR", "GLM", "NKN", "FLUX", "POKT", "LPT", "AIOZ", "ATOR", "NYM", "HOPR", "PRE", "TRAC", "QNT", "ICX"], basePrice: 8 },
  
  // Meme coins
  { prefix: "MEME", names: ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "BRETT", "MOG", "WOJAK", "TURBO", "LADYS", "MILADY", "CHAD", "BOBO", "APED", "BASED", "GIGACHAD", "NORMIE", "PONKE", "POPCAT"], basePrice: 0.0001 },
  { prefix: "DOG", names: ["ELON", "BABYDOGE", "AKITA", "HOGE", "SAMO", "KISHU", "HUSKY", "DOGE2", "SDOG", "TDOG", "FDOG", "GDOG", "HDOG", "IDOG", "JDOG", "KDOG", "LDOG", "MDOG", "NDOG", "ODOG"], basePrice: 0.00001 },
  { prefix: "CAT", names: ["CATE", "PUSSY", "MEOW", "KITTY", "NYAN", "GARFIELD", "TOM", "FELIX", "SIMBA", "MOCHI", "LUNA", "BELLA", "CLEO", "MILO", "OSCAR", "LEO", "MAX", "SHADOW", "TIGGER", "SMOKY"], basePrice: 0.00005 },
  
  // RWA (Real World Assets)
  { prefix: "RWA", names: ["ONDO", "CFG", "MPL", "GFI", "TRU", "CPOOL", "GOLD", "PAXG", "XAUT", "TGLD", "DGX", "PMGT", "KAG", "KAU", "LODE", "CACHE", "AWG", "DGLD", "PERL", "REALIO"], basePrice: 100 },
  { prefix: "STOCK", names: ["TSLA", "AAPL", "GOOGL", "AMZN", "MSFT", "NVDA", "META", "NFLX", "AMD", "INTC", "SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "ARKK", "GME", "AMC", "BB"], basePrice: 150 },
  
  // Privacy coins
  { prefix: "PRIV", names: ["XMR", "ZEC", "DASH", "SCRT", "DERO", "ARRR", "FIRO", "BEAM", "GRIN", "MWC", "PIVX", "ZEN", "NAV", "XVG", "KMD", "DCR", "PART", "GHOST", "OXEN", "VRSC"], basePrice: 50 },
  
  // Exchange tokens
  { prefix: "CEX", names: ["BNB", "FTT", "CRO", "KCS", "HT", "OKB", "GT", "MX", "LEO", "WBT", "BGT", "BAKE", "BIX", "NEXO", "CEL", "CET", "ZB", "BGB", "DYDX", "GMX"], basePrice: 25 },
  
  // Yield tokens
  { prefix: "YIELD", names: ["YFI", "YFII", "YAM", "FARM", "HARVEST", "ALPHA", "BETA", "GAMMA", "DELTA", "EPSILON", "ZETA", "ETA", "THETA", "IOTA", "KAPPA", "LAMBDA", "MU", "NU", "XI", "OMICRON"], basePrice: 20 },
  
  // Synthetic assets
  { prefix: "SYN", names: ["SNX", "SUSD", "SBTC", "SETH", "SLINK", "SAVAX", "SMATIC", "SDOT", "SATOM", "SSOL", "SNEAR", "SFTT", "SUNI", "SAAVE", "SCOMP", "SMKR", "SCRV", "SCVX", "SLDO", "SFXS"], basePrice: 10 },
  
  // Governance tokens
  { prefix: "GOV", names: ["COMP", "UNI", "AAVE", "MKR", "CRV", "BAL", "YFI", "SUSHI", "1INCH", "SNX", "LDO", "RPL", "CVX", "FXS", "FRAX", "LQTY", "SPELL", "ALCX", "TRIBE", "RBN"], basePrice: 30 },
];

// Additional token name generators for reaching 10,000+ unique assets
function generateExtraNames(prefix, count) {
  const names = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluding I and O to avoid confusion
  for (let i = 0; i < count; i++) {
    const suffix = chars[Math.floor(i / 24)] + chars[i % 24];
    names.push(`${prefix}${suffix}`);
  }
  return names;
}

// Expand categories with generated names
const EXPANDED_CATEGORIES = [
  ...ASSET_CATEGORIES,
  { prefix: "TKN", names: generateExtraNames("TKN", 100), basePrice: 1 },
  { prefix: "AST", names: generateExtraNames("AST", 100), basePrice: 2 },
  { prefix: "CRY", names: generateExtraNames("CRY", 100), basePrice: 5 },
  { prefix: "DEF", names: generateExtraNames("DEF", 100), basePrice: 10 },
  { prefix: "FIN", names: generateExtraNames("FIN", 100), basePrice: 20 },
  { prefix: "GEM", names: generateExtraNames("GEM", 100), basePrice: 50 },
  { prefix: "HAV", names: generateExtraNames("HAV", 100), basePrice: 100 },
  { prefix: "INV", names: generateExtraNames("INV", 100), basePrice: 0.5 },
  { prefix: "JET", names: generateExtraNames("JET", 100), basePrice: 0.1 },
  { prefix: "KEY", names: generateExtraNames("KEY", 100), basePrice: 0.01 },
];

function generateAssetList(count) {
  const assets = [];
  let round = 0;
  
  while (assets.length < count) {
    for (const category of EXPANDED_CATEGORIES) {
      for (const name of category.names) {
        if (assets.length >= count) break;
        
        // Add version suffix for rounds beyond the first
        const suffix = round > 0 ? `V${round + 1}` : "";
        const symbol = `${name}${suffix}`.slice(0, 8);
        const fullName = `${name} Token${suffix ? ` Version ${round + 1}` : ""}`;
        
        // Check for duplicates
        if (assets.some(a => a.symbol === symbol)) continue;
        
        // Add some price variation (80% - 120% of base)
        const priceVariation = 0.8 + Math.random() * 0.4;
        const price = category.basePrice * priceVariation;
        
        // Randomize collateral factors between 50% and 85%
        const collateralFactor = 0.5 + Math.random() * 0.35;
        
        // Randomize liquidation bonus between 3% and 12%
        const liquidationBonus = 0.03 + Math.random() * 0.09;
        
        assets.push({
          symbol,
          name: fullName,
          price: price.toFixed(8),
          collateralFactor: collateralFactor.toFixed(4),
          liquidationBonus: liquidationBonus.toFixed(4),
          category: category.prefix,
        });
      }
    }
    round++;
    
    // Safety limit to prevent infinite loop
    if (round > 100) break;
  }
  
  return assets.slice(0, count);
}

async function main() {
  console.log(`🚀 Deploying ${NUM_ASSETS} assets to DeFi Lending Pool...`);
  console.log("This may take a while...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`👤 Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Generate asset configurations
  const assetConfigs = generateAssetList(NUM_ASSETS);
  
  // Deploy Price Oracle
  console.log("📊 Deploying MockPriceOracle...");
  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const priceOracle = await MockPriceOracle.deploy(deployer.address);
  await priceOracle.waitForDeployment();
  const priceOracleAddress = await priceOracle.getAddress();
  console.log(`✅ PriceOracle: ${priceOracleAddress}\n`);

  // Deploy shared Interest Rate Model (can reuse for similar assets)
  console.log("📈 Deploying Interest Rate Models...");
  const KinkInterestRateModel = await ethers.getContractFactory("KinkInterestRateModel");
  
  // Deploy 3 different IRMs for variety
  const irms = [];
  const irmConfigs = [
    { base: "0.02", lowSlope: "0.1", highSlope: "1", kink: "0.8", name: "Conservative" },
    { base: "0.03", lowSlope: "0.15", highSlope: "1.5", kink: "0.75", name: "Moderate" },
    { base: "0.05", lowSlope: "0.2", highSlope: "2", kink: "0.7", name: "Aggressive" },
  ];
  
  for (const config of irmConfigs) {
    const irm = await KinkInterestRateModel.deploy(
      ethers.parseUnits(config.base, 18),
      ethers.parseUnits(config.lowSlope, 18),
      ethers.parseUnits(config.highSlope, 18),
      ethers.parseUnits(config.kink, 18),
      deployer.address
    );
    await irm.waitForDeployment();
    const addr = await irm.getAddress();
    irms.push({ address: addr, name: config.name });
    console.log(`✅ IRM (${config.name}): ${addr}`);
  }

  // Deploy LendingPool
  console.log("\n🏦 Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const pool = await LendingPool.deploy(priceOracleAddress, deployer.address);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`✅ LendingPool: ${poolAddress}\n`);

  // Deploy MockERC20 tokens and list them
  console.log(`🪙 Deploying ${NUM_ASSETS} tokens...\n`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(NUM_ASSETS / 50)} minutes for ${NUM_ASSETS} assets\n`);
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const deployedAssets = {};
  const BATCH_SIZE = 20; // Increased batch size for faster deployment
  const startTime = Date.now();
  
  for (let i = 0; i < assetConfigs.length; i += BATCH_SIZE) {
    const batch = assetConfigs.slice(i, Math.min(i + BATCH_SIZE, assetConfigs.length));
    
    // Deploy tokens in batch
    const deployPromises = batch.map(async (asset) => {
      const token = await MockERC20.deploy(asset.name, asset.symbol);
      await token.waitForDeployment();
      return { asset, token };
    });
    
    const results = await Promise.all(deployPromises);
    
    // Configure each token
    for (const { asset, token } of results) {
      const tokenAddress = await token.getAddress();
      
      // Mint tokens to deployer AND test wallets (1 million tokens each)
      const mintAmount = ethers.parseUnits("1000000", 18);
      await token.mint(deployer.address, mintAmount);
      
      // Mint to all test wallets
      for (const wallet of TEST_WALLETS) {
        try {
          await token.mint(wallet, mintAmount);
        } catch (e) {
          // Ignore if wallet is invalid
        }
      }
      
      // Set price (8 decimals)
      const priceWei = ethers.parseUnits(asset.price, 8);
      await priceOracle.setPrice(tokenAddress, priceWei);
      
      // Select IRM based on category
      const stableCategories = ["USD", "EUR", "GBP", "JPY", "CNY"];
      const majorCategories = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOT"];
      const irmIndex = stableCategories.includes(asset.category) ? 0 : 
                       majorCategories.includes(asset.category) ? 1 : 2;
      const irm = irms[irmIndex];
      
      // List asset in pool
      const collateralFactorWei = ethers.parseUnits(asset.collateralFactor, 18);
      const liquidationBonusWei = ethers.parseUnits(asset.liquidationBonus, 18);
      
      await pool.listAsset(tokenAddress, irm.address, collateralFactorWei, liquidationBonusWei);
      
      deployedAssets[asset.symbol] = {
        token: tokenAddress,
        irm: irm.address,
        name: asset.name,
        price: asset.price,
        collateralFactor: asset.collateralFactor,
        liquidationBonus: asset.liquidationBonus,
        category: asset.category,
      };
    }
    
    const progress = Math.min(i + BATCH_SIZE, assetConfigs.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (progress / elapsed).toFixed(1);
    const eta = ((assetConfigs.length - progress) / rate).toFixed(0);
    console.log(`  ✅ ${progress}/${assetConfigs.length} assets (${elapsed}s elapsed, ~${eta}s remaining)`);
  }

  // Create deployment summary
  const deployedContracts = {
    network: hre.network.name,
    blockNumber: await ethers.provider.getBlockNumber(),
    deployerAddress: deployer.address,
    deployedAt: new Date().toISOString(),
    totalAssets: NUM_ASSETS,
    lendingPool: poolAddress,
    priceOracle: priceOracleAddress,
    interestRateModels: irms,
    assets: deployedAssets,
  };

  // Save to frontend
  fs.writeFileSync(
    "./frontend/deployed-contracts.json",
    JSON.stringify(deployedContracts, null, 2)
  );

  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log(`Total assets deployed: ${NUM_ASSETS}`);
  console.log(`LendingPool: ${poolAddress}`);
  console.log(`PriceOracle: ${priceOracleAddress}`);
  console.log("\n✅ Saved to frontend/deployed-contracts.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Deployment failed:", error);
    process.exit(1);
  });
