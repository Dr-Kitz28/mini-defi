const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("DynamicInterestRateModel", function () {
    let owner, user;
    let repoOracle, dynamicIRM;

    const toWei = (amount) => ethers.parseEther(amount);

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy GlobalRepoRateOracle
        const GlobalRepoRateOracle = await ethers.getContractFactory("GlobalRepoRateOracle");
        // Initial rate of 2.5%
        repoOracle = await GlobalRepoRateOracle.deploy(toWei("0.025"), owner.address);
        await repoOracle.waitForDeployment();

        // Deploy DynamicInterestRateModel
        const DynamicInterestRateModel = await ethers.getContractFactory("DynamicInterestRateModel");
        // Base rate of 1%, utilization multiplier of 0.5
        dynamicIRM = await DynamicInterestRateModel.deploy(repoOracle.target, toWei("0.01"), toWei("0.5"), owner.address);
        await dynamicIRM.waitForDeployment();
    });

    it("should calculate the borrow rate correctly", async function () {
        // 50% utilization
        const utilization = toWei("0.5");
        const expectedRate = toWei("0.01") + (toWei("0.5") * toWei("0.5")) / toWei("1") + toWei("0.025");
        const rate = await dynamicIRM.getBorrowRatePerSecond(utilization);
        expect(rate).to.equal(toWei("0.285"));
    });

    it("should update the borrow rate when the repo rate changes", async function () {
        // 50% utilization
        const utilization = toWei("0.5");

        // Update repo rate to 5%
        await repoOracle.connect(owner).setRepoRate(toWei("0.05"));

        const rate = await dynamicIRM.getBorrowRatePerSecond(utilization);
        expect(rate).to.equal(toWei("0.31"));
    });

    it("should only allow the owner to set parameters", async function () {
        await expect(
            dynamicIRM.connect(user).setParameters(toWei("0.02"), toWei("0.6"))
        ).to.be.revertedWithCustomError(dynamicIRM, "OwnableUnauthorizedAccount");
    });
});
