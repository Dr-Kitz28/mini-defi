const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("SimpleMultiSig -> Gateway pause/unpause integration", function () {
    let owner, user, relayer1, relayer2, relayer3;
    let gateway, multisig;

    beforeEach(async function () {
        [owner, user, relayer1, relayer2, relayer3] = await ethers.getSigners();

        const Gateway = await ethers.getContractFactory("Gateway");
        const relayers = [relayer1.address, relayer2.address, relayer3.address];
        gateway = await Gateway.deploy(owner.address, relayers, 2);
        await gateway.waitForDeployment();

        const SimpleMultiSig = await ethers.getContractFactory("SimpleMultiSig");
        multisig = await SimpleMultiSig.deploy([
            relayer1.address,
            relayer2.address,
            relayer3.address,
        ], 2);
        await multisig.waitForDeployment();

        // Owner wires the multisig into the gateway
        await gateway.connect(owner).setMultisig(multisig.target);
    });

    it("should prevent unauthorized pausing and allow multisig to pause via executeTransaction", async function () {
        // Non-owner/non-multisig should be unable to pause
        await expect(gateway.connect(user).pause()).to.be.revertedWith("not authorized");

        // Prepare multisig transaction data to call gateway.pause()
        const data = gateway.interface.encodeFunctionData("pause", []);

        // Submit the multisig transaction and extract txId from the Submit event
        const submitTx = await multisig.connect(relayer1).submitTransaction(gateway.target, 0, data);
        const submitRec = await submitTx.wait();
        let txId = null;
        for (const log of submitRec.logs) {
            try {
                const parsed = multisig.interface.parseLog(log);
                if (parsed && parsed.name === "Submit") {
                    txId = parsed.args[1];
                    break;
                }
            } catch (e) {
                // ignore non-multisig logs
            }
        }
        if (txId === null) throw new Error("txId not found in Submit event");

        // Submitter confirms and another owner confirms to reach threshold
        await multisig.connect(relayer1).confirmTransaction(txId);
        await multisig.connect(relayer2).confirmTransaction(txId);

        // Execute the transaction from an owner - this will call gateway.pause()
        await expect(multisig.connect(relayer1).executeTransaction(txId)).to.emit(multisig, "Execute");

        // Gateway should now be paused
        expect(await gateway.paused()).to.equal(true);

        // Owner can still unpause directly
        await gateway.connect(owner).unpause();
        expect(await gateway.paused()).to.equal(false);
    });
});
