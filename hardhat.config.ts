import { HardhatUserConfig, task, types } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";
import { TASK_TEST } from "hardhat/builtin-tasks/task-names";
import "./tasks/forgeTest";

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

// Keep in sync with test/harness/core/slotAccounts.ts (SLOT_STRIDE) and the
// pool cap in scripts/e2e-parallel/shared/constants.js (ACCOUNT_POOL_SIZE).
const SLOT_STRIDE = 10;
const ACCOUNT_POOL_SIZE = 400;
const HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

/**
 * The parallel runner injects E2E_SLOT_INDEX and a test process only ever
 * touches its own slot window (slot × SLOT_STRIDE … + SLOT_STRIDE − 1), so it
 * derives just that window: hardhat runs the mnemonic's PBKDF2 once per
 * account, and the full 400-account pool costs ~2 s of main-thread CPU per
 * process. The shared node (`hardhat node`) and direct hardhat commands carry
 * no slot index and keep the whole pool, so every partition stays funded and
 * account N derives the same address everywhere.
 */
function hdAccounts() {
    const slot = Number(process.env.E2E_SLOT_INDEX);
    if (process.env.E2E_SLOT_INDEX === undefined || !Number.isFinite(slot))
        return { mnemonic: HARDHAT_MNEMONIC, count: ACCOUNT_POOL_SIZE };
    return {
        mnemonic: HARDHAT_MNEMONIC,
        initialIndex: slot * SLOT_STRIDE,
        count: SLOT_STRIDE
    };
}

/**
 * @type {HardhatUserConfig}
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
            // 400 accounts = 40 concurrent slots × SLOT_STRIDE(10), or one
            // slot window under the parallel runner (see hdAccounts).
            accounts: hdAccounts(),
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
            // Same derivation as the hardhat network above, so account N derives
            // the same address whether running in-process or against an external node.
            accounts: hdAccounts()
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
