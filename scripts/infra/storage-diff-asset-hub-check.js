#!/usr/bin/env node

// Read-only completeness check of the storage diff service's backfill against
// a Polkadot Asset Hub node. See "Checking a backfill against Asset Hub" in
// scripts/infra/README.md. With --progress-file a killed run resumes where it
// stopped instead of starting from zero.

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

process.env.TS_NODE_PROJECT ||= path.join(
    __dirname,
    "..",
    "..",
    "tsconfig.json"
);
require("ts-node/register");
const {
    ChildTrieBlockSource
} = require("../../src/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource");
const {
    ContractBackfill
} = require("../../src/utils/node/storageDiff/ContractBackfill");
const {
    UpstreamRpcClient
} = require("../../src/utils/node/storageDiff/UpstreamRpcClient");
const {
    childStorageKey,
    compareChildTrie,
    reviveAccountInfoKey,
    trieIdOf
} = require("../../src/utils/node/storageDiff/assetHubStateCheck");

const CHILD_KEYS_PAGE = 1000;
const READ_BATCH = 200;
// blocks traced between two saves of the progress, in parallel lanes
const TRACE_CHUNK = 64;
const TRACE_LANES = 4;

const { values } = parseArgs({
    options: {
        address: { type: "string" },
        "eth-rpc": { type: "string", default: "wss://eth-rpc.polkadot.io" },
        substrate: {
            type: "string",
            default: "wss://polkadot-asset-hub-rpc.polkadot.io"
        },
        // blocks behind the best head the check reads at, clear of reorgs
        depth: { type: "string", default: "10" },
        "progress-file": { type: "string" }
    }
});
if (!values.address) {
    // eslint-disable-next-line no-console
    console.error(
        "usage: --address 0x... [--eth-rpc ws] [--substrate ws] [--progress-file path]"
    );
    process.exit(2);
}
const address = values.address.toLowerCase();
const log = (event) => console.log(JSON.stringify(event)); // eslint-disable-line no-console
const hex = (n) => "0x" + n.toString(16);

const ZERO_COST = {
    codeProbes: 0,
    blockReads: 0,
    rootReads: 0,
    traces: 0,
    stateReads: 0,
    roundTrips: 0
};

function load() {
    const file = values["progress-file"];
    if (file && fs.existsSync(file))
        return JSON.parse(fs.readFileSync(file, "utf8"));
    return { cost: { ...ZERO_COST }, activeMs: 0, runs: 0 };
}

function save(progress) {
    const file = values["progress-file"];
    if (!file) return;
    fs.writeFileSync(file + ".tmp", JSON.stringify(progress));
    fs.renameSync(file + ".tmp", file);
}

async function inBatches(client, calls) {
    const answers = [];
    for (let i = 0; i < calls.length; i += READ_BATCH)
        answers.push(
            ...(await Promise.all(
                client.requestBatch(calls.slice(i, i + READ_BATCH))
            ))
        );
    return answers;
}

