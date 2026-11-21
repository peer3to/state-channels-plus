/* eslint-disable no-console */
const {
    AccountPartitionPool,
    accountPartitionFor
} = require("./accountPartitionPool");
const { ACCOUNT_SLOT_STRIDE } = require("./constants");
const { requiresChainSlot } = require("./taskRunners");
const { buildSlotEnv } = require("./scheduling");
const { HDNodeWallet, Mnemonic } = require("ethers");

/** The test accounts' mnemonic (hardhat.config.ts, the parachain test chain). */
const TEST_MNEMONIC =
    "test test test test test test test test test test test junk";
/** How long a finished task's transactions may stay in its slot node's pool. */
const PARTITION_SETTLE_MS = 60_000;
const SETTLE_POLL_MS = 500;
/** One read's bound: a node that never answers must not hold the partition past the deadline. */
const SETTLE_READ_MS = 5_000;

/** Each partition's account addresses, derived once. */
const partitionAddresses = new Map();

function addressesOf(partition) {
    if (!partitionAddresses.has(partition)) {
        const mnemonic = Mnemonic.fromPhrase(TEST_MNEMONIC);
        partitionAddresses.set(
            partition,
            Array.from({ length: ACCOUNT_SLOT_STRIDE }, (_, offset) => {
                const index = partition * ACCOUNT_SLOT_STRIDE + offset;
                return HDNodeWallet.fromMnemonic(
                    mnemonic,
                    `m/44'/60'/0'/0/${index}`
                ).address;
            })
        );
    }
    return partitionAddresses.get(partition);
}

/**
 * Whether no account of `partition` has a ready transaction in the node's
 * pool. A transaction queued behind a dropped one's nonce gap is not seen: the
 * parachain node serves no txpool RPC, and pending counts only ready ones.
 */
async function isPartitionSettled(nodeUrl, partition) {
    const calls = addressesOf(partition).flatMap((address) =>
        ["latest", "pending"].map((tag) => ({
            jsonrpc: "2.0",
            id: `${address}:${tag}`,
            method: "eth_getTransactionCount",
            params: [address, tag]
        }))
    );
    const response = await fetch(nodeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(calls),
        signal: AbortSignal.timeout(SETTLE_READ_MS)
    });
    const answers = await response.json();
    if (!Array.isArray(answers))
        throw new Error(`${nodeUrl} refused a JSON-RPC batch`);
    const counts = new Map(answers.map((answer) => [answer.id, answer.result]));
    return addressesOf(partition).every(
        (address) =>
            counts.get(`${address}:latest`) !== undefined &&
            counts.get(`${address}:latest`) === counts.get(`${address}:pending`)
    );
}

/**
 * Waits until a finished task's transactions have left the slot node's pool.
 * A partition handed on earlier gives the next task a nonce its predecessor's
 * pending or dropped transaction still holds: the new sends collide or queue
 * behind a gap. False after PARTITION_SETTLE_MS: the partition stays out of
 * the pool.
 */
async function settlePartition(
    slot,
    partition,
    { settleMs = PARTITION_SETTLE_MS, pollMs = SETTLE_POLL_MS } = {}
) {
    const deadline = Date.now() + settleMs;
    let lastError;
    for (;;) {
        try {
            if (await isPartitionSettled(slot.nodeUrl, partition)) return true;
        } catch (error) {
            // an unanswered read is not settled
            lastError = error;
        }
        if (Date.now() >= deadline) {
            if (lastError)
                console.warn(
                    `Account partition ${partition}: the last settle read failed: ${lastError.message}`
                );
            return false;
        }
        // unref'd: a run that finished does not wait on a settle
        await new Promise((resolve) => setTimeout(resolve, pollMs).unref());
    }
}

class TaskResourcePool {
    constructor({ baseEnv, slots, accountPartitions, settle }) {
        this.baseEnv = baseEnv;
        this.slots = slots;
        this.accountPartitions =
            accountPartitions || new AccountPartitionPool();
        this.settle = settle ?? settlePartition;
        this.slotSequence = 0;
    }

    canAcquire(task) {
        return (
            (task && !requiresChainSlot(task)) ||
            this.accountPartitions.available.length > 0
        );
    }

    acquire(task) {
        const needsChain = requiresChainSlot(task);
        if (!needsChain) {
            return {
                needsChain,
                accountPartition: null,
                slot: null,
                env: { ...this.baseEnv },
                async release() {}
            };
        }

        const accountPartition = this.accountPartitions.acquire();
        const slot = this.slots.length
            ? this.slots[this.slotSequence++ % this.slots.length]
            : null;
        let released = false;
        return {
            needsChain,
            accountPartition,
            slot,
            env: {
                ...this.baseEnv,
                ...buildSlotEnv(
                    slot,
                    accountPartitionFor(slot, accountPartition)
                )
            },
            // returns the partition once its transactions settled; one that
            // never settles stays leased, out of the pool
            release: async () => {
                if (released) return;
                released = true;
                if (slot && !(await this.settle(slot, accountPartition))) {
                    console.warn(
                        `Account partition ${accountPartition} still has pending transactions on ${slot.nodeUrl}; keeping it out of the pool`
                    );
                    return;
                }
                this.accountPartitions.release(accountPartition);
            }
        };
    }
}

module.exports = {
    TaskResourcePool,
    addressesOf,
    isPartitionSettled,
    settlePartition
};
