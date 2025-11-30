const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

// Configuration - adjust as needed
const NUM_ASSETS = process.env.NUM_ASSETS ? parseInt(process.env.NUM_ASSETS) : 100;

// Test wallet addresses to fund with tokens (add your MetaMask addresses here)
const TEST_WALLETS = [
  "0xa8a2082b012d8e84fd3463561cd94c15efda3bdd", // User's MetaMask wallet
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Hardhat default deployer
];

// Asset categories with realistic naming
const ASSET_CATEGORIES = [
  { prefix: "USD", names: ["USDC", "USDT", "DAI", "BUSD", "TUSD", "USDP", "GUSD", "LUSD", "FRAX", "MIM"], basePrice: 1 },
  { prefix: "BTC", names: ["WBTC", "renBTC", "sBTC", "tBTC", "HBTC", "imBTC", "pBTC", "oBTC"], basePrice: 40000 },
  { prefix: "ETH", names: ["WETH", "stETH", "rETH", "cbETH", "frxETH", "ankrETH", "sETH2", "BETH"], basePrice: 2000 },
  { prefix: "ALT", names: ["LINK", "UNI", "AAVE", "CRV", "MKR", "COMP", "SNX", "YFI", "SUSHI", "BAL"], basePrice: 50 },
  { prefix: "DFI", names: ["CAKE", "JOE", "SPELL", "CVX", "LDO", "RPL", "GMX", "GNS", "RDNT", "PENDLE"], basePrice: 10 },
  { prefix: "L2", names: ["ARB", "OP", "MATIC", "IMX", "LRC", "METIS", "BOBA", "ZKS"], basePrice: 1.5 },
  { prefix: "MEME", names: ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "BRETT", "MOG"], basePrice: 0.0001 },
  { prefix: "RWA", names: ["ONDO", "MKR", "CFG", "MPL", "GFI", "TRU", "CPOOL", "GOLD", "PAXG"], basePrice: 100 },
  { prefix: "AI", names: ["FET", "AGIX", "OCEAN", "NMR", "GRT", "RNDR", "TAO", "ARKM"], basePrice: 5 },
  { prefix: "GAME", names: ["AXS", "SAND", "MANA", "ENJ", "GALA", "ILV", "IMX", "MAGIC"], basePrice: 2 },
];

function generateAssetList(count) {
  const assets = [];
  let idx = 0;
  
  while (assets.length < count) {
    for (const category of ASSET_CATEGORIES) {
      for (const name of category.names) {
        if (assets.length >= count) break;
        
        const suffix = idx > 0 ? `_${Math.floor(idx / ASSET_CATEGORIES.length)}` : "";
        const symbol = `${name}${suffix}`.slice(0, 8);
        const fullName = `${name} Token${suffix ? ` V${Math.floor(idx / ASSET_CATEGORIES.length) + 1}` : ""}`;
        
        // Add some price variation
        const priceVariation = 0.8 + Math.random() * 0.4; // 80% - 120%
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
      idx++;
    }
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
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const deployedAssets = {};
  const BATCH_SIZE = 10;
  
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
      const irmIndex = asset.category === "USD" ? 0 : asset.category === "BTC" || asset.category === "ETH" ? 1 : 2;
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
    
    console.log(`  Deployed ${Math.min(i + BATCH_SIZE, assetConfigs.length)}/${assetConfigs.length} assets...`);
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
