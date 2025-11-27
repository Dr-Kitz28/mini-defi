const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("Gateway light-client integration", function () {
    let owner, user, relayer1;
    let gateway, originalToken, wrappedToken;
    let chainId1, chainId2;

    beforeEach(async function () {
        [owner, user, relayer1] = await ethers.getSigners();

        const Gateway = await ethers.getContractFactory("Gateway");
        const relayers = [relayer1.address];
        gateway = await Gateway.deploy(owner.address, relayers, 1);
        await gateway.waitForDeployment();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        originalToken = await MockERC20.deploy("Test Token", "TST");
        await originalToken.waitForDeployment();

        const WrappedToken = await ethers.getContractFactory("WrappedToken");
        wrappedToken = await WrappedToken.deploy("Wrapped TST", "wTST", gateway.target);
        await wrappedToken.waitForDeployment();

        const network = await ethers.provider.getNetwork();
        chainId1 = network.chainId;
        chainId2 = Number(network.chainId) + 1;

        await gateway.setGateway(chainId2, gateway.target);
        await gateway.setSupportedToken(originalToken.target, true, wrappedToken.target);

        await originalToken.mint(user.address, ethers.parseEther("100"));
    });

    it("should mint using a simple checkpoint light client", async function () {
        const LightClientCheckpoint = await ethers.getContractFactory("LightClientCheckpoint");
        const lc = await LightClientCheckpoint.deploy();
        await lc.waitForDeployment();

        // Owner submits a checkpoint (opaque bytes). The contract marks the root as accepted.
        const header = ethers.toUtf8Bytes("header-1");
        await lc.connect(owner).submitCheckpoint(header, []);
        const headerRoot = await lc.latestHeaderRoot();

        // Now call receiveTokensWithProof using the accepted headerRoot
        const amount = ethers.parseEther("5");
        await originalToken.connect(user).approve(gateway.target, amount);
        await gateway.connect(user).sendTokens(originalToken.target, amount, chainId2);

        // Directly call receiveTokensWithProof (simulate relayer/lightclient submission)
        await expect(gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, headerRoot, ethers.getBytes("0x01"), lc.target))
            .to.emit(gateway, "TokensReceived")
            .withArgs(user.address, originalToken.target, amount, chainId1);

        expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);
    });

    it("should accept checkpoints submitted by a validator set", async function () {
        const LightClientValidators = await ethers.getContractFactory("LightClientValidators");
        const lc = await LightClientValidators.deploy();
        await lc.waitForDeployment();

        // Add a validator and submit checkpoint from that validator
        await lc.connect(owner).addValidator(relayer1.address);
        const header = ethers.toUtf8Bytes("header-2");
        await lc.connect(relayer1).submitCheckpoint(header, []);
        const headerRoot = await lc.latestHeaderRoot();

        const amount = ethers.parseEther("3");
        await gateway.setSupportedToken(originalToken.target, true, wrappedToken.target);

        await expect(gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, headerRoot, ethers.getBytes("0x02"), lc.target))
            .to.emit(gateway, "TokensReceived");

        expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);
    });
});
