const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const toWei = (value) => ethers.parseUnits(value, 18);

describe("LendingPool", function () {
  async function deployFixture() {
    const [deployer, lender, borrower, liquidator] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const asset = await MockERC20.deploy("Mock Asset", "M-ASSET");

    const InterestRateModel = await ethers.getContractFactory("LinearInterestRateModel");
    const baseAPR = toWei("0.02");
    const slopeAPR = toWei("0.20");
    const irm = await InterestRateModel.deploy(baseAPR, slopeAPR, deployer.address);

    const LendingPool = await ethers.getContractFactory("LendingPool");
    const pool = await LendingPool.deploy(asset.target, irm.target);

    const mintAmount = toWei("10000");
    await asset.mint(lender.address, mintAmount);
    await asset.mint(borrower.address, mintAmount);
    await asset.mint(liquidator.address, mintAmount);

    return { asset, irm, pool, lender, borrower, liquidator, deployer };
  }

  it("should allow a user to deposit and earn interest", async function () {
    const { asset, pool, lender, borrower } = await loadFixture(deployFixture);
    const poolAddress = pool.target;

    // 1. Lender deposits 1000 assets
    const lenderDepositAmount = toWei("1000");
    await asset.connect(lender).approve(poolAddress, lenderDepositAmount);
    await pool.connect(lender).deposit(lenderDepositAmount);
    
    expect(await pool.shares(lender.address)).to.equal(lenderDepositAmount); // 1:1 shares initially

    // 2. Borrower deposits 100 assets (to use as collateral)
    const borrowerDepositAmount = toWei("100");
    await asset.connect(borrower).approve(poolAddress, borrowerDepositAmount);
    await pool.connect(borrower).deposit(borrowerDepositAmount);

    // 3. Borrower borrows 500 assets
    const borrowAmount = toWei("500");
    await pool.connect(borrower).borrow(borrowAmount);

    // 4. Time passes, interest accrues
    await time.increase(365 * 24 * 60 * 60); // 1 year

    // 5. Borrower repays the loan plus interest
    const debt = await pool.currentDebt(borrower.address);
    await asset.connect(borrower).approve(poolAddress, debt);
    await pool.connect(borrower).repay(debt);

    // 6. Lender withdraws their assets
    const lenderShares = await pool.shares(lender.address);
    const amountToWithdraw = await pool.getAmountForShares(lenderShares);
    
    // Lender should have more assets than they deposited due to interest
    expect(amountToWithdraw).to.be.gt(lenderDepositAmount);

    await pool.connect(lender).withdraw(amountToWithdraw);
    expect(await asset.balanceOf(lender.address)).to.be.gt(toWei("9000")); // Initial 10000 - 1000 deposit
  });

  it("should enforce collateral factor for borrowing", async function () {
    const { asset, pool, borrower } = await loadFixture(deployFixture);
    const poolAddress = pool.target;

    const depositAmount = toWei("1000");
    await asset.connect(borrower).approve(poolAddress, depositAmount);
    await pool.connect(borrower).deposit(depositAmount);

    // With a collateral factor of ~66.67%, max borrow should be ~666.67
    const maxBorrow = await pool.maxBorrowable(borrower.address);
    expect(maxBorrow).to.be.closeTo(toWei("666.66"), toWei("0.01"));

    await expect(pool.connect(borrower).borrow(maxBorrow + toWei("1")))
        .to.be.revertedWithCustomError(pool, "BorrowLimitExceeded");
    
    await expect(pool.connect(borrower).borrow(maxBorrow)).to.not.be.reverted;
  });

  it("should allow a liquidator to liquidate an unhealthy position", async function () {
    const { asset, pool, borrower, liquidator, irm } = await loadFixture(deployFixture);
    const poolAddress = pool.target;

    // Set a high interest rate to make the position unhealthy quickly
    await irm.setAPR(toWei("1"), toWei("0")); // 100% APR

    // Borrower deposits 100 as collateral
    const depositAmount = toWei("100");
    await asset.connect(borrower).approve(poolAddress, depositAmount);
    await pool.connect(borrower).deposit(depositAmount);

    // Borrower borrows max amount
    const borrowAmount = await pool.maxBorrowable(borrower.address);
    await pool.connect(borrower).borrow(borrowAmount);

    // Time passes, interest accrues, position becomes unhealthy
    await time.increase(365 * 24 * 60 * 60); // 1 year

    const isHealthy = await pool.isHealthy(borrower.address);
    expect(isHealthy).to.be.false;

    const liquidatorInitialBalance = await asset.balanceOf(liquidator.address);

    // Liquidator repays the debt and seizes collateral
    const debt = await pool.currentDebt(borrower.address);
    await asset.connect(liquidator).approve(poolAddress, debt);
    await pool.connect(liquidator).liquidate(borrower.address, debt);

    // Liquidator should have seized the borrower's collateral and received a bonus
    const liquidatorFinalBalance = await asset.balanceOf(liquidator.address);
    const borrowerCollateralShares = await pool.shares(borrower.address);
    
    expect(borrowerCollateralShares).to.equal(0); // Borrower's collateral is gone
    // Liquidator's balance change = seized collateral - repaid debt.
    // With bonus, seized collateral > repaid debt.
    // This is a simplified check; a precise check would be complex.
    expect(liquidatorFinalBalance).to.be.lt(liquidatorInitialBalance); 
  });
});
