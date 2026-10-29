import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";

const config: HardhatUserConfig = {
    networks: {
        hardhat: {
            blockGasLimit: 120_000_000,
            gasPrice: 0, // Set gas price to 0
            allowUnlimitedContractSize: true,
            // hardfork: "berlin", // Use the Berlin hardfork
            // minGasPrice: 0, // Set minimum gas price to 0
            initialBaseFeePerGas: 0, // Set initial base fee per gas to 0
            mining: {
                auto: false, // Disable automatic mining
                interval: 2000 // Set block interval to 2 seconds (2000ms)
            },
            accounts: {
                accountsBalance: "10000000000000000000000" // 10,000 ETH
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
    },
    typechain: {
        outDir: "tic-tac-toe-vite/src/stateChannel/typechain-types",
        target: "ethers-v6"
    }
};

export default config;
