const hre = require("hardhat");
const { ethers } = hre;
const { expect } = require("chai");

describe("LendingPool", function () {
    let pool;
    let assetToken;
    let irm;
    let DEPOSIT_AMOUNT = 1000;
    let COLLATERAL_AMOUNT = 200;
    let BORROW_AMOUNT = 50;
    let COLLATERAL_FACTOR = 1000;

    beforeEach(async function () {
        const [owner, lender, borrower, liquidator] = await ethers.getSigners();

        // Deploy the asset token
        const AssetToken = await hre.ethers.getContractFactory("MockERC20");
        assetToken = await AssetToken.deploy("Test Token", "TST");

        const InterestRateModel = await hre.ethers.getContractFactory(
            "TimeWeightedInterestRateModel"
        );
        irm = await InterestRateModel.deploy(
            10000000000000000n, // 1%
            100000000000000000n, // 10%
            20000000000000000n, // 2%
            1000000000000000n, // 0.1%
            600000000000000000n, // 60%
            800000000000000000n, // 80%
            owner.address
        );

        // Deploy the LendingPool
        const LendingPool = await hre.ethers.getContractFactory("LendingPool");
        pool = await LendingPool.deploy(assetToken.target);
        await pool.setIRM(irm.target);
    });

    it("should allow a user to deposit and earn interest", async function () {
        const [owner, lender, borrower] = await ethers.getSigners();

        // Lender deposits
        await assetToken.connect(owner).mint(lender.address, DEPOSIT_AMOUNT);
        await assetToken.connect(lender).approve(pool.target, DEPOSIT_AMOUNT);
        await pool.connect(lender).deposit(DEPOSIT_AMOUNT);

        // Borrower deposits collateral
        await assetToken.connect(owner).mint(borrower.address, COLLATERAL_AMOUNT);
        await assetToken.connect(borrower).approve(pool.target, COLLATERAL_AMOUNT);
        await pool.connect(borrower).deposit(COLLATERAL_AMOUNT);

        // Borrower borrows a significant amount to drive up utilization
        const maxBorrow = await pool.maxBorrowable(borrower.address);
        await pool.connect(borrower).borrow(maxBorrow);

        // Time passes, interest accrues...
        await hre.ethers.provider.send("evm_increaseTime", [3600 * 24 * 365]); // 1 year
        await hre.ethers.provider.send("evm_mine");
        // Trigger interest accrual
        await pool.accrueInterest(borrower.address);

        // Borrower repays the loan + interest
        const debt = (await pool.borrows(borrower.address)).principal;
        await assetToken.connect(owner).mint(borrower.address, debt);
        await assetToken.connect(borrower).approve(pool.target, debt);
        await pool.connect(borrower).repay(debt);

        // Lender withdraws their deposit + interest
        await pool.connect(lender).withdrawAll();
        const finalLenderBalance = await assetToken.balanceOf(lender.address);
        expect(finalLenderBalance).to.be.gt(DEPOSIT_AMOUNT);
    });

    it("should enforce collateral factor for borrowing", async function () {
        const [owner, borrower] = await ethers.getSigners();

        // Borrower deposits 200 tokens as collateral
        await assetToken.connect(owner).mint(borrower.address, COLLATERAL_AMOUNT);
        await assetToken.connect(borrower).approve(pool.target, COLLATERAL_AMOUNT);
        await pool.connect(borrower).deposit(COLLATERAL_AMOUNT);

        // Max borrow is COLLATERAL_AMOUNT * COLLATERAL_FACTOR
        const maxBorrow = await pool.maxBorrowable(borrower.address);

        // Borrowing up to the limit should succeed
        if (maxBorrow > 0) {
            await pool.connect(borrower).borrow(maxBorrow);
            expect(await assetToken.balanceOf(borrower.address)).to.equal(maxBorrow);
        }

        // Trying to borrow even 1 wei more should fail
        await expect(pool.connect(borrower).borrow(1)).to.be.revertedWith("Exceeds collateral factor");
    });

    it("should allow a liquidator to liquidate an unhealthy position", async function () {
        const [owner, lender, borrower, liquidator] = await ethers.getSigners();

        // Set a high interest rate to make the position unhealthy quickly
        await irm.connect(owner).setParameters(
            10000000000000000n, // 1%
            500000000000000000n, // 50%
            100000000000000000n, // 10%
            1000000000000000n, // 0.1%
            600000000000000000n, // 60%
            800000000000000000n // 80%
        );
        await irm.connect(owner).setPool(pool.target);


        // Lender deposits
        await assetToken.connect(owner).mint(lender.address, DEPOSIT_AMOUNT);
        await assetToken.connect(lender).approve(pool.target, DEPOSIT_AMOUNT);
        await pool.connect(lender).deposit(DEPOSIT_AMOUNT);

        // Borrower deposits collateral and borrows
        await assetToken.connect(owner).mint(borrower.address, COLLATERAL_AMOUNT);
        await assetToken.connect(borrower).approve(pool.target, COLLATERAL_AMOUNT);
        await pool.connect(borrower).deposit(COLLATERAL_AMOUNT);
        await pool.connect(borrower).borrow(BORROW_AMOUNT);

        // Interest accrues, making the position unhealthy
        await hre.ethers.provider.send("evm_increaseTime", [3600 * 24 * 365 * 10]); // 10 years
        await hre.ethers.provider.send("evm_mine");
        await pool.accrueInterest(borrower.address); // trigger interest accrual

        expect(await pool.isHealthy(borrower.address)).to.be.false;

        // Liquidator prepares to liquidate
        const debt = (await pool.borrows(borrower.address)).principal;
        const amountToLiquidate = debt / 2n;

        await assetToken.connect(owner).mint(liquidator.address, amountToLiquidate);
        await assetToken.connect(liquidator).approve(pool.target, amountToLiquidate);

        const liquidatorInitialShares = await pool.shares(liquidator.address);
        const liquidatorInitialBalance = await assetToken.balanceOf(liquidator.address);

        // Perform liquidation
        await pool.connect(liquidator).liquidate(borrower.address, amountToLiquidate);

        // Check that the liquidator received collateral shares
        const liquidatorSharesAfter = await pool.shares(liquidator.address);
        expect(liquidatorSharesAfter).to.be.gt(liquidatorInitialShares);

        // Liquidator withdraws their seized collateral to realize the profit
        await pool.connect(liquidator).withdraw(liquidatorSharesAfter - liquidatorInitialShares);
        const liquidatorBalanceAfter = await assetToken.balanceOf(liquidator.address);
        expect(liquidatorBalanceAfter).to.be.gt(liquidatorInitialBalance - amountToLiquidate);
    });
});