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
            gas: "auto",
            initialDate: new Date().toISOString(),
            // E2E runs set E2E_INTERVAL_MINING=1 → automine OFF + a 2s interval,
            // so block-time tracks wall-clock and the SDK's real-time dispute
            // timers stay in sync with on-chain deadlines (replaces the removed
            // harness startAutoTimeAdvance). Everything else (unit tests, normal
            // hardhat use) keeps default automine for instant, awaited-free tx
            // inclusion.
            mining:
                process.env.E2E_INTERVAL_MINING === "1"
                    ? { auto: false, interval: 2000 }
                    : { auto: true, interval: 2000 }
        },
        localhost: {
            // Env-driven so the worker-mode e2e run can point hardhat's deploy
            // network, the worker's PROVIDER_URL, and the external node at one URL.
            url: process.env.HARDHAT_NODE_URL ?? "http://127.0.0.1:8545",
            accounts: {
                mnemonic:
                    "test test test test test test test test test test test junk"
            }
        },
        node: {
            url: "http://srbpi.duckdns.org:8545"
        }
    },
    mocha: {
        // hardhat-toolbox default is 40s; slowest E2E paths (e.g. setupTwoLeaversAcrossMilestones
        // + dispute fraud-proof waits) are ~35–45s sequential, a bit more under parallel CI load.
        timeout: 90000
    },
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
