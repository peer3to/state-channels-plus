#!/usr/bin/env node

// Read-only completeness check of the storage diff service's backfill against
// a Polkadot Asset Hub node. See "Checking a backfill against Asset Hub" in
// scripts/infra/README.md.

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
    ContractBackfill
} = require("../../src/utils/node/storageDiff/ContractBackfill");
const {
    UpstreamRpcClient
} = require("../../src/utils/node/storageDiff/UpstreamRpcClient");
const {
    childStorageKey,
    compareChildTrie,
    findChangedBlocks,
    reviveAccountInfoKey,
    trieIdOf
} = require("../../src/utils/node/storageDiff/assetHubStateCheck");

const CHILD_KEYS_PAGE = 1000;
const READ_BATCH = 200;

const { values } = parseArgs({
    options: {
        address: { type: "string" },
        "eth-rpc": { type: "string", default: "wss://eth-rpc.polkadot.io" },
        substrate: {
            type: "string",
            default: "wss://polkadot-asset-hub-rpc.polkadot.io"
        },
        // blocks behind the best head the check reads at, clear of reorgs
        depth: { type: "string", default: "10" }
    }
});
if (!values.address) {
    // eslint-disable-next-line no-console
    console.error("usage: --address 0x... [--eth-rpc ws] [--substrate ws]");
    process.exit(2);
}
const address = values.address.toLowerCase();
const log = (event) => console.log(JSON.stringify(event)); // eslint-disable-line no-console
const hex = (n) => "0x" + n.toString(16);

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
    try {
        const started = Date.now();
        const best = Number(await eth.request("eth_blockNumber", []));
        const tip = BigInt(best - Number(values.depth));
        const ethTip = await eth.request("eth_getBlockByNumber", [
            hex(tip),
            false
        ]);
        const subHash = await sub.request("chain_getBlockHash", [Number(tip)]);
        log({
            step: "tip",
            number: Number(tip),
            ethHash: ethTip.hash,
            subHash
        });

        // backfill, same code as the service: deploy block, traced keys, values
        const backfill = new ContractBackfill(eth, address);
        const deploy = await backfill.findDeployBlock(tip);
        if (deploy === undefined) throw new Error("The address has no code");
        log({
            step: "deploy",
            block: Number(deploy),
            codeProbes: backfill.spent.codeProbes
        });

        // block finder: bisect the child trie root instead of listing every block
        const info = await sub.request("state_getStorage", [
            reviveAccountInfoKey(address),
            subHash
        ]);
        const trieId = trieIdOf(info);
        if (!trieId) throw new Error("The address is not a contract");
        const rootKey = childStorageKey(trieId);
        const rootsAt = async (blocks) => {
            const hashes = await Promise.all(
                sub.requestBatch(
                    blocks.map((n) => ({
                        method: "chain_getBlockHash",
                        params: [n]
                    }))
                )
            );
            const roots = await inBatches(
                sub,
                hashes.map((hash) => ({
                    method: "state_getStorage",
                    params: [rootKey, hash]
                }))
            );
            return roots.map((root) => root ?? undefined);
        };
        const found = await findChangedBlocks(
            rootsAt,
            Number(deploy) - 1,
            Number(tip)
        );
        log({
            step: "changedBlocks",
            blocksSinceDeploy: Number(tip - deploy) + 1,
            changed: found.changed.length,
            rootReads: found.rootReads,
            roundTrips: found.roundTrips,
            blocks: found.changed
        });

        const keys = await backfill.traceKeys(found.changed.map(BigInt));
        const state = await backfill.readState(ethTip.hash, keys);
        log({
            step: "backfilled",
            tracedBlocks: found.changed.length,
            keys: keys.size,
            nonZeroSlots: Object.keys(state.storage).length,
            cost: backfill.spent
        });

        // the check: every child trie entry at the same block, from the node
        const childKeys = [];
        for (;;) {
            const page = await sub.request("childstate_getKeysPaged", [
                rootKey,
                "0x",
                CHILD_KEYS_PAGE,
                childKeys.at(-1) ?? null,
                subHash
            ]);
            childKeys.push(...page);
            if (page.length < CHILD_KEYS_PAGE) break;
        }
        const words = await inBatches(
            sub,
            childKeys.map((key) => ({
                method: "childstate_getStorage",
                params: [rootKey, key, subHash]
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
        log({
            step: "check",
            complete,
            nodeEntries: result.nodeEntries,
            cachedSlots: result.cachedSlots,
            missing: result.missing,
            extra: result.extra,
            differing: result.differing,
            seconds: (Date.now() - started) / 1000
        });
        process.exitCode = complete ? 0 : 1;
    } finally {
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
