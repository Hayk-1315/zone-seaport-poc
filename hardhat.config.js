require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true, // ok
    },
  },
    networks: {
    hardhat: {
      forking: {
        url: process.env.SEPOLIA_RPC_URL, 
      },
      chainId: 11155111, // Sepolia
    },
  }
};