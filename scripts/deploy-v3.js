const hre = require("hardhat");

async function main() {
  const [deployer, relayerA, relayerB] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Relayer A:", relayerA.address);
  console.log("Relayer B:", relayerB.address);

  const minStake = hre.ethers.parseEther("1000");

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const stakeToken = await MockERC20.deploy("Relayer Stake", "RST");
  await stakeToken.waitForDeployment();
  console.log("Stake token:", await stakeToken.getAddress());

  // Mint stake to deployer for testing
  await (
    await stakeToken.mint(
      deployer.address,
      hre.ethers.parseEther("1000000")
    )
  ).wait();

  // Fund relayer accounts with stake tokens
  await (await stakeToken.transfer(relayerA.address, minStake)).wait();
  await (await stakeToken.transfer(relayerB.address, minStake)).wait();
  console.log("Funded relayers with stake tokens");

  const RelayerManager = await hre.ethers.getContractFactory("RelayerManager");
  const relayerManager = await RelayerManager.deploy(
    await stakeToken.getAddress(),
    minStake
  );
  await relayerManager.waitForDeployment();
  const relayerManagerAddress = await relayerManager.getAddress();
  console.log("RelayerManager:", relayerManagerAddress);

  // Relayer accounts stake to become active signers
  await (await stakeToken.connect(relayerA).approve(relayerManagerAddress, minStake)).wait();
  await (await relayerManager.connect(relayerA).stake()).wait();
  console.log("Relayer A staked");

  await (await stakeToken.connect(relayerB).approve(relayerManagerAddress, minStake)).wait();
  await (await relayerManager.connect(relayerB).stake()).wait();
  console.log("Relayer B staked");

  const ChainRegistry = await hre.ethers.getContractFactory("ChainRegistry");
  const registry = await ChainRegistry.deploy();
  await registry.waitForDeployment();
  console.log("ChainRegistry:", await registry.getAddress());

  const GatewayV3 = await hre.ethers.getContractFactory("GatewayV3");
  const gateway = await GatewayV3.deploy(
    await relayerManager.getAddress(),
    await registry.getAddress()
  );
  await gateway.waitForDeployment();
  console.log("GatewayV3:", await gateway.getAddress());

  const WrappedToken = await hre.ethers.getContractFactory("WrappedToken");
  const w = await WrappedToken.deploy("WrappedAsset", "wASSET", deployer.address);
  await w.waitForDeployment();
  await (await w.transferOwnership(await gateway.getAddress())).wait();
  console.log("WrappedToken:", await w.getAddress());

  const network = await hre.ethers.provider.getNetwork();
  await (
    await registry.setChain(
      network.chainId,
      0, // ChainKind.EVM
      await gateway.getAddress(),
      true
    )
  ).wait();
  console.log("Registry configured for chain", network.chainId.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
