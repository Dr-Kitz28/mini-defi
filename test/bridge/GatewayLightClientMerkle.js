const { ethers } = require("hardhat");
const { expect } = require("chai");
const rlp = require('../utils/rlpValidator')(ethers);

describe("Gateway Merkle LightClient integration", function () {
    let owner, user;
    let gateway, originalToken, wrappedToken, lc;
    let chainId1, chainId2;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        const Gateway = await ethers.getContractFactory("Gateway");
        gateway = await Gateway.deploy(owner.address, [owner.address], 1);
        await gateway.waitForDeployment();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        originalToken = await MockERC20.deploy("Test Token", "TST");
        await originalToken.waitForDeployment();

        const WrappedToken = await ethers.getContractFactory("WrappedToken");
        wrappedToken = await WrappedToken.deploy("Wrapped TST", "wTST", gateway.target);
        await wrappedToken.waitForDeployment();

        const LightClientMerkle = await ethers.getContractFactory("LightClientMerkle");
        lc = await LightClientMerkle.deploy();
        await lc.waitForDeployment();

        const network = await ethers.provider.getNetwork();
        chainId1 = network.chainId;
        chainId2 = Number(network.chainId) + 1;

        await gateway.setGateway(chainId2, gateway.target);
        await gateway.setSupportedToken(originalToken.target, true, wrappedToken.target);

        await originalToken.mint(user.address, ethers.parseEther("100"));
    });

    it("accepts a merkle proof for a minted token message", async function () {
        const amount = ethers.parseEther("1");
        await originalToken.connect(user).approve(gateway.target, amount);
        await gateway.connect(user).sendTokens(originalToken.target, amount, chainId2);

        // Build the messageHash used by Gateway for receive_proof and then craft a
        // minimal RLP-like receipt that contains that messageHash so the leaf = keccak256(receiptRLP)
        const messageHash = ethers.keccak256(ethers.solidityPacked([
            "address", "address", "uint256", "uint256", "string", "bytes32"
        ], [user.address, originalToken.target, amount, chainId1, "receive_proof", ethers.ZeroHash]));

        // Build canonical Ethereum-style receipt RLP for testing using helper
        const receiptRLP = rlp.makeReceiptRLP(messageHash);
        const leaf = ethers.keccak256(receiptRLP);
    

    // Build merkle with single leaf
    const { root, proofs } = rlp.buildMerkle([leaf]);
    console.log('leafJS', leaf, 'root', root);

        // Submit headerId and receiptsRoot to light client (owner)
        const headerId = root; // in this test we use root as headerId for simplicity
        await lc.connect(owner).submitHeader(headerId, root);

    const bitmaskLen = Math.ceil(proofs[0].length / 8) || 1;
        const path = new Uint8Array(bitmaskLen);
        const proofEncoded = new ethers.AbiCoder().encode(["bytes", "bytes32[]", "bytes"], [receiptRLP, proofs[0], path]);

        // Sanity-check the light client directly before calling Gateway
        const verified = await lc.connect(owner).verifyProof(headerId, proofEncoded);
        // Emit debug if helpful (kept as assertion)
        expect(verified).to.equal(true);

        await expect(gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, headerId, proofEncoded, lc.target))
            .to.emit(gateway, "TokensReceived");

        expect(await wrappedToken.balanceOf(user.address)).to.equal(amount);
    });

    it("rejects an invalid merkle proof", async function () {
        const amount = ethers.parseEther("2");
        await originalToken.connect(user).approve(gateway.target, amount);
        await gateway.connect(user).sendTokens(originalToken.target, amount, chainId2);

        const messageHash = ethers.keccak256(ethers.solidityPacked([
            "address", "address", "uint256", "uint256", "string", "bytes32"
        ], [user.address, originalToken.target, amount, chainId1, "receive_proof", ethers.ZeroHash]));
    const receiptRLP = ethers.concat([ethers.getBytes("0xe1"), ethers.getBytes("0xa0"), ethers.getBytes(messageHash)]);
        const leaf = ethers.keccak256(receiptRLP);

    // Build merkle with a different leaf
    const other = ethers.keccak256(ethers.toUtf8Bytes("not-the-same"));
    const { root, proofs } = rlp.buildMerkle([other]);

        const headerId = root;
        await lc.connect(owner).submitHeader(headerId, root);

    const bitmaskLen = Math.ceil(proofs[0].length / 8) || 1;
    const path = new Uint8Array(bitmaskLen);
    const proofEncoded = new ethers.AbiCoder().encode(["bytes", "bytes32[]", "bytes"], [receiptRLP, proofs[0], path]);

        await expect(gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, headerId, proofEncoded, lc.target))
            .to.be.revertedWith("Invalid proof");
    });

    it("prevents replay of the same proof/message", async function () {
        const amount = ethers.parseEther("0.5");
        await originalToken.connect(user).approve(gateway.target, amount);
        await gateway.connect(user).sendTokens(originalToken.target, amount, chainId2);

        const messageHash = ethers.keccak256(ethers.solidityPacked([
            "address", "address", "uint256", "uint256", "string", "bytes32"
        ], [user.address, originalToken.target, amount, chainId1, "receive_proof", ethers.ZeroHash]));
    const receiptRLP = ethers.concat([ethers.getBytes("0xe1"), ethers.getBytes("0xa0"), ethers.getBytes(messageHash)]);
        const leaf = ethers.keccak256(receiptRLP);
    const { root, proofs } = rlp.buildMerkle([leaf]);
        const headerId = root;
        await lc.connect(owner).submitHeader(headerId, root);
    const bitmaskLen = Math.ceil(proofs[0].length / 8) || 1;
    const path = new Uint8Array(bitmaskLen);
    const proofEncoded = new ethers.AbiCoder().encode(["bytes", "bytes32[]", "bytes"], [receiptRLP, proofs[0], path]);

        await gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, headerId, proofEncoded, lc.target);

        // Second call with identical args should revert due to usedSignatures check
        await expect(
            gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, headerId, proofEncoded, lc.target)
    ).to.be.revertedWith("Proof already used");
    });
});
