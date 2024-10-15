import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      viaIR: true, // Enable the via-IR pipeline
      optimizer: {
        enabled: true,
        runs: 100,
      },
    },
  },
};

export default config;
