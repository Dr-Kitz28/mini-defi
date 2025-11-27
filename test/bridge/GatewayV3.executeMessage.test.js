const { expect } = require('chai');
const { ethers } = require('hardhat');

function hashMessage(nonce, fromChainId, toChainId, sender, target, data, value) {
  const DOMAIN_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(
    "CrossChainMessage(uint256 nonce,uint256 fromChainId,uint256 toChainId,address sender,address target,bytes data,uint256 value)"
  ));
  const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'bytes32','uint256','uint256','uint256','address','address','bytes32','uint256'
    ],
    [
      DOMAIN_TYPEHASH,
      nonce,
      fromChainId,
      toChainId,
      sender,
      target,
      ethers.keccak256(data),
      value
    ]
  ));
  return hash;
}

describe('GatewayV3 executeMessage', function () {
  let deployer, relayer1, relayer2, user;
  let stakeToken, relayerManager, registry, gateway, w, receiver;
  let data, digest, fromChainId, targetAddress;

  beforeEach(async function () {
    [deployer, relayer1, relayer2, user] = await ethers.getSigners();

    // Deploy stake token and give relayers some
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    stakeToken = await MockERC20.deploy('RelayerStake','RST');
    await stakeToken.waitForDeployment();
    await stakeToken.mint(relayer1.address, ethers.parseEther('10'));
    await stakeToken.mint(relayer2.address, ethers.parseEther('10'));

    // Deploy RelayerManager with small minStake for tests
    const RelayerManager = await ethers.getContractFactory('RelayerManager');
    relayerManager = await RelayerManager.deploy(await stakeToken.getAddress(), ethers.parseEther('1'));
    await relayerManager.waitForDeployment();

    // Relayers approve and stake
    await stakeToken.connect(relayer1).approve(relayerManager.getAddress(), ethers.parseEther('1'));
    await relayerManager.connect(relayer1).stake();
    await stakeToken.connect(relayer2).approve(relayerManager.getAddress(), ethers.parseEther('1'));
    await relayerManager.connect(relayer2).stake();

    // Deploy ChainRegistry
    const ChainRegistry = await ethers.getContractFactory('ChainRegistry');
    registry = await ChainRegistry.deploy();
    await registry.waitForDeployment();

    // Deploy GatewayV3
    const GatewayV3 = await ethers.getContractFactory('GatewayV3');
    gateway = await GatewayV3.deploy(relayerManager.getAddress(), registry.getAddress());
    await gateway.waitForDeployment();

    // Deploy WrappedToken and transfer ownership to gateway
    const WrappedToken = await ethers.getContractFactory('WrappedToken');
    w = await WrappedToken.deploy('WrappedAsset','wASSET', deployer.address);
    await w.waitForDeployment();
    await w.transferOwnership(await gateway.getAddress());

    // Deploy TestReceiver
    const TestReceiver = await ethers.getContractFactory('TestReceiver');
    receiver = await TestReceiver.deploy();
    await receiver.waitForDeployment();

    // Prepare message: call increment(7) on receiver
    const incrementAmount = 7;
    const iface = new ethers.Interface(['function increment(uint256) returns (uint256)']);
    data = iface.encodeFunctionData('increment', [incrementAmount]);

    const network = await ethers.provider.getNetwork();
    const toChainId = network.chainId;
    fromChainId = 11155111; // origin chain id (arbitrary for test)

    targetAddress = await receiver.getAddress();
    digest = hashMessage(0, fromChainId, toChainId, ethers.ZeroAddress, targetAddress, data, 0);
  });

  it('executes a payload when relayer quorum signs the message', async function () {
    // Relayers sign the digest (Ethereum Signed Message prefix is used by contract)
    const sig1 = await relayer1.signMessage(ethers.getBytes(digest));
    const sig2 = await relayer2.signMessage(ethers.getBytes(digest));

    // Execute message with both signatures
    await expect(
      gateway.executeMessage(fromChainId, ethers.ZeroAddress, targetAddress, data, 0, digest, [sig1, sig2])
    ).to.not.be.reverted;

    // Confirm receiver state updated
    expect(await receiver.value()).to.equal(7);
  });

  it('prevents replay of the same message', async function () {
    const sig1 = await relayer1.signMessage(ethers.getBytes(digest));
    const sig2 = await relayer2.signMessage(ethers.getBytes(digest));

    // First call should succeed
    await gateway.executeMessage(fromChainId, ethers.ZeroAddress, targetAddress, data, 0, digest, [sig1, sig2]);

    // Second call with same proof should revert with "proof used"
    await expect(
      gateway.executeMessage(fromChainId, ethers.ZeroAddress, targetAddress, data, 0, digest, [sig1, sig2])
    ).to.be.revertedWith('proof used');
  });

  it('rejects when not enough signatures are provided', async function () {
    const sig1 = await relayer1.signMessage(ethers.getBytes(digest));

    // Only one signature provided; threshold for 2 active relayers is 2
    await expect(
      gateway.executeMessage(fromChainId, ethers.ZeroAddress, targetAddress, data, 0, digest, [sig1])
    ).to.be.revertedWith('not enough signatures');
  });
});
