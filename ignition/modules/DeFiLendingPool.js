const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("DeFiLendingPool", (m) => {
  // Deploy MockERC20 token
  const token = m.contract("MockERC20", ["Test Token", "TEST"]);

  // Deploy KinkInterestRateModel with parameters:
  // - 2% base APR
  // - 10% slope APR (low)
  // - 300% slope APR (high) 
  // - 80% optimal utilization
  const interestRateModel = m.contract("KinkInterestRateModel", [
    m.parseUnits("2", 16),   // 2% base APR
    m.parseUnits("10", 16),  // 10% slope APR (low)
    m.parseUnits("300", 16), // 300% slope APR (high)
    m.parseUnits("80", 16)   // 80% optimal utilization
  ]);

  // Deploy LendingPool with:
  // - Token as underlying asset
  // - Interest rate model
  // - 75% collateral factor
  const lendingPool = m.contract("LendingPool", [
    token,
    interestRateModel,
    m.parseUnits("75", 16)  // 75% collateral factor
  ]);

  return { 
    token, 
    interestRateModel, 
    lendingPool 
  };
});