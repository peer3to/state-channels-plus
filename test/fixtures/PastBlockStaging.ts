// @spec-test-coverage-ignore: past-block intake staging exercised by explicit BlockQueueManager declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { keepOnlyAuthorSignatures } from "./MilestoneSyncStaging";
import { applyPayloads, withEarlyHeldRequester } from "./SyncProofStaging";
import { BlockOrigin } from "@/storage/QueueStorage";
import type { Hash } from "@/types/types";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;
type HeldTasks = Awaited<
    ReturnType<MathPeerTestHarness["rpcStub"]["holdScheduledTasks"]>
>;

/**
 * Three participants author three final blocks (0, 1, 2); the observer
 * (peer 0) records its confirmation operations from the start. The genuine
 * block at height 1 is captured, then the observer prunes heights 0 and 1,
 * as a compact sync proof leaves them: height 1 is free below its next
 * height 3. With `stripStoredHead`, the observer's stored block 2 keeps only
 * its author's signature, so a full copy of it carries new signatures.
 */
export async function stagePrunedObserver(
    h: MathPeerTestHarness,
    options: { stripStoredHead: boolean }
) {
    await h.lifecycle.start(3, 0);
    const observer = h.getPeer(0);
    const source = h.getPeer(1);
    const control = h.control(observer);
    await control.stub.recordConfirmationOperations().request();
    await h.transition.advanceState({ count: 3, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    const forkId = h.activeForkId!;
    const pruned = (await control.query.getBlockByHeight(forkId, 1).request())!;
    const head = (await h
        .control(source)
        .query.getBlockByHeight(forkId, 2)
        .request())!;
    const { prunedHeights } = await control.stub
        .pruneStoredBlocksBelowAnchor(forkId, 2)
        .request();
    if (options.stripStoredHead)
        await keepOnlyAuthorSignatures(h, observer.index, forkId, [2]);
    return { observer, source, forkId, pruned, head, prunedHeights };
}

/** The prefixes of the queue timeout, of queued-entry execution and of every queue drain task. */
const QUEUE_TIMEOUT = "BlockQueueManager.queueTimeout -";
const QUEUED_EXECUTION = "BlockQueueManager.executeQueuedEntry -";
const QUEUE_DRAINS = [
    "tryExecuteFromQueue",
    "BlockQueueManager.tryExecuteFromQueue -"
];

/**
 * A queued block whose height becomes free under it. An early requester
 * whose gossip is dropped (see `withEarlyHeldRequester`) holds no block after
 * three final blocks. Its queue timeouts, queued-entry executions and queue
 * drains are held. The
 * genuine block 1, ingested from its author, queues above the next height 0.
 * The requester then installs peer 0's served compact sync proof: the next
 * height is 3 and height 1 holds no block. No drain ran, so the entry is
 * still queued and its timeout still held when `run` starts. The holds are
 * dropped at the end.
 */
export async function withQueuedBlockMadePast<T>(
    h: MathPeerTestHarness,
    run: (staged: {
        requester: Peer;
        forkId: string;
        hash: string;
        premise: {
            beforeSync: { queued: boolean; nextHeight: number };
            syncAccepted: boolean;
            queued: boolean;
            heldTimeouts: number;
            nextHeight: number;
            storedAtHeight: string | null;
        };
        queueTimeouts: HeldTasks;
        executions: HeldTasks;
    }) => Promise<T>
): Promise<T> {
    return await withEarlyHeldRequester(
        h,
        { blockCount: 3, gossip: "drop" },
        async (requester, forkId) => {
            const control = h.control(requester);
            const queueTimeouts = await h.rpcStub.holdScheduledTasks(
                requester.index,
                QUEUE_TIMEOUT
            );
            const executions = await h.rpcStub.holdScheduledTasks(
                requester.index,
                QUEUED_EXECUTION
            );
            const drains: HeldTasks[] = [];
            try {
                for (const prefix of QUEUE_DRAINS)
                    drains.push(
                        await h.rpcStub.holdScheduledTasks(
                            requester.index,
                            prefix
                        )
                    );
                const source = h.getPeer(1);
                const block = (await h
                    .control(source)
                    .query.getBlockByHeight(forkId, 1)
                    .request())!;
                await control.transition
                    .ingestBlockConfirmation(block.encodedBlockConfirmation, {
                        origin: BlockOrigin.NETWORK,
                        senderAddress: source.address
                    })
                    .request();
                const beforeSync = {
                    queued: await control.query
                        .isBlockQueued(block.hash)
                        .request(),
                    nextHeight: await control.query
                        .getNextBlockHeight(forkId)
                        .request()
                };
                const { outcomes } = await applyPayloads(h, requester, forkId, [
                    "served"
                ]);
                return await run({
                    requester,
                    forkId,
                    hash: block.hash,
                    premise: {
                        beforeSync,
                        syncAccepted: outcomes[0].accepted,
                        queued: await control.query
                            .isBlockQueued(block.hash)
                            .request(),
                        heldTimeouts: await queueTimeouts.heldCount(),
                        nextHeight: await control.query
                            .getNextBlockHeight(forkId)
                            .request(),
                        storedAtHeight: await control.query
                            .getBlockHashAt(forkId, 1)
                            .request()
                    },
                    queueTimeouts,
                    executions
                });
            } finally {
                await queueTimeouts.release(false);
                await executions.release(false);
                for (const drain of drains) await drain.release(false);
            }
        }
    );
}

/**
 * Put the queued entry `hash` back the way a strategy hook does after
 * `onBlockConfirmation` dequeued it: dequeue it, then hand it to the real
 * `restoreQueuedEntry`. Returns whether the entry is queued after it.
 */
export async function restoreDequeuedEntry(
    h: MathPeerTestHarness,
    requester: Peer,
    hash: string
): Promise<{ queued: boolean }> {
    return await h.execOnHost(
        requester,
        async (sm, a) => {
            const entry = sm.storage.queues.removeBlock(a.hash as Hash);
            if (!entry) throw new Error("the entry is not queued");
            sm.blockQueueManager.restoreQueuedEntry(entry);
            return { queued: !!sm.storage.queues.getQueuedEntry(a.hash) };
        },
        { hash }
    );
}
