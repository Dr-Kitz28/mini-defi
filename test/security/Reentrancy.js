const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("Reentrancy Attack", function () {
    let owner, attackerSigner;
    let lendingPool, priceOracle, maliciousToken, collateralToken, attackerContract, interestRateModel;

    beforeEach(async function () {
        [owner, attackerSigner] = await ethers.getSigners();

        // Deploy MockPriceOracle
        const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
        priceOracle = await MockPriceOracle.deploy(owner.address);
        await priceOracle.waitForDeployment();

        // Deploy an Interest Rate Model
        const LinearInterestRateModel = await ethers.getContractFactory("LinearInterestRateModel");
        interestRateModel = await LinearInterestRateModel.deploy(0, 0, owner.address); // baseRatePerYear, slopePerYear, admin
        await interestRateModel.waitForDeployment();

        // Deploy LendingPool
        const LendingPool = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPool.deploy(priceOracle.target, owner.address);
        await lendingPool.waitForDeployment();

        // Deploy MaliciousERC20
        const MaliciousERC20 = await ethers.getContractFactory("MaliciousERC20");
        maliciousToken = await MaliciousERC20.deploy(lendingPool.target);
        await maliciousToken.waitForDeployment();

        // Deploy a clean collateral token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        collateralToken = await MockERC20.deploy("Collateral", "COL");
        await collateralToken.waitForDeployment();

        // Deploy the attacker contract
        const ReentrancyAttacker = await ethers.getContractFactory("ReentrancyAttacker");
        attackerContract = await ReentrancyAttacker.deploy(lendingPool.target, maliciousToken.target, collateralToken.target);
        await attackerContract.waitForDeployment();

        // List both tokens
        await lendingPool.listAsset(maliciousToken.target, interestRateModel.target, ethers.parseUnits("0.75", 18), ethers.parseUnits("0.05", 18));
        await lendingPool.listAsset(collateralToken.target, interestRateModel.target, ethers.parseUnits("0.75", 18), ethers.parseUnits("0.05", 18));
        
        // Set prices for both tokens
        await priceOracle.setPrice(maliciousToken.target, ethers.parseUnits("1", 8));
        await priceOracle.setPrice(collateralToken.target, ethers.parseUnits("100", 8));

        await maliciousToken.setAttacker(attackerContract.target);

        // Attacker deposits 10 COL collateral
        await collateralToken.mint(attackerSigner.address, ethers.parseEther("10"));
        await collateralToken.connect(attackerSigner).approve(attackerContract.target, ethers.parseEther("10"));
        await attackerContract.connect(attackerSigner).deposit(collateralToken.target, ethers.parseEther("10"));

        // Some other user needs to provide liquidity for the malicious token
        await maliciousToken.mint(owner.address, ethers.parseEther("100"));
        await maliciousToken.connect(owner).approve(lendingPool.target, ethers.parseEther("100"));
        await lendingPool.connect(owner).deposit(maliciousToken.target, ethers.parseEther("100"));

        // Attacker needs to have some malicious tokens to withdraw
        await maliciousToken.mint(attackerSigner.address, ethers.parseEther("10"));
        await maliciousToken.connect(attackerSigner).approve(attackerContract.target, ethers.parseEther("10"));
        await attackerContract.connect(attackerSigner).deposit(maliciousToken.target, ethers.parseEther("10"));
    });

    it("Should prevent re-entrant calls to the withdraw function", async function () {
        // Start the attack by withdrawing the malicious token, which will re-enter on the collateral
        await expect(
            attackerContract.connect(attackerSigner).attack()
        ).to.be.revertedWithCustomError(lendingPool, "ReentrancyGuardReentrantCall");
    });
});
