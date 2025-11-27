const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

async function main() {
  console.log("🚀 Starting multi-asset DeFi Lending Pool deployment...");

  // --- 0. Get Deployer & Log Balance ---
  const [deployer] = await ethers.getSigners();
  console.log(`\n👤 Deploying contracts with account: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Account balance: ${ethers.formatEther(balance)} ETH`);

  // --- 1. Deploy Mock Tokens ---
  console.log("\n_Step 1: Deploying Mock ERC20 tokens (TKA & TKB)..._");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const tokenA = await MockERC20.deploy("Token A", "TKA");
  await tokenA.waitForDeployment();
  const tokenAAddress = await tokenA.getAddress();
  console.log(`✅ Token A (TKA) deployed to: ${tokenAAddress}`);

  const tokenB = await MockERC20.deploy("Token B", "TKB");
  await tokenB.waitForDeployment();
  const tokenBAddress = await tokenB.getAddress();
  console.log(`✅ Token B (TKB) deployed to: ${tokenBAddress}`);

  // --- 2. Deploy Price Oracle & Set Prices ---
  console.log("\n_Step 2: Deploying MockPriceOracle and setting prices..._");
  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const priceOracle = await MockPriceOracle.deploy(deployer.address);
  await priceOracle.waitForDeployment();
  const priceOracleAddress = await priceOracle.getAddress();
  console.log(`✅ MockPriceOracle deployed to: ${priceOracleAddress}`);

  // Set prices: TKA = $100, TKB = $2000 (with 8 decimals for oracle)
  await priceOracle.setPrice(tokenAAddress, ethers.parseUnits("100", 8));
  console.log(`📈 Set TKA price to $100`);
  await priceOracle.setPrice(tokenBAddress, ethers.parseUnits("2000", 8));
  console.log(`📈 Set TKB price to $2000`);

  // --- 3. Deploy Interest Rate Models ---
  console.log("\n_Step 3: Deploying Interest Rate Models..._");
  const KinkInterestRateModel = await ethers.getContractFactory("KinkInterestRateModel");

  const irmA = await KinkInterestRateModel.deploy(
    ethers.parseUnits("0.02", 18), // 2% base
    ethers.parseUnits("0.1", 18),  // 10% low slope
    ethers.parseUnits("1", 18),    // 100% high slope
    ethers.parseUnits("0.8", 18),  // 80% kink
    deployer.address
  );
  await irmA.waitForDeployment();
  const irmAAddress = await irmA.getAddress();
  console.log(`✅ IRM for Token A deployed to: ${irmAAddress}`);

  const irmB = await KinkInterestRateModel.deploy(
    ethers.parseUnits("0.03", 18), // 3% base
    ethers.parseUnits("0.15", 18), // 15% low slope
    ethers.parseUnits("1.5", 18),  // 150% high slope
    ethers.parseUnits("0.8", 18),  // 80% kink
    deployer.address
  );
  await irmB.waitForDeployment();
  const irmBAddress = await irmB.getAddress();
  console.log(`✅ IRM for Token B deployed to: ${irmBAddress}`);

  // --- 4. Deploy LendingPool ---
  console.log("\n_Step 4: Deploying LendingPool..._");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const pool = await LendingPool.deploy(priceOracleAddress, deployer.address);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`✅ LendingPool deployed to: ${poolAddress}`);

  // --- 5. List Assets in the Pool ---
  console.log("\n_Step 5: Listing assets in the LendingPool..._");
  // Asset A: 75% collateral factor, 5% liquidation bonus
  await pool.listAsset(tokenAAddress, irmAAddress, ethers.parseUnits("0.75", 18), ethers.parseUnits("0.05", 18));
  console.log(`-> Listed Token A (TKA)`);
  // Asset B: 80% collateral factor, 8% liquidation bonus
  await pool.listAsset(tokenBAddress, irmBAddress, ethers.parseUnits("0.80", 18), ethers.parseUnits("0.08", 18));
  console.log(`-> Listed Token B (TKB)`);

  // --- 6. Log Deployed Addresses & Save to Frontend ---
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE! 🎉");
  console.log("=".repeat(60));
  const deployedContracts = {
    network: hre.network.name,
    blockNumber: await ethers.provider.getBlockNumber(),
    deployerAddress: deployer.address,
    lendingPool: poolAddress,
    priceOracle: priceOracleAddress,
    assets: {
      TKA: {
        token: tokenAAddress,
        irm: irmAAddress,
      },
      TKB: {
        token: tokenBAddress,
        irm: irmBAddress,
      },
    },
  };
  console.log(JSON.stringify(deployedContracts, null, 2));
  console.log("=".repeat(60));

  // Save addresses to a config file for the frontend
  fs.writeFileSync(
    "./frontend/deployed-contracts.json",
    JSON.stringify(deployedContracts, null, 2)
  );
  console.log("\n✅ Contract addresses saved to frontend/deployed-contracts.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Deployment failed:");
    console.error(error);
    process.exit(1);
  });