import { HardhatUserConfig, task, types } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";
import { TASK_TEST } from "hardhat/builtin-tasks/task-names";

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true,
            gas: "auto"
        },
        localhost: {
            url: "http://127.0.0.1:8545"
        },
        node: {
            url: "http://srbpi.duckdns.org:8545"
        }
    },
    mocha: {},
    solidity: {
        version: "0.8.34",
        settings: {
            viaIR: true, // Enable the via-IR pipeline
            optimizer: {
                enabled: true,
                // details: { yul: false },
                runs: 100
            }
        }
        // overrides: {
        //     "contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol": {
        //         version: "0.8.30",
        //         settings: {
        //             optimizer: {
        //                 enabled: true,
        //                 runs: 100,
        //                 details: { yul: false }
        //             },
        //             viaIR: true
        //         }
        //     }
        // }
    }
    // solidity: "0.8.26"
};

task(TASK_TEST)
    .addOptionalParam(
        "excludeTags",
        "Comma-separated log tags to exclude from output",
        undefined,
        types.string
    )
    .setAction(async (taskArgs, _hre, runSuper) => {
        if (taskArgs.excludeTags) {
            process.env.LOG_EXCLUDE_TAGS = taskArgs.excludeTags;
        }
        return runSuper(taskArgs);
    });

export default config;
