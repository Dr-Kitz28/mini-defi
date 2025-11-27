const hre = require("hardhat");
const { ethers } = hre;
const { collectSignatures } = require("./aggregator");

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log("Using deployer:", deployer.address);

  // Deploy contracts (similar to scripts/deploy_v2.js)
  const StakingToken = await ethers.getContractFactory("StakingToken");
  const stakingToken = await StakingToken.deploy();
  await stakingToken.waitForDeployment();

  const minStake = ethers.parseEther("100");
  const RelayerManager = await ethers.getContractFactory("RelayerManager");
  const relayerManager = await RelayerManager.deploy(stakingToken.target, minStake);
  await relayerManager.waitForDeployment();

  // Deploy WrappedToken with deployer as initial owner
  const WrappedToken = await ethers.getContractFactory("WrappedToken");
  const wrappedToken = await WrappedToken.deploy("Wrapped Demo", "WDM", deployer.address);
  await wrappedToken.waitForDeployment();

  // Deploy GatewayV2 with relayer manager and wrapped token addresses
  const GatewayV2 = await ethers.getContractFactory("GatewayV2");
  const gateway = await GatewayV2.deploy(relayerManager.target, wrappedToken.target);
  await gateway.waitForDeployment();

  // Transfer ownership of wrapped token to gateway so it can mint
  await wrappedToken.transferOwnership(gateway.target);

  console.log("Deployed: stakingToken=%s relayerManager=%s wrappedToken=%s gateway=%s",
    stakingToken.target, relayerManager.target, wrappedToken.target, gateway.target);

  // Prepare relayer signers (use signers[1..n])
  const relayerSigners = signers.slice(1, 6); // simulate 5 relayers

  // Fund and stake relayers
  for (let r of relayerSigners) {
    // mint staking tokens to relayer
    await stakingToken.connect(deployer).mint(r.address, minStake);
    // approve and stake
    await stakingToken.connect(r).approve(relayerManager.target, minStake);
    await relayerManager.connect(r).stake();
  }

  const relayerCount = await relayerManager.getRelayerCount();
  console.log("Relayer count:", relayerCount.toString());

  // Prepare a proof payload
  // --- Example 1: mint flow (as before) ---
  const recipient = signers[7].address;
  const amount = ethers.parseEther("1");
  const sourceTxHash = ethers.keccak256(ethers.toUtf8Bytes("demo-source-tx-" + Date.now()));
  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Build proofHash using the same packing as the contract: abi.encodePacked(recipient, amount, sourceTxHash, chainid)
  const proofHash = ethers.keccak256(ethers.solidityPacked(["address","uint256","bytes32","uint256"], [recipient, amount, sourceTxHash, chainId]));

  // Determine required signatures (2/3 + 1) using relayerCount
  const relayerCountNum = Number(relayerCount.toString());
  const required = Math.floor((relayerCountNum * 2) / 3) + 1;
  console.log("Required signatures:", required);

  // Collect signatures from relayers
  const signatures = await collectSignatures(relayerSigners, proofHash, required);

  console.log("Collected signatures:", signatures.length);

  // Submit to gateway (mint)
  const tx = await gateway.connect(deployer).mint(recipient, amount, sourceTxHash, signatures);
  console.log("Mint submitted, tx hash (pending):", tx.hash || "(no tx.hash)");
  const receipt = await tx.wait();
  console.log("Mint confirmed, tx hash:", receipt.transactionHash || tx.hash);

  const bal = await wrappedToken.balanceOf(recipient);
  console.log("Recipient balance after mint:", bal.toString());

  // --- Example 2: executeMessage flow (arbitrary payload) ---
  const TestReceiver = await ethers.getContractFactory('TestReceiver');
  const receiver = await TestReceiver.deploy();
  await receiver.waitForDeployment();
  console.log('TestReceiver deployed at', receiver.target);

  // build payload to call increment(uint256)
  const incrementBy = 7;
  const payload = new ethers.AbiCoder().encodeFunctionData ?
    receiver.interface.encodeFunctionData('increment', [incrementBy]) :
    receiver.interface.encodeFunction('increment', [incrementBy]);

  const sourceTxHash2 = ethers.keccak256(ethers.toUtf8Bytes('demo-msg-source-' + Date.now()));
  const proofHashMsg = ethers.keccak256(ethers.solidityPacked(["address","bytes","bytes32","uint256"], [receiver.target, payload, sourceTxHash2, chainId]));

  const sigsMsg = await collectSignatures(relayerSigners, proofHashMsg, required);
  console.log('Collected signatures for message:', sigsMsg.length);

  const tx2 = await gateway.connect(deployer).executeMessage(receiver.target, payload, sourceTxHash2, sigsMsg);
  console.log('executeMessage submitted tx hash (pending):', tx2.hash || '(no tx.hash)');
  const r2 = await tx2.wait();
  console.log('executeMessage confirmed tx hash:', r2.transactionHash || tx2.hash);

  const finalVal = await receiver.value();
  console.log('Receiver.value after executeMessage:', finalVal.toString());
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
