const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("Gateway with Wrapped Tokens and Relayers", function () {
    let owner, user, relayer1, relayer2, relayer3;
    let gateway1, gateway2;
    let originalToken, wrappedToken;
    let chainId1, chainId2;
    let relayers;

    beforeEach(async function () {
        [owner, user, relayer1, relayer2, relayer3] = await ethers.getSigners();
        relayers = [relayer1.address, relayer2.address, relayer3.address];
        const signatureThreshold = 2;
        
        const network = await ethers.provider.getNetwork();
        chainId1 = network.chainId;
        chainId2 = Number(network.chainId) + 1;

        const Gateway = await ethers.getContractFactory("Gateway");
        gateway1 = await Gateway.deploy(owner.address, relayers, signatureThreshold);
        gateway2 = await Gateway.deploy(owner.address, relayers, signatureThreshold);
        await gateway1.waitForDeployment();
        await gateway2.waitForDeployment();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        originalToken = await MockERC20.deploy("Test Token", "TST");
        await originalToken.waitForDeployment();

        const WrappedToken = await ethers.getContractFactory("WrappedToken");
        wrappedToken = await WrappedToken.deploy("Wrapped TST", "wTST", gateway2.target);
        await wrappedToken.waitForDeployment();

        await gateway1.setGateway(chainId2, gateway2.target);
        await gateway2.setGateway(chainId1, gateway1.target);

        await gateway1.setSupportedToken(originalToken.target, true, ethers.ZeroAddress);
        await gateway2.setSupportedToken(originalToken.target, true, wrappedToken.target);

        await originalToken.mint(user.address, ethers.parseEther("100"));
    });

    async function getSignatures(messageHash, signers) {
        const signatures = [];
        for (const signer of signers) {
            const signature = await signer.signMessage(ethers.getBytes(messageHash));
            signatures.push(signature);
        }
        return signatures;
    }

    it("should lock original tokens and mint wrapped tokens on the destination chain", async function () {
        const amount = ethers.parseEther("10");
        await originalToken.connect(user).approve(gateway1.target, amount);
        await expect(gateway1.connect(user).sendTokens(originalToken.target, amount, chainId2))
            .to.emit(gateway1, "TokensSent")
            .withArgs(user.address, originalToken.target, amount, chainId2);

        expect(await originalToken.balanceOf(user.address)).to.equal(ethers.parseEther("90"));
        expect(await originalToken.balanceOf(gateway1.target)).to.equal(amount);

        const messageHash = ethers.keccak256(
            ethers.solidityPacked(
                ["address", "address", "uint256", "uint256", "string"],
                [user.address, originalToken.target, amount, chainId1, "receive"]
            )
        );

        const signatures = await getSignatures(messageHash, [relayer1, relayer2]);

        await expect(gateway2.receiveTokens(user.address, originalToken.target, amount, chainId1, signatures))
            .to.emit(gateway2, "TokensReceived")
            .withArgs(user.address, originalToken.target, amount, chainId1);
        
        expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);
    });

    it("should burn wrapped tokens and unlock original tokens on the source chain", async function () {
        const amount = ethers.parseEther("10");
        // First, send tokens to chain 2 to get some wrapped tokens
        await originalToken.connect(user).approve(gateway1.target, amount);
        await gateway1.connect(user).sendTokens(originalToken.target, amount, chainId2);

        const receiveMessageHash = ethers.keccak256(
            ethers.solidityPacked(
                ["address", "address", "uint256", "uint256", "string"],
                [user.address, originalToken.target, amount, chainId1, "receive"]
            )
        );
        const receiveSignatures = await getSignatures(receiveMessageHash, [relayer1, relayer2]);
        await gateway2.receiveTokens(user.address, originalToken.target, amount, chainId1, receiveSignatures);

        expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);
        const initialOriginalBalance = await originalToken.balanceOf(user.address);

        // Now, user on chain 2 wants to send back the tokens to chain 1
        await wrappedToken.connect(user).approve(gateway2.target, amount);
        
        await expect(gateway2.connect(user).releaseTokens(originalToken.target, amount, chainId1))
            .to.emit(gateway2, "TokensReleased")
            .withArgs(user.address, originalToken.target, amount, chainId1);

        expect(await wrappedToken.balanceOf(user.address)).to.equal(ethers.parseEther("0"));

        const unlockMessageHash = ethers.keccak256(
            ethers.solidityPacked(
                ["address", "address", "uint256", "uint256", "string"],
                [user.address, originalToken.target, amount, chainId2, "unlock"]
            )
        );
        const unlockSignatures = await getSignatures(unlockMessageHash, [relayer2, relayer3]);

        await expect(gateway1.unlockTokens(user.address, originalToken.target, amount, chainId2, unlockSignatures))
            .to.emit(gateway1, "TokensUnlocked")
            .withArgs(user.address, originalToken.target, amount);

        expect(await originalToken.balanceOf(user.address)).to.equal(initialOriginalBalance + amount);
        expect(await originalToken.balanceOf(gateway1.target)).to.equal(ethers.parseEther("0"));
    });
});
