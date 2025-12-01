require("@nomicfoundation/hardhat-toolbox");
// require("./tasks/governance");

/**
 * ⚠️  IMPORTANT: This project is configured for TEST NETWORKS ONLY
 * 
 * Supported networks:
 * - localhost (Hardhat local node) - RECOMMENDED for development
 * - hardhat (in-memory network for tests)
 * 
 * DO NOT deploy to mainnet networks (Ethereum, Polygon, etc.)
 * This is a learning/demo project and is not audited for production use.
 */

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: false,
    },
  },
  gasReporter: {
    enabled: true,
  },
  networks: {
    // ✅ RECOMMENDED: Local Hardhat node (free, no gas fees)
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // ✅ In-memory Hardhat network (for automated tests)
    hardhat: {
      chainId: 31337,
    },
  },
  // Block mainnet deployments
  mocha: {
    timeout: 100000,
  },
};
