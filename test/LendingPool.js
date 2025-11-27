const hre = require("hardhat");
const { ethers } = hre;
const { expect } = require("chai");

describe("LendingPool (Multi-Asset)", function () {
    let pool;
    let priceOracle;
    let token1, token2;
    let irm1, irm2;
    let owner, user1, user2;

    const toWei = (amount, decimals = 18) => ethers.parseUnits(amount.toString(), decimals);
    const fromWei = (amount, decimals = 18) => ethers.formatUnits(amount.toString(), decimals);

    // Helper for oracle's 8-decimal precision
    const toOracle = (amount) => ethers.parseUnits(amount.toString(), 8);
    const fromOracle = (amount) => ethers.formatUnits(amount.toString(), 8);

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy MockPriceOracle
        const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
        priceOracle = await MockPriceOracle.deploy(owner.address);

        // Deploy LendingPool
        const LendingPool = await ethers.getContractFactory("LendingPool");
        pool = await LendingPool.deploy(priceOracle.target, owner.address);

        // Deploy two mock ERC20 tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token1 = await MockERC20.deploy("Token A", "TKA");
        token2 = await MockERC20.deploy("Token B", "TKB");

        // Set prices in the oracle
        // TKA price: $100, TKB price: $2000
        await priceOracle.connect(owner).setPrice(token1.target, toWei(100, 8));
        await priceOracle.connect(owner).setPrice(token2.target, toWei(2000, 8));

        // Deploy two interest rate models
        const KinkInterestRateModel = await ethers.getContractFactory("KinkInterestRateModel");
        irm1 = await KinkInterestRateModel.deploy(toWei(0.02, 18), toWei(0.1, 18), toWei(1, 18), toWei(0.8, 18), owner.address);
        irm2 = await KinkInterestRateModel.deploy(toWei(0.03, 18), toWei(0.15, 18), toWei(1.5, 18), toWei(0.8, 18), owner.address);

        // List the assets in the lending pool
        // Asset 1: 75% collateral factor, 5% liquidation bonus
        await pool.connect(owner).listAsset(token1.target, irm1.target, toWei(0.75, 18), toWei(0.05, 18));
        // Asset 2: 80% collateral factor, 8% liquidation bonus
        await pool.connect(owner).listAsset(token2.target, irm2.target, toWei(0.80, 18), toWei(0.08, 18));

        // Mint tokens to users
        await token1.connect(owner).mint(user1.address, toWei(1000)); // 1000 TKA
        await token2.connect(owner).mint(user2.address, toWei(50));   // 50 TKB
    });

    it("should allow a user to deposit an asset", async function () {
        const depositAmount = toWei(100);
        await token1.connect(user1).approve(pool.target, depositAmount);
        await pool.connect(user1).deposit(token1.target, depositAmount);

        const userAccount = await pool.userAccounts(user1.address, token1.target);
        expect(userAccount.shares).to.be.gt(0);

        const amountFromShares = await pool.getAmountForShares.staticCall(token1.target, userAccount.shares);
        expect(amountFromShares).to.equal(depositAmount);
    });

    it("should allow borrowing one asset against another", async function () {
        // User1 deposits 100 TKA (value $10,000)
        const depositAmountTKA = toWei(100);
        await token1.connect(user1).approve(pool.target, depositAmountTKA);
        await pool.connect(user1).deposit(token1.target, depositAmountTKA);

        // User2 deposits 50 TKB (value $100,000) to provide liquidity
        const depositAmountTKB = toWei(50);
        await token2.connect(user2).approve(pool.target, depositAmountTKB);
        await pool.connect(user2).deposit(token2.target, depositAmountTKB);

        // User1's collateral value: $10,000 * 75% = $7,500
        const [collateralValue, borrowValue] = await pool.getAccountLiquidity.staticCall(user1.address);
        expect(borrowValue).to.equal(0);
        // The oracle has 8 decimals, so we expect the value in that precision
        expect(collateralValue).to.equal(toOracle(7500));

        // User1 borrows 3 TKB (value $6,000)
        const borrowAmountTKB = toWei(3);
        await pool.connect(user1).borrow(token2.target, borrowAmountTKB);

        const user1TKBBalance = await token2.balanceOf(user1.address);
        expect(user1TKBBalance).to.equal(borrowAmountTKB);

        const [, newBorrowValue] = await pool.getAccountLiquidity.staticCall(user1.address);
        // The borrow value is also in 8-decimal precision
        expect(newBorrowValue).to.be.closeTo(toOracle(6000), toOracle(1));
    });

    it("should prevent borrowing beyond collateral factor", async function () {
        // User1 deposits 100 TKA (value $10,000, collateral value $7,500)
        const depositAmountTKA = toWei(100);
        await token1.connect(user1).approve(pool.target, depositAmountTKA);
        await pool.connect(user1).deposit(token1.target, depositAmountTKA);

        // User2 deposits liquidity
        await token2.connect(user2).approve(pool.target, toWei(50));
        await pool.connect(user2).deposit(token2.target, toWei(50));

        // Try to borrow 4 TKB (value $8,000), which is more than $7,500 collateral value
        const borrowAmountTKB = toWei(4);
        await expect(pool.connect(user1).borrow(token2.target, borrowAmountTKB)).to.be.revertedWithCustomError(pool, "InsufficientCollateral");
    });
    
    it("should accrue interest and allow repayment", async function () {
        // User1 deposits collateral
        await token1.connect(user1).approve(pool.target, toWei(100));
        await pool.connect(user1).deposit(token1.target, toWei(100));

        // User2 deposits borrowable asset
        await token2.connect(user2).approve(pool.target, toWei(10));
        await pool.connect(user2).deposit(token2.target, toWei(10));

        // User1 borrows 1 TKB
        const borrowAmount = toWei(1);
        await pool.connect(user1).borrow(token2.target, borrowAmount);

        // Time passes
        await hre.ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]); // 1 year
        
        // Accrue interest by making a state-changing call. A zero-amount borrow is simple.
        await pool.connect(user1).borrow(token2.target, 0);

        const totalDebt = await pool.getTotalDebt(token2.target, user1.address);
        expect(totalDebt).to.be.gt(borrowAmount);

        // User1 repays the full debt
        await token2.connect(owner).mint(user1.address, totalDebt); // Mint enough to repay
        await token2.connect(user1).approve(pool.target, ethers.MaxUint256);
        await pool.connect(user1).repay(token2.target, ethers.MaxUint256);

        const finalUserAccount = await pool.userAccounts(user1.address, token2.target);
        expect(finalUserAccount.borrowPrincipal).to.equal(0);
    });

    describe("Liquidation Scenarios", function () {
        beforeEach(async function() {
            // Setup a common scenario for liquidation tests
            // User1 (borrower) deposits 10 TKA as collateral (value $1,000, collateral value $750)
            const depositAmountTKA = toWei(10);
            await token1.connect(owner).mint(user1.address, depositAmountTKA);
            await token1.connect(user1).approve(pool.target, depositAmountTKA);
            await pool.connect(user1).deposit(token1.target, depositAmountTKA);

            // User2 (liquidator) deposits 1 TKB for liquidity (value $2,000)
            const depositAmountTKB = toWei(1);
            await token2.connect(owner).mint(user2.address, depositAmountTKB);
            await token2.connect(user2).approve(pool.target, depositAmountTKB);
            await pool.connect(user2).deposit(token2.target, depositAmountTKB);

            // User1 borrows 0.3 TKB (value $600)
            const borrowAmountTKB = toWei(0.3);
            await pool.connect(user1).borrow(token2.target, borrowAmountTKB);
        });

        it("should prevent liquidation of a healthy position", async function () {
            // Position is currently healthy.
            // Collateral value: $1000 * 75% = $750. Borrow value: $600.
            const repayAmount = toWei(0.1);
            await token2.connect(owner).mint(user2.address, repayAmount);
            await token2.connect(user2).approve(pool.target, repayAmount);

            await expect(
                pool.connect(user2).liquidate(user1.address, token2.target, token1.target, repayAmount)
            ).to.be.revertedWithCustomError(pool, "LiquidationNotPossible");
        });

        it("should allow partial liquidation for an unhealthy position", async function () {
            // Make position unhealthy
            await priceOracle.connect(owner).setPrice(token1.target, toOracle(50)); // Collateral value drops to $375

            // Liquidator repays half the debt
            const repayAmount = toWei(0.15);
            await token2.connect(owner).mint(user2.address, repayAmount);
            await token2.connect(user2).approve(pool.target, repayAmount);

            const user1CollateralShares_before = (await pool.userAccounts(user1.address, token1.target)).shares;

            await pool.connect(user2).liquidate(user1.address, token2.target, token1.target, repayAmount);

            const liquidatorCollateralShares = (await pool.userAccounts(user2.address, token1.target)).shares;
            const user1CollateralShares_after = (await pool.userAccounts(user1.address, token1.target)).shares;

            expect(liquidatorCollateralShares).to.be.gt(0);
            expect(user1CollateralShares_after).to.be.lt(user1CollateralShares_before);
        });

        it("should allow full liquidation for an unhealthy position using max uint", async function () {
            // Make position unhealthy
            await priceOracle.connect(owner).setPrice(token1.target, toOracle(50)); // Collateral value drops to $375

            // Liquidator signals to repay the full debt using MaxUint256
            await pool.accrueInterest(token2.target); // Accrue interest
            const userBorrowAcc = await pool.userAccounts(user1.address, token2.target);
            const poolAccount = await pool.poolAccounts(token2.target);
            const totalDebt = (userBorrowAcc.borrowPrincipal * poolAccount.borrowIndex) / userBorrowAcc.borrowIndex;
            
            await token2.connect(owner).mint(user2.address, totalDebt);
            await token2.connect(user2).approve(pool.target, ethers.MaxUint256);

            await pool.connect(user2).liquidate(user1.address, token2.target, token1.target, ethers.MaxUint256);

            const finalBorrowerAcc = await pool.userAccounts(user1.address, token2.target);
            expect(finalBorrowerAcc.borrowPrincipal).to.equal(0);

            const liquidatorCollateralShares = (await pool.userAccounts(user2.address, token1.target)).shares;
            expect(liquidatorCollateralShares).to.be.gt(0);
        });
    });
});