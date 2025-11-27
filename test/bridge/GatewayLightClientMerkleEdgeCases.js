const { ethers } = require("hardhat");
const { expect } = require("chai");

const rlp = require('../utils/rlpValidator')(ethers);

describe("Gateway Merkle LightClient edge cases", function () {
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

    it("rejects malformed RLP receipts", async function () {
        const amount = ethers.parseEther("1");
        await originalToken.connect(user).approve(gateway.target, amount);
        await gateway.connect(user).sendTokens(originalToken.target, amount, chainId2);

        // Construct a malformed RLP (starts with 0x00, not a list)
        const messageHash = ethers.keccak256(ethers.solidityPacked([
            "address", "address", "uint256", "uint256", "string", "bytes32"
        ], [user.address, originalToken.target, amount, chainId1, "receive_proof", ethers.ZeroHash]));

    const malformed = ethers.concat([ethers.getBytes('0x00'), ethers.getBytes(messageHash)]);
        const leaf = ethers.keccak256(malformed);
        const { root, proofs } = rlp.buildMerkle([leaf]);

        const headerId = root;
        await lc.connect(owner).submitHeader(headerId, root);

    const bitmaskLen = Math.ceil(proofs[0].length / 8) || 1;
    const path = new Uint8Array(bitmaskLen);
    const proofEncoded = new ethers.AbiCoder().encode(["bytes", "bytes32[]", "bytes"], [malformed, proofs[0], path]);

        await expect(gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, headerId, proofEncoded, lc.target))
            .to.be.revertedWith("Invalid proof");
    });

    it("rejects proofs with wrong sibling lengths", async function () {
        // Create two leaves but supply an empty siblings array for one of them
        const amt1 = ethers.parseEther("1");
        const amt2 = ethers.parseEther("2");

        await originalToken.connect(user).approve(gateway.target, amt1);
        await gateway.connect(user).sendTokens(originalToken.target, amt1, chainId2);
        await originalToken.connect(user).approve(gateway.target, amt2);
        await gateway.connect(user).sendTokens(originalToken.target, amt2, chainId2);

        const msg1 = ethers.keccak256(ethers.solidityPacked([
            "address", "address", "uint256", "uint256", "string", "bytes32"
        ], [user.address, originalToken.target, amt1, chainId1, "receive_proof", ethers.ZeroHash]));
    const rec1 = rlp.makeReceiptRLP(msg1);
        const leaf1 = ethers.keccak256(rec1);

        const msg2 = ethers.keccak256(ethers.solidityPacked([
            "address", "address", "uint256", "uint256", "string", "bytes32"
        ], [user.address, originalToken.target, amt2, chainId1, "receive_proof", ethers.ZeroHash]));
    const rec2 = rlp.makeReceiptRLP(msg2);
        const leaf2 = ethers.keccak256(rec2);

        const { root, proofs } = rlp.buildMerkle([leaf1, leaf2]);
        await lc.connect(owner).submitHeader(root, root);

        // Provide an empty siblings array for leaf1 (should fail)
    const badProof = new ethers.AbiCoder().encode(["bytes", "bytes32[]", "bytes"], [rec1, [], new Uint8Array(0)]);

        await expect(gateway.receiveTokensWithProof(user.address, originalToken.target, amt1, chainId1, root, badProof, lc.target))
            .to.be.revertedWith("Invalid proof");
    });

    it("accepts multi-leaf batch merkle proofs and prevents replay", async function () {
        const amounts = [ethers.parseEther('1'), ethers.parseEther('2'), ethers.parseEther('3')];
        const receipts = [];
        for (let i = 0; i < amounts.length; i++) {
            const a = amounts[i];
            await originalToken.connect(user).approve(gateway.target, a);
            await gateway.connect(user).sendTokens(originalToken.target, a, chainId2);
            const msg = ethers.keccak256(ethers.solidityPacked([
                "address", "address", "uint256", "uint256", "string", "bytes32"
            ], [user.address, originalToken.target, a, chainId1, "receive_proof", ethers.ZeroHash]));
            const rec = rlp.makeReceiptRLP(msg);
            const leaf = ethers.keccak256(rec);
            receipts.push({ rec, leaf, amount: a });
        }

        const leaves = receipts.map(r => r.leaf);
    const { root, proofs, paths } = rlp.buildMerkle(leaves);
        await lc.connect(owner).submitHeader(root, root);

        for (let i = 0; i < receipts.length; i++) {
            const { rec, amount } = receipts[i];
            const path = paths[i];
            const proofEncoded = new ethers.AbiCoder().encode(["bytes", "bytes32[]", "bytes"], [rec, proofs[i], path]);
            await gateway.receiveTokensWithProof(user.address, originalToken.target, amount, chainId1, root, proofEncoded, lc.target);
        }

        // replay of first proof should fail
        const first = receipts[0];
    const replayProof = new ethers.AbiCoder().encode(["bytes", "bytes32[]", "bytes"], [first.rec, proofs[0], paths[0]]);
        await expect(gateway.receiveTokensWithProof(user.address, originalToken.target, first.amount, chainId1, root, replayProof, lc.target))
            .to.be.revertedWith("Proof already used");
    });
});
