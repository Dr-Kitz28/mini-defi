const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('GatewayV2 - threshold signature logic', function () {
  let deployer;
  let relayers;
  let recipient;
  let stakingToken, relayerManager, wrappedToken, gateway;
  const minStake = ethers.parseEther('10');

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    relayers = signers.slice(1, 7); // use 6 potential relayers for tests
    recipient = signers[8];

    const StakingToken = await ethers.getContractFactory('StakingToken');
    stakingToken = await StakingToken.deploy();
    await stakingToken.waitForDeployment();

    const RelayerManager = await ethers.getContractFactory('RelayerManager');
    relayerManager = await RelayerManager.deploy(stakingToken.target, minStake);
    await relayerManager.waitForDeployment();

    const WrappedToken = await ethers.getContractFactory('WrappedToken');
    wrappedToken = await WrappedToken.deploy('Wrapped Test', 'WTEST', deployer.address);
    await wrappedToken.waitForDeployment();

    const GatewayV2 = await ethers.getContractFactory('GatewayV2');
    gateway = await GatewayV2.deploy(relayerManager.target, wrappedToken.target);
    await gateway.waitForDeployment();

    // give gateway ownership of the wrapped token so it can mint
    await wrappedToken.transferOwnership(gateway.target);

    // fund and stake the first 5 relayers
    for (let i = 0; i < 5; i++) {
      const r = relayers[i];
      await stakingToken.connect(deployer).mint(await r.getAddress(), minStake);
      await stakingToken.connect(r).approve(relayerManager.target, minStake);
      await relayerManager.connect(r).stake();
    }
  });

  it('allows minting when quorum of relayer signatures present', async function () {
    const relayerCount = Number((await relayerManager.getRelayerCount()).toString());
    const required = Math.floor((relayerCount * 2) / 3) + 1;

    const amount = ethers.parseEther('1');
    const sourceTxHash = ethers.keccak256(ethers.toUtf8Bytes('tx-1'));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const proofHash = ethers.keccak256(
      ethers.solidityPacked(['address', 'uint256', 'bytes32', 'uint256'], [await recipient.getAddress(), amount, sourceTxHash, chainId])
    );

    // collect required signatures
    const sigs = [];
    for (let i = 0; i < required; i++) {
      sigs.push(await relayers[i].signMessage(ethers.getBytes(proofHash)));
    }

    await expect(gateway.connect(deployer).mint(await recipient.getAddress(), amount, sourceTxHash, sigs)).to.not.be.reverted;

    expect(await wrappedToken.balanceOf(await recipient.getAddress())).to.equal(amount);
  });

  it('reverts when insufficient signatures are provided', async function () {
    const relayerCount = Number((await relayerManager.getRelayerCount()).toString());
    const required = Math.floor((relayerCount * 2) / 3) + 1;

    const amount = ethers.parseEther('1');
    const sourceTxHash = ethers.keccak256(ethers.toUtf8Bytes('tx-2'));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const proofHash = ethers.keccak256(
      ethers.solidityPacked(['address', 'uint256', 'bytes32', 'uint256'], [await recipient.getAddress(), amount, sourceTxHash, chainId])
    );

    // provide one fewer than required
    const sigs = [];
    for (let i = 0; i < Math.max(0, required - 1); i++) {
      sigs.push(await relayers[i].signMessage(ethers.getBytes(proofHash)));
    }

    await expect(gateway.connect(deployer).mint(await recipient.getAddress(), amount, sourceTxHash, sigs)).to.be.revertedWith('Insufficient signatures');
  });

  it('rejects duplicate signatures', async function () {
    const relayerCount = Number((await relayerManager.getRelayerCount()).toString());
    const required = Math.floor((relayerCount * 2) / 3) + 1;

    const amount = ethers.parseEther('1');
    const sourceTxHash = ethers.keccak256(ethers.toUtf8Bytes('tx-3'));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const proofHash = ethers.keccak256(
      ethers.solidityPacked(['address', 'uint256', 'bytes32', 'uint256'], [await recipient.getAddress(), amount, sourceTxHash, chainId])
    );

    // collect signatures but purposely duplicate the first signature
    const firstSig = await relayers[0].signMessage(ethers.getBytes(proofHash));
    const sigs = [firstSig];
    // fill to required with other distinct signatures if possible
    for (let i = 1; sigs.length < required; i++) {
      sigs.push(await relayers[i].signMessage(ethers.getBytes(proofHash)));
    }
    // inject duplicate
    sigs.push(firstSig);

    await expect(gateway.connect(deployer).mint(await recipient.getAddress(), amount, sourceTxHash, sigs)).to.be.revertedWith('Duplicate signature');
  });

  it('prevents replay of the same proof', async function () {
    const relayerCount = Number((await relayerManager.getRelayerCount()).toString());
    const required = Math.floor((relayerCount * 2) / 3) + 1;

    const amount = ethers.parseEther('1');
    const sourceTxHash = ethers.keccak256(ethers.toUtf8Bytes('tx-4'));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const proofHash = ethers.keccak256(
      ethers.solidityPacked(['address', 'uint256', 'bytes32', 'uint256'], [await recipient.getAddress(), amount, sourceTxHash, chainId])
    );

    const sigs = [];
    for (let i = 0; i < required; i++) {
      sigs.push(await relayers[i].signMessage(ethers.getBytes(proofHash)));
    }

    // first call should succeed
    await expect(gateway.connect(deployer).mint(await recipient.getAddress(), amount, sourceTxHash, sigs)).to.not.be.reverted;
    // second call should revert due to usedProofs
    await expect(gateway.connect(deployer).mint(await recipient.getAddress(), amount, sourceTxHash, sigs)).to.be.revertedWith('Proof has already been used');
  });
});
