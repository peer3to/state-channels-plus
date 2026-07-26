import { expect } from "chai";
import { MathTestSession as TestSession, sleep } from "@test/harness";
import * as factory from "@test/factory";
import Storage from "@/storage";
import {
    NamespacedOp,
    OPAQUE_CLONE,
    PersistencePort,
    PersistRecord
} from "@/storage/persistence/PersistencePort";

/**
 * The durability barrier (`await storage.awaitDurable()`) sits
 * immediately before every signature-release broadcast, so no signature is
 * gossiped before the just-signed state is durable. This is the slashing
 * guarantee of the persistence layer.
 *
 * Two release sites, both exercised here against a real StateManager on a real
 * peer (poked host-side through the control RPC):
 *  - SITE 1 (paths A/B) - StateManager.success(), inside the StateManager mutex.
 *  - SITE 2 (path C) - BlockValidationStrategy.goodNewSignaturesOnExistingBlock,
 *    a detached macrotask outside any mutex.
 *
 * Port injection into a running peer's Storage lands with the runtime host wiring, so the
 * stuck-barrier condition is reproduced on the live Storage by parking
 * awaitDurable() on a releasable gate - the same observable state the engine
 * enters while commit() keeps failing (awaitDurable() stays pending, never
 * rejects). The final test asserts that stuck state directly on a real Storage
 * built on a fault-injecting PersistencePort.
 *
 * The three release-site behaviors run in ONE harness session/`it`: the
 * repo's harness cannot stand up a second full peer session in the same
 * process (an unrelated teardown limitation, reproducible with
 * E2E-StateTransition), so the scenarios are sequenced within a single session
 * rather than split across `it`s that would each re-`start()`.
 */

/** Parks a peer's live durability barrier on a releasable gate, host-side. */
function installPendingBarrier(sm: {
    storage: { awaitDurable: () => Promise<void> };
}): void {
    const storage = sm.storage as unknown as {
        awaitDurable: () => Promise<void>;
        __origAwaitDurable?: () => Promise<void>;
        __durabilityGate?: Promise<void>;
        __releaseDurability?: () => void;
    };
    storage.__origAwaitDurable = sm.storage.awaitDurable.bind(sm.storage);
    storage.__durabilityGate = new Promise<void>((res) => {
        storage.__releaseDurability = res;
    });
    sm.storage.awaitDurable = () => storage.__durabilityGate!;
}

/** Releases a parked barrier and restores the real awaitDurable. */
function releasePendingBarrier(sm: {
    storage: { awaitDurable: () => Promise<void> };
}): void {
    const storage = sm.storage as unknown as {
        awaitDurable: () => Promise<void>;
        __origAwaitDurable?: () => Promise<void>;
        __releaseDurability?: () => void;
    };
    storage.__releaseDurability?.();
    if (storage.__origAwaitDurable) {
        sm.storage.awaitDurable = storage.__origAwaitDurable;
    }
}

/** A port whose commit never succeeds, so awaitDurable() stays pending. */
class FaultyPersistencePort implements PersistencePort {
    readonly [OPAQUE_CLONE] = true as const;

    commit(_ops: NamespacedOp[]): Promise<void> {
        return Promise.reject(new Error("injected commit failure"));
    }
    // eslint-disable-next-line require-yield
    async *load(_namespace: string): AsyncIterable<PersistRecord> {
        return;
    }
    async prune(): Promise<void> {
        return;
    }
}

describe("E2E: durability barrier (sign-before-durable)", function () {
    it("withholds every release-site broadcast until state is durable; default in-memory port broadcasts normally", async function () {
        this.timeout(120000);

        const h = TestSession.getHarness();
        await h.lifecycle.start(2);
        const forkId = h.activeForkId!;

        // ---- default in-memory port preserves broadcast behavior ----
        // With the default port awaitDurable() resolves on the next flush, so
        // both release sites fire normally and the peers converge.
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

        // Park the author's barrier so success() stalls right after its writes,
        // immediately before the release broadcast.
        await h.execOnHost(author, installPendingBarrier);

        // Fire the author's block; success() stores it, then blocks at the
        // barrier before broadcasting. It will not resolve until released.
        const submitP = h.transition
            .increment(1, { waitForSync: false })
            .catch((e) => e);

        try {
            // Give success() time to store the block and reach the barrier.
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

                // Strip the confirmation signatures off the RAW stored block so
                // the incoming full confirmation carries them as "new".
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawBlocks = sm.storage.blocks as any;
                const rawBlock = rawBlocks.hashToBlockMap.get(full.hash);
                rawBlock.removeConfirmationSignatures(
                    new Set(rawBlock.confirmationSignatures)
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
                storage.__origAwaitDurable = sm.storage.awaitDurable.bind(
                    sm.storage
                );
                storage.__durabilityGate = new Promise<void>((res) => {
                    storage.__releaseDurability = res;
                });
                sm.storage.awaitDurable = () => storage.__durabilityGate;

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
                    sm.storage.awaitDurable = storage.__origAwaitDurable;
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
                    if (storage.__origAwaitDurable) {
                        sm.storage.awaitDurable = storage.__origAwaitDurable;
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

    it("awaitDurable stays pending on a failing port (barrier primitive)", async function () {
        // The exact primitive both release sites await: with a fault-injecting
        // port whose commit() rejects, the barrier never resolves, so any code
        // that awaits it before broadcasting can never release a signature.
        const storage = new Storage({ port: new FaultyPersistencePort() });

        // A pending write gives the flush an op to commit (and fail on).
        storage.blocks.storeBlock(factory.block());

        const outcome = await Promise.race([
            storage.awaitDurable().then(() => "resolved" as const),
            sleep(500).then(() => "pending" as const)
        ]);
        expect(outcome).to.equal("pending");
        await storage.dispose();

        // The default in-memory port, by contrast, resolves promptly.
        const okStorage = new Storage();
        okStorage.blocks.storeBlock(factory.block());
        const okOutcome = await Promise.race([
            okStorage.awaitDurable().then(() => "resolved" as const),
            sleep(500).then(() => "pending" as const)
        ]);
        expect(okOutcome).to.equal("resolved");
        await okStorage.dispose();
    });
});
