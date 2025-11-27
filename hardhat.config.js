require("@nomicfoundation/hardhat-toolbox");
// require("./tasks/governance");

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
    sepolia: {
      url: process.env.SEPOLIA_RPC || "http://127.0.0.1:8545",
      accounts: process.env.PRIVATE_KEYS
        ? process.env.PRIVATE_KEYS.split(",")
        : undefined,
    },
    amoy: {
      url: process.env.AMOY_RPC || "http://127.0.0.1:9545",
      accounts: process.env.PRIVATE_KEYS
        ? process.env.PRIVATE_KEYS.split(",")
        : undefined,
    },
  },
};
