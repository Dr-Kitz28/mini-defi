const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Starting DeFi Lending Pool deployment...\n");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Deploy MockERC20 token first
  console.log("📄 Deploying MockERC20 token...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Test Token", "TEST");
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("✅ MockERC20 deployed to:", tokenAddress);

  // Mint some tokens to the deployer for testing
  const mintAmount = ethers.parseEther("1000000"); // 1 million tokens
  await token.mint(deployer.address, mintAmount);
  console.log("🪙 Minted", ethers.formatEther(mintAmount), "TEST tokens to deployer\n");

  // Deploy interest rate model (using KinkInterestRateModel as default)
  console.log("📈 Deploying KinkInterestRateModel...");
  const KinkInterestRateModel = await ethers.getContractFactory("KinkInterestRateModel");
  const irm = await KinkInterestRateModel.deploy(
    ethers.parseUnits("2", 16),   // 2% base APR
    ethers.parseUnits("10", 16),  // 10% slope APR (low)
    ethers.parseUnits("300", 16), // 300% slope APR (high)
    ethers.parseUnits("80", 16)   // 80% optimal utilization
  );
  await irm.waitForDeployment();
  const irmAddress = await irm.getAddress();
  console.log("✅ KinkInterestRateModel deployed to:", irmAddress);

  // Deploy LendingPool
  console.log("🏦 Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const pool = await LendingPool.deploy(
    tokenAddress,  // underlying token
    irmAddress,    // interest rate model
    ethers.parseUnits("75", 16)  // 75% collateral factor
  );
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log("✅ LendingPool deployed to:", poolAddress);

  // Display deployment summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("📄 MockERC20 Token:", tokenAddress);
  console.log("📈 Interest Rate Model:", irmAddress);
  console.log("🏦 Lending Pool:", poolAddress);
  console.log("=".repeat(60));
  console.log("\n📋 FRONTEND CONFIGURATION:");
  console.log("Token Contract Address:", tokenAddress);
  console.log("Pool Contract Address:", poolAddress);
  console.log("\n🔧 NEXT STEPS:");
  console.log("1. Copy the addresses above into the frontend");
  console.log("2. Make sure MetaMask is connected to localhost:8545");
  console.log("3. Import the token to MetaMask using the token address");
  console.log("4. Start interacting with the DeFi protocol!");

  // Save addresses to a config file for the frontend
  const config = {
    network: "localhost",
    tokenAddress: tokenAddress,
    poolAddress: poolAddress,
    irmAddress: irmAddress,
    deployerAddress: deployer.address,
    blockNumber: await ethers.provider.getBlockNumber()
  };

  const fs = require("fs");
  fs.writeFileSync("./frontend/deployed-contracts.json", JSON.stringify(config, null, 2));
  console.log("\n💾 Contract addresses saved to frontend/deployed-contracts.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });