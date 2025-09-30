const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimeWeightedInterestRateModel", function () {
    let model, mockPool, owner, addr1;

    const INITIAL_APR = 2n * 10n ** 16n; // 2%
    const ADJUSTMENT_SPEED = 1n * 10n ** 15n; // 0.1%
    const MAX_APR = 10n * 10n ** 16n; // 10%
    const MIN_APR = 1n * 10n ** 16n; // 1%
    const LOWER_BOUND = 60n * 10n ** 16n; // 60%
    const UPPER_BOUND = 80n * 10n ** 16n; // 80%
    const TARGET_UTILIZATION = 70n * 10n ** 16n; // 70%

    beforeEach(async function () {
        [owner, addr1] = await ethers.getSigners();

        const TimeWeightedInterestRateModel = await ethers.getContractFactory(
            "TimeWeightedInterestRateModel"
        );
        model = await TimeWeightedInterestRateModel.deploy(
            MIN_APR,
            MAX_APR,
            INITIAL_APR,
            ADJUSTMENT_SPEED,
            LOWER_BOUND,
            UPPER_BOUND,
            owner.address
        );

        const MockLendingPool = await ethers.getContractFactory(
            "MockLendingPool"
        );
        mockPool = await MockLendingPool.deploy();
        
        // Authorize the mock pool to call the model
        await model.connect(owner).setPool(mockPool.target);
        await mockPool.setIRM(model.target);
    });

    describe("Deployment and Configuration", function () {
        it("Should set parameters correctly", async function () {
            expect(await model.neutralAPR()).to.equal(INITIAL_APR);
            expect(await model.adjustmentRatePerSecond()).to.equal(ADJUSTMENT_SPEED);
            expect(await model.maxAPR()).to.equal(MAX_APR);
            expect(await model.minAPR()).to.equal(MIN_APR);
            expect(await model.lowerUtilization()).to.equal(LOWER_BOUND);
            expect(await model.upperUtilization()).to.equal(UPPER_BOUND);
        });

        it("Should only allow the owner to set the pool address", async function () {
            // Deploy a new model for this test to avoid PoolAlreadySet error
            const TimeWeightedInterestRateModel = await ethers.getContractFactory(
                "TimeWeightedInterestRateModel"
            );
            const newModel = await TimeWeightedInterestRateModel.deploy(
                MIN_APR,
                MAX_APR,
                INITIAL_APR,
                ADJUSTMENT_SPEED,
                LOWER_BOUND,
                UPPER_BOUND,
                addr1.address // Deploy with a non-owner admin
            );

            await expect(
                newModel.connect(owner).setPool(addr1.address)
            ).to.be.revertedWithCustomError(newModel, "OwnableUnauthorizedAccount");
        });
    });

    describe("Rate Adjustments", function () {
        it("Should increase APR when utilization is above the upper bound", async function () {
            await mockPool.setUtilization(81n * 10n ** 16n); // 81%
            await mockPool.triggerRateUpdate();
            const newRate = await model.currentAPR();
            expect(newRate).to.be.gt(INITIAL_APR);
        });

        it("Should decrease APR when utilization is below the lower bound", async function () {
            await mockPool.setUtilization(59n * 10n ** 16n); // 59%
            await mockPool.triggerRateUpdate();
            const newRate = await model.currentAPR();
            expect(newRate).to.be.lt(INITIAL_APR);
        });

        it("Should revert to neutral APR when utilization is within the band", async function () {
            // First, move APR away from neutral
            await mockPool.setUtilization(90n * 10n ** 16n); // 90%
            await mockPool.triggerRateUpdate();
            const increasedRate = await model.currentAPR();
            expect(increasedRate).to.be.gt(INITIAL_APR);

            // Now, bring it back to neutral
            await mockPool.setUtilization(70n * 10n ** 16n); // 70%
            await mockPool.triggerRateUpdate();
            const neutralRate = await model.currentAPR();
            // Use a small tolerance for floating point inaccuracies
            expect(neutralRate).to.be.closeTo(INITIAL_APR, 1000);
        });

        it("Should respect the max APR bound", async function () {
            await model.setParameters(
                MAX_APR, // Set min APR equal to max APR
                MAX_APR,
                MAX_APR,
                ADJUSTMENT_SPEED,
                LOWER_BOUND,
                UPPER_BOUND
            );

            await mockPool.setUtilization(90n * 10n ** 16n); // 90%
            await mockPool.triggerRateUpdate();

            const newRate = await model.currentAPR();
            expect(newRate).to.equal(MAX_APR);
        });

        it("Should respect the min APR bound", async function () {
            await model.setParameters(
                MIN_APR,
                MIN_APR, // Set max APR equal to min APR
                MIN_APR,
                ADJUSTMENT_SPEED,
                LOWER_BOUND,
                UPPER_BOUND
            );

            await mockPool.setUtilization(10n * 10n ** 16n); // 10%
            await mockPool.triggerRateUpdate();

            const newRate = await model.currentAPR();
            expect(newRate).to.equal(MIN_APR);
        });
    });

    describe("Admin Functions", function () {
        it("Should only allow the owner to set parameters", async function () {
            await expect(
                model
                    .connect(addr1)
                    .setParameters(0, 0, 0, 0, 0, 0)
            ).to.be.revertedWithCustomError(model, "OwnableUnauthorizedAccount");
        });

        it("Should only allow the configured pool to update the rate", async function () {
            await expect(
                model.connect(addr1).updateBorrowRate(80n * 10n ** 16n)
            ).to.be.revertedWithCustomError(model, "UnauthorizedUpdater");
        });
    });
});
