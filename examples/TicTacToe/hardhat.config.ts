import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
    networks: {
        hardhat: {
            gasPrice: 0, // Set gas price to 0
            // hardfork: "berlin", // Use the Berlin hardfork
            // minGasPrice: 0, // Set minimum gas price to 0
            initialBaseFeePerGas: 0, // Set initial base fee per gas to 0
            mining: {
                auto: false, // Disable automatic mining
                interval: 2000 // Set block interval to 2 seconds (2000ms)
            },
            accounts: {
                accountsBalance: "0"
            }
        }
    },
    solidity: {
        version: "0.8.26",
        settings: {
            viaIR: true, // Enable the via-IR pipeline
            optimizer: {
                enabled: true,
                runs: 100
            }
        }
    }
};

export default config;
