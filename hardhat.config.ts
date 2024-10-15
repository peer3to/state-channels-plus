import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true
        },
        localhost: {
            url: "http://127.0.0.1:8545"
        },
        node: {
            url: "http://srbpi.duckdns.org:8545"
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
    // solidity: "0.8.26"
};

export default config;
