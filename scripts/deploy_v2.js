const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // 1. Deploy StakingToken
    const stakingTokenFactory = await ethers.getContractFactory("StakingToken");
    const stakingToken = await stakingTokenFactory.deploy();
    await stakingToken.waitForDeployment();
    const stakingTokenAddress = await stakingToken.getAddress();
    console.log("StakingToken deployed to:", stakingTokenAddress);

    // 2. Deploy RelayerManager
    const minStake = ethers.parseEther("1000"); // Minimum 1000 STK to be a relayer
    const relayerManagerFactory = await ethers.getContractFactory("RelayerManager");
    const relayerManager = await relayerManagerFactory.deploy(stakingTokenAddress, minStake);
    await relayerManager.waitForDeployment();
    const relayerManagerAddress = await relayerManager.getAddress();
    console.log("RelayerManager deployed to:", relayerManagerAddress);

    // 3. Deploy WrappedToken (initial owner will be deployer temporarily)
    const wrappedTokenFactory = await ethers.getContractFactory("WrappedToken");
    const wrappedToken = await wrappedTokenFactory.deploy("Wrapped ETH", "WETH", deployer.address);
    await wrappedToken.waitForDeployment();
    const wrappedTokenAddress = await wrappedToken.getAddress();
    console.log("WrappedToken deployed to:", wrappedTokenAddress);

    // 4. Deploy GatewayV2 (provide relayer manager and wrapped token addresses)
    const gatewayV2Factory = await ethers.getContractFactory("GatewayV2");
    const gatewayV2 = await gatewayV2Factory.deploy(relayerManagerAddress, wrappedTokenAddress);
    await gatewayV2.waitForDeployment();
    const gatewayV2Address = await gatewayV2.getAddress();
    console.log("GatewayV2 deployed to:", gatewayV2Address);

    // Transfer ownership of WrappedToken to GatewayV2 so it can mint
    await wrappedToken.transferOwnership(gatewayV2Address);
    console.log("WrappedToken ownership transferred to GatewayV2");

    console.log("\n--- Deployment Summary ---");
    console.log(`StakingToken: "${stakingTokenAddress}"`);
    console.log(`RelayerManager: "${relayerManagerAddress}"`);
    console.log(`GatewayV2: "${gatewayV2Address}"`);
    console.log(`WrappedToken: "${wrappedTokenAddress}"`);
    console.log("--------------------------\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
