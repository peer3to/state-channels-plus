import type { AbstractBatchOperation } from "abstract-level";
import { expect } from "chai";
import { MemoryLevel } from "memory-level";

import { MathTestSession as TestSession, sleep } from "@test/harness";
import * as factory from "@test/factory";
import Storage from "@/storage";
import type { PersistenceDatabaseHandle } from "@/storage/persistence";

/**
 * The durability barrier (`await storage.flush()`) sits immediately before
 * every signature-release broadcast, so no signature is gossiped before the
 * just-signed state is durable. This is the slashing guarantee of the
 * persistence layer.
 *
 * Two release sites, both exercised here against a real StateManager on a real
 * peer (poked host-side through the control RPC):
 *  - SITE 1 (paths A/B) - StateManager.tryCommitState, inside the StateManager
 *    mutex (the step-9 flush before the step-7 gossip).
 *  - SITE 2 (path C) - BlockValidationStrategy.goodNewSignaturesOnExistingBlock,
 *    a detached macrotask outside any mutex.
 *
 * The stuck-barrier condition is reproduced on the live Storage by parking
 * flush() on a releasable gate - the same observable state the controller
 * enters while the database batch hangs (flush() stays pending). The final
 * tests assert that stuck state directly on a real Storage bound to a
 * MemoryLevel database whose batch is gated/failing.
 *
 * The release-site behaviors run in ONE harness session/`it`: the repo's
 * harness cannot stand up a second full peer session in the same process (an
 * unrelated teardown limitation, reproducible with E2E-StateTransition), so
 * the scenarios are sequenced within a single session rather than split
 * across `it`s that would each re-`start()`.
 */

/** Parks a peer's live durability barrier on a releasable gate, host-side. */
function installPendingBarrier(sm: {
    storage: { flush: () => Promise<void> };
}): void {
    const storage = sm.storage as unknown as {
        flush: () => Promise<void>;
        __origFlush?: () => Promise<void>;
        __durabilityGate?: Promise<void>;
        __releaseDurability?: () => void;
    };
    storage.__origFlush = sm.storage.flush.bind(sm.storage);
    storage.__durabilityGate = new Promise<void>((res) => {
        storage.__releaseDurability = res;
    });
    sm.storage.flush = () => storage.__durabilityGate!;
}

/** Releases a parked barrier and restores the real flush. */
function releasePendingBarrier(sm: {
    storage: { flush: () => Promise<void> };
}): void {
    const storage = sm.storage as unknown as {
        flush: () => Promise<void>;
        __origFlush?: () => Promise<void>;
        __releaseDurability?: () => void;
    };
    storage.__releaseDurability?.();
    if (storage.__origFlush) {
        sm.storage.flush = storage.__origFlush;
    }
}

type GatedDatabase = MemoryLevel<string, string>;
type BatchOperation = AbstractBatchOperation<GatedDatabase, string, string>;

/** A MemoryLevel-backed handle whose batch() parks on a releasable gate. */
function createGatedHandle(): {
    handle: PersistenceDatabaseHandle;
    releaseBatch: () => void;
} {
    const database: GatedDatabase = new MemoryLevel({
        keyEncoding: "utf8",
        valueEncoding: "utf8"
    });
    const originalBatch = database.batch.bind(database);
    let releaseBatch!: () => void;
    const gate = new Promise<void>((res) => (releaseBatch = res));
    database.batch = (async (operations: BatchOperation[]): Promise<void> => {
        await gate;
        return originalBatch(operations);
    }) as GatedDatabase["batch"];
    return {
        handle: {
            database,
            location: "memory:durability-barrier-gated",
            close: () => database.close(),
            destroy: () => database.clear()
        },
        releaseBatch
    };
}

/** A MemoryLevel-backed handle whose batch() always fails. */
function createFailingHandle(): PersistenceDatabaseHandle {
    const database: GatedDatabase = new MemoryLevel({
        keyEncoding: "utf8",
        valueEncoding: "utf8"
    });
    database.batch = (async (_operations: BatchOperation[]): Promise<void> => {
        throw new Error("injected commit failure");
    }) as GatedDatabase["batch"];
    return {
        database,
        location: "memory:durability-barrier-failing",
        close: () => database.close(),
        destroy: () => database.clear()
    };
}