async function main() {
    const handlers = { onLost: (error) => log({ lost: error.message }) };
    const eth = await UpstreamRpcClient.connect(values["eth-rpc"], handlers);
    const sub = await UpstreamRpcClient.connect(values.substrate, handlers);
    const source = new ChildTrieBlockSource(values.substrate);
    const progress = load();
    progress.runs++;
    const runStarted = Date.now();
    const activeBefore = progress.activeMs;
    const backfill = new ContractBackfill(eth, address, source);
    // cost spent by this run's backfill so far, added to the saved totals
    const savedCost = { ...progress.cost };
    const checkpoint = () => {
        const spent = backfill.spent;
        for (const key of Object.keys(ZERO_COST))
            progress.cost[key] = savedCost[key] + spent[key];
        progress.activeMs = activeBefore + (Date.now() - runStarted);
        save(progress);
    };
    try {
        if (!progress.tip) {
            const best = Number(await eth.request("eth_blockNumber", []));
            const number = best - Number(values.depth);
            const ethTip = await eth.request("eth_getBlockByNumber", [
                hex(number),
                false
            ]);
            const subHash = await sub.request("chain_getBlockHash", [number]);
            progress.tip = { number, ethHash: ethTip.hash, subHash };
            checkpoint();
        }
        const tip = {
            number: BigInt(progress.tip.number),
            hash: progress.tip.ethHash
        };
        log({ step: "tip", ...progress.tip, run: progress.runs });

        if (progress.deploy === undefined) {
            const deploy = await backfill.findDeployBlock(tip.number);
            if (deploy === undefined)
                throw new Error("The address has no code");
            progress.deploy = Number(deploy);
            checkpoint();
        }
        log({ step: "deploy", block: progress.deploy });

        if (!progress.numbers) {
            const listing = await source.listBlocks(
                eth,
                address,
                BigInt(progress.deploy),
                tip
            );
            progress.numbers = listing.numbers.map(Number);
            progress.blocks = listing.blocks;
            progress.cost.rootReads += listing.rootReads;
            progress.cost.roundTrips += listing.roundTrips;
            savedCost.rootReads += listing.rootReads;
            savedCost.roundTrips += listing.roundTrips;
            progress.keys = [];
            progress.traced = 0;
            checkpoint();
        }
        log({
            step: "changedBlocks",
            blocksSinceDeploy: progress.blocks,
            changed: progress.numbers.length,
            rootReads: progress.cost.rootReads
        });

        const keys = new Set(progress.keys);
        while (progress.traced < progress.numbers.length) {
            const chunk = progress.numbers
                .slice(progress.traced, progress.traced + TRACE_CHUNK)
                .map(BigInt);
            const lane = Math.ceil(chunk.length / TRACE_LANES);
            const found = await Promise.all(
                [...Array(TRACE_LANES).keys()].map((i) =>
                    backfill.traceKeys(chunk.slice(i * lane, (i + 1) * lane))
                )
            );
            for (const slots of found) for (const slot of slots) keys.add(slot);
            progress.traced += chunk.length;
            progress.keys = [...keys];
            checkpoint();
            if (progress.traced % (TRACE_CHUNK * 5) < TRACE_CHUNK)
                log({
                    step: "tracing",
                    traced: progress.traced,
                    of: progress.numbers.length,
                    keys: keys.size
                });
        }

        const state = await backfill.readState(progress.tip.ethHash, keys);
        checkpoint();
        log({
            step: "backfilled",
            tracedBlocks: progress.numbers.length,
            keys: keys.size,
            nonZeroSlots: Object.keys(state.storage).length
        });

        // the service's own completeness test: the chain's entry count against the backfill's
        const held = await source.countStorageEntries(address, tip);
        const nonZeroSlots = Object.keys(state.storage).length;
        log({
            step: "serviceCheck",
            onChain: held,
            backfilled: nonZeroSlots,
            serviceMarksComplete: held === nonZeroSlots
        });

        // the check: every child trie entry at the same block, from the node
        const info = await sub.request("state_getStorage", [
            reviveAccountInfoKey(address),
            progress.tip.subHash
        ]);
        const rootKey = childStorageKey(trieIdOf(info));
        const childKeys = [];
        for (;;) {
            const page = await sub.request("childstate_getKeysPaged", [
                rootKey,
                "0x",
                CHILD_KEYS_PAGE,
                childKeys.at(-1) ?? null,
                progress.tip.subHash
            ]);
            childKeys.push(...page);
            if (page.length < CHILD_KEYS_PAGE) break;
        }
        const words = await inBatches(
            sub,
            childKeys.map((key) => ({
                method: "childstate_getStorage",
                params: [rootKey, key, progress.tip.subHash]
            }))
        );
        const entries = new Map(
            childKeys.map((key, i) => [
                key,
                "0x" + words[i].slice(2).padStart(64, "0")
            ])
        );
        const result = compareChildTrie(state.storage, entries);
        const complete =
            result.missing.length === 0 &&
            result.extra.length === 0 &&
            result.differing.length === 0;
        checkpoint();
        log({
            step: "check",
            complete,
            nodeEntries: result.nodeEntries,
            cachedSlots: result.cachedSlots,
            missing: result.missing,
            extra: result.extra,
            differing: result.differing,
            tracedKeysNotInNode: keys.size - result.nodeEntries,
            cost: progress.cost,
            activeSeconds: progress.activeMs / 1000,
            runs: progress.runs
        });
        process.exitCode = complete ? 0 : 1;
    } finally {
        checkpoint();
        source.close();
        eth.close(new Error("done"));
        sub.close(new Error("done"));
    }
}

main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    }
);
