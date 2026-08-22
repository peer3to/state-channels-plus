import { HardhatUserConfig, task, types } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";
import { TASK_TEST } from "hardhat/builtin-tasks/task-names";
import "./tasks/forgeTest";

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
            // E2E parallel runs cram many concurrent games' txs into one node's
            // 1s-interval blocks (not production's load profile, which spreads over
            // time), so a realistic 30M block starves them. Raise it for
            // interval-mined runs (gated on E2E_INTERVAL_MINING); direct Hardhat
            // commands keep the realistic default.
            blockGasLimit:
                process.env.E2E_INTERVAL_MINING === "1"
                    ? 1_000_000_000
                    : 30_000_000,
            initialDate: new Date().toISOString(),
            // 400 accounts = 40 concurrent slots × SLOT_STRIDE(10).
            // Keep in sync with SLOT_STRIDE in test/harness/core/slotAccounts.ts
            // and the pool cap in scripts/test-e2e-parallel.js.
            accounts: {
                mnemonic:
                    "test test test test test test test test test test test junk",
                count: 400
            },
            // Interval-mined runs set E2E_INTERVAL_MINING=1 → automine OFF + a
            // 1s interval, so block-time tracks wall-clock, ordered nonce batches
            // can enter the mempool together, and the SDK's real-time dispute
            // timers stay in sync with on-chain deadlines (replaces the removed
            // harness startAutoTimeAdvance). Direct Hardhat commands keep default
            // automine for instant, awaited-free tx inclusion.
            mining:
                process.env.E2E_INTERVAL_MINING === "1"
                    ? { auto: false, interval: 1000 }
                    : { auto: true }
        },
        localhost: {
            // Env-driven so the worker-mode e2e run can point hardhat's deploy
            // network, the worker's PROVIDER_URL, and the external node at one URL.
            url: process.env.HARDHAT_NODE_URL ?? "http://127.0.0.1:8545",
            // count: 400 matches the hardhat network above so account N derives
            // the same address whether running in-process or against an external node.
            accounts: {
                mnemonic:
                    "test test test test test test test test test test test junk",
                count: 400
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