describe("E2E: durability barrier (sign-before-durable)", function () {
    it("withholds every release-site broadcast until state is durable; unparked flush broadcasts normally", async function () {
        this.timeout(120000);

        const h = TestSession.getHarness();
        await h.lifecycle.start(2);
        const forkId = h.activeForkId!;

        // ---- unparked flush preserves broadcast behavior ----
        // With the real flush() both release sites fire normally and the
        // peers converge.
        await h.transition.advanceState({ count: 2 });
        await h.assert.sync.peersInSyncWait();
        await h.assert.sync.blockHeight({ expectedHeight: 1 });

        // ---- mutex-path broadcast is withheld while the barrier is pending ----
        const authorIndex = (await h.query.getNextPeerToWrite()).index;
        const author = h.getPeer(authorIndex);
        const receiver = h.peers.find((p) => p.index !== authorIndex)!;

        const receiverHeightBefore = (await h
            .control(receiver)
            .query.getLatestBlockHeight(forkId)
            .request())!;
        const authorHeightBefore = (await h
            .control(author)
            .query.getLatestBlockHeight(forkId)
            .request())!;

        // Park the author's barrier so tryCommitState stalls right after its
        // writes, immediately before the release broadcast.
        await h.execOnHost(author, installPendingBarrier);

        // Fire the author's block; tryCommitState stores it, then blocks at the
        // barrier before broadcasting. It will not resolve until released.
        const submitP = h.transition
            .increment(1, { waitForSync: false })
            .catch((e) => e);

        try {
            // Give tryCommitState time to store the block and reach the barrier.
            await sleep(2500);

            const authorHeightDuring = (await h
                .control(author)
                .query.getLatestBlockHeight(forkId)
                .request())!;
            const receiverHeightDuring = (await h
                .control(receiver)
                .query.getLatestBlockHeight(forkId)
                .request())!;

            // Writes happened (author advanced) but the signature was NOT
            // gossiped: the barrier withholds the broadcast, so the receiver
            // never saw the new block.
            expect(
                authorHeightDuring,
                "author must persist the block before the barrier"
            ).to.equal(authorHeightBefore + 1);
            expect(
                receiverHeightDuring,
                "receiver must not see the withheld broadcast"
            ).to.equal(receiverHeightBefore);
        } finally {
            // Always release so the mutex frees and teardown is clean.
            await h.execOnHost(author, releasePendingBarrier);
        }

        await submitP;

        // Once durable, the withheld broadcast fires and the receiver converges.
        await h.assert.sync.peersInSyncWait();
        const receiverHeightAfter = (await h
            .control(receiver)
            .query.getLatestBlockHeight(forkId)
            .request())!;
        expect(receiverHeightAfter).to.equal(receiverHeightBefore + 1);

        // ---- path-C (stored-merge re-gossip) broadcast is withheld ----
        // The LIVE "new signatures on an already-stored block" re-gossip is
        // reached via the real scheduling entry point
        // BlockQueueManager.scheduleStoredBlockConfirmationMerge — a detached
        // macrotask holding no mutex — which delegates to
        // StateManager.tryMergeStoredBlockConfirmation, which in turn calls
        // strategy.goodNewSignaturesOnExistingBlock (the strategy owns the
        // barrier + broadcast policy). We synthesize the new-signature condition
        // by stripping the confirmation signatures off a stored, co-signed block
        // and feeding the full confirmation back through that scheduler, then
        // assert the merged re-gossip is withheld while the barrier is pending,
        // fires after release, and never raises an unhandled rejection.
        const pathC = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const wait = (ms: number) =>
                    new Promise<void>((r) => setTimeout(r, ms));
                const forkId = sm.forkId;

                // Find a stored, co-signed block (>=1 confirmation signature).
                let full = sm.storage.blocks.getLatestBlock(forkId);
                let height = full ? full.height : -1;
                while (
                    full &&
                    full.confirmationSignatures.size === 0 &&
                    height > 0
                ) {
                    height -= 1;
                    full = sm.storage.blocks.getBlock(forkId, height);
                }
                if (!full || full.confirmationSignatures.size === 0) {
                    return {
                        setupFailed: true,
                        withheldWhilePending: false,
                        unhandledWhilePending: 0,
                        broadcastAfterRelease: false
                    };
                }

                // Strip the confirmation signatures off the RAW stored record
                // so the incoming full confirmation carries them as "new". The
                // deepCopyProxy returns non-function properties as-is, so
                // `records` is the live PersistentCollection and its get() is
                // the uncloned cache entry (a cache-only mutation is exactly
                // what we want here — no persist op for the synthetic strip).
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawBlocks = sm.storage.blocks as any;
                const rawRecord = rawBlocks.records.get(full.hash);
                rawRecord.block.removeConfirmationSignatures(
                    new Set(rawRecord.block.confirmationSignatures)
                );
                const entry = sm.storage.queues.createEntry(full);

                // Count actual re-gossip broadcasts (stable cached service proxy;
                // an own-prop assignment shadows the generated method).
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const svc = sm.p2pManager.remoteRpc
                    .stateTransitionService as any;
                const realOnBlockConfirmation =
                    svc.onBlockConfirmation.bind(svc);
                let broadcasts = 0;
                svc.onBlockConfirmation = (struct: unknown) => {
                    const handle = realOnBlockConfirmation(struct);
                    const realBroadcast = handle.broadcast.bind(handle);
                    handle.broadcast = () => {
                        broadcasts += 1;
                        return realBroadcast();
                    };
                    return handle;
                };

                // Park the barrier on a releasable gate.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const storage = sm.storage as any;
                storage.__origFlush = sm.storage.flush.bind(sm.storage);
                storage.__durabilityGate = new Promise<void>((res) => {
                    storage.__releaseDurability = res;
                });
                sm.storage.flush = () => storage.__durabilityGate;

                let unhandledCount = 0;
                const onUnhandled = () => {
                    unhandledCount += 1;
                };
                process.on("unhandledRejection", onUnhandled);

                try {
                    // Real scheduling entry point -> detached macrotask ->
                    // handleStoredBlockConfirmationMerge ->
                    // tryMergeStoredBlockConfirmation ->
                    // strategy.goodNewSignaturesOnExistingBlock -> storeBlock ->
                    // barrier.
                    sm.blockQueueManager.scheduleStoredBlockConfirmationMerge(
                        entry,
                        sm.getActiveValidationStrategy()
                    );

                    await wait(args.windowMs);
                    const withheldWhilePending = broadcasts === 0;
                    const unhandledWhilePending = unhandledCount;

                    storage.__releaseDurability();
                    sm.storage.flush = storage.__origFlush;
                    await wait(500);
                    const broadcastAfterRelease = broadcasts > 0;

                    return {
                        setupFailed: false,
                        withheldWhilePending,
                        unhandledWhilePending,
                        broadcastAfterRelease
                    };
                } finally {
                    process.removeListener("unhandledRejection", onUnhandled);
                    storage.__releaseDurability?.();
                    if (storage.__origFlush) {
                        sm.storage.flush = storage.__origFlush;
                    }
                    delete svc.onBlockConfirmation;
                }
            },
            { windowMs: 800 }
        );

        expect(
            pathC.setupFailed,
            "path-C setup must find a co-signed block"
        ).to.equal(false);
        expect(
            pathC.withheldWhilePending,
            "stored-merge must not re-gossip while the barrier is pending"
        ).to.equal(true);
        expect(
            pathC.unhandledWhilePending,
            "the detached stored-merge macrotask must not raise an unhandled rejection"
        ).to.equal(0);
        // After durability the withheld re-gossip fires.
        expect(pathC.broadcastAfterRelease).to.equal(true);
    });

    it("flush() stays pending while the database batch hangs (withhold primitive)", async function () {
        // The exact primitive both release sites await: with a database whose
        // batch() hangs, flush() stays pending (it neither resolves nor
        // rejects), so any code that awaits it before broadcasting can never
        // release a signature. This is the hang case — distinct from the
        // rejecting-batch poison case PersistenceController.test.ts covers.
        const { handle, releaseBatch } = createGatedHandle();
        const storage = new Storage();
        await storage.bind(handle);

        // A pending write gives the flush an op to commit (and hang on).
        storage.blocks.storeBlock(factory.block());

        const outcome = await Promise.race([
            storage.flush().then(() => "resolved" as const),
            sleep(500).then(() => "pending" as const)
        ]);
        expect(outcome).to.equal("pending");

        // Once the batch completes the parked flush resolves and teardown is
        // clean.
        releaseBatch();
        await storage.flush();
        await storage.close();

        // A Storage never bound to a database, by contrast, resolves promptly.
        const okStorage = new Storage();
        okStorage.blocks.storeBlock(factory.block());
        const okOutcome = await Promise.race([
            okStorage.flush().then(() => "resolved" as const),
            sleep(500).then(() => "pending" as const)
        ]);
        expect(okOutcome).to.equal("resolved");
        await okStorage.close();
    });

    it("a poisoned controller rejects the barrier, fires the failure handler, and close() refuses to swallow the lost writes", async function () {
        // The failing-batch case: the controller retries, then poisons. The
        // release sites rely on three behaviors asserted here at the Storage
        // surface: flush() rejects (the broadcast never fires), the failure
        // handler runs (P2pRuntimeHost wires it to stateManager.abort), and
        // close() rejects rather than silently discarding undurable writes.
        const storage = new Storage();
        let failureHandlerError: Error | undefined;
        storage.setPersistenceFailureHandler((error) => {
            failureHandlerError = error;
        });
        await storage.bind(createFailingHandle());

        storage.blocks.storeBlock(factory.block());

        let flushError: unknown;
        try {
            await storage.flush();
        } catch (err) {
            flushError = err;
        }
        expect(
            flushError,
            "flush() must reject once the controller is poisoned"
        ).to.not.be.undefined;
        expect(
            failureHandlerError,
            "the persistence failure handler must fire on poison"
        ).to.not.be.undefined;

        let closeError: unknown;
        try {
            await storage.close();
        } catch (err) {
            closeError = err;
        }
        expect(
            closeError,
            "close() must reject when the final flush can't durably commit"
        ).to.not.be.undefined;
    });
});
