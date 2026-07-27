import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";

import Storage from "@/storage";
import { HydrationRecordError } from "@/storage/persistence/HydrationRecordError";
import { BlockStorage } from "@/storage/BlockStorage";
import { InMemoryPersistencePort } from "@/storage/persistence/InMemoryPersistencePort";
import { PersistenceEngine } from "@/storage/persistence/PersistenceEngine";
import { blocksSchema } from "@/storage/persistence/schemas/blocksSchema";
import { Block } from "@/models";
import { ForkId, BlockHeight } from "@/types/types";
import * as factory from "../../factory";

const sig = () => ethers.hexlify(ethers.randomBytes(65));
const noop = () => undefined;

/** Records every committed op's keys per flush. */
class RecordingPort extends InMemoryPersistencePort {
    readonly commits: string[][] = [];

    async commit(
        ops: Parameters<InMemoryPersistencePort["commit"]>[0]
    ): Promise<void> {
        this.commits.push(ops.map((op) => op.key));
        await super.commit(ops);
    }
}

/** Rejects the NEXT commit only, then behaves normally. */
class OnceFailingPort extends InMemoryPersistencePort {
    private shouldFail = true;

    async commit(
        ops: Parameters<InMemoryPersistencePort["commit"]>[0]
    ): Promise<void> {
        if (this.shouldFail) {
            this.shouldFail = false;
            throw new Error("injected one-time commit failure");
        }
        await super.commit(ops);
    }
}

/** Records every committed op batch; can gate the NEXT commit mid-flight. */
class GatedPort extends InMemoryPersistencePort {
    readonly commits: Parameters<InMemoryPersistencePort["commit"]>[0][] = [];
    private gate?: Promise<void>;
    private release?: () => void;

    gateNextCommit(): void {
        this.gate = new Promise((res) => {
            this.release = res;
        });
    }

    releaseCommit(): void {
        this.release?.();
    }

    async commit(
        ops: Parameters<InMemoryPersistencePort["commit"]>[0]
    ): Promise<void> {
        this.commits.push(ops);
        if (this.gate) {
            const gate = this.gate;
            this.gate = undefined;
            await gate;
        }
        await super.commit(ops);
    }
}

async function waitUntil(cond: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitUntil timed out");
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
}

/**
 * A raw BlockStorage wired to a durability engine sharing `port` under the
 * blocks schema. Mirrors how Storage wires the two together, but keeps the raw
 * store (not the deepCopyProxy) in reach so tests can assert on it directly.
 */
function makeStore(port: InMemoryPersistencePort) {
    const raw = new BlockStorage();
    const errors: unknown[] = [];
    const engine = new PersistenceEngine({
        port,
        onFatal: noop,
        onError: (err) => errors.push(err)
    });
    engine.register(blocksSchema(raw));
    return { raw, engine, errors };
}

describe("blocksSchema + PersistenceEngine", () => {
    let forkId: ForkId;

    beforeEach(() => {
        forkId = factory.hash();
    });

    function blockAt(height: BlockHeight): Block {
        const block = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    forkId,
                    transactionCnt: height
                })
            })
        });
        return Block.fromBlockConfirmation(block.blockConfirmationStruct);
    }

    it("round-trips stored blocks through flush into a fresh store and rebuilds forkIdToMaxHeightMap", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);
        for (const height of [0, 5, 10]) {
            writer.raw.storeBlock(blockAt(height));
        }
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        expect(reader.raw.getNextBlockHeight(forkId)).to.equal(0);

        await reader.engine.hydrateAll();

        expect(reader.raw.getLatestBlock(forkId)?.height).to.equal(10);
        expect(reader.raw.getNextBlockHeight(forkId)).to.equal(11);
        expect(Array.from(reader.raw.getIterator(forkId))).to.have.lengthOf(3);
    });

    it("replays under a caller-supplied hash override that diverges from the content-derived hash", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);

        const block = blockAt(0);
        const overrideHash = factory.hash();
        writer.raw.storeBlock(block, { hash: overrideHash });
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();

        expect(reader.raw.getBlock(overrideHash)).to.not.be.undefined;
    });

    it("persists post-mutation signature/on-chain-timestamp state, restorable via hydrate", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);
        const block = blockAt(1);
        const hash = writer.raw.storeBlock(block)!;

        const newSig = sig();
        writer.raw.insertSignature(newSig, hash);
        writer.raw.setOnChainTimestamp(hash, 999);
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();

        const hydrated = reader.raw.getBlock(hash);
        expect(hydrated?.confirmationSignatures.has(newSig)).to.be.true;
        expect(hydrated?.onChainTimestamp).to.equal(999);
    });

    it("PO1: a flush only re-diffs dirty keys, not the whole retained history", async () => {
        const port = new RecordingPort();
        const writer = makeStore(port);

        const hashes = [0, 1, 2, 3, 4].map(
            (height) => writer.raw.storeBlock(blockAt(height))!
        );
        await writer.engine.awaitDurable();
        expect(port.commits[0].sort()).to.deep.equal([...hashes].sort());

        // Mutate only ONE already-durable block.
        writer.raw.insertSignature(sig(), hashes[2]);
        await writer.engine.awaitDurable();

        expect(port.commits).to.have.lengthOf(2);
        expect(port.commits[1]).to.deep.equal([hashes[2]]);
    });

    it("PO1: a failed commit keeps the dirty key pending for the next flush (retry-safe)", async () => {
        const port = new OnceFailingPort();
        const writer = makeStore(port);

        const hash = writer.raw.storeBlock(blockAt(0))!;

        // First awaitDurable's flush hits the injected failure - barrier stays
        // pending, dirty key must NOT be lost.
        void writer.engine.awaitDurable();
        await new Promise((resolve) => setTimeout(resolve, 60));

        // A later mutation to the SAME key while still degraded.
        writer.raw.insertSignature(sig(), hash);
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();
        expect(reader.raw.getBlock(hash)).to.not.be.undefined;
    });

    it("deleteBlock removes the durable record so a fresh hydrate no longer returns it", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);
        const hash = writer.raw.storeBlock(blockAt(2))!;
        await writer.engine.awaitDurable();

        expect(writer.raw.deleteBlock(hash)).to.be.true;
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();
        expect(reader.raw.getBlock(hash)).to.be.undefined;
    });

    it("hydrateAll() throws when a record fails to decode/replay, after invoking onError for visibility (FR2)", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);
        const hashes = [0, 1, 2].map(
            (height) => writer.raw.storeBlock(blockAt(height))!
        );
        await writer.engine.awaitDurable();

        // Simulate corruption: a record's persisted bytes are garbage. A
        // commit is one durable transaction, so this is corruption of
        // already-committed state, not evidence of an incomplete write -
        // fail-closed regardless of which record it is (even the tip; see
        // Storage.hydrate() TIP/MIDDLE tests below for the host-level check).
        const tipHash = hashes[hashes.length - 1];
        await port.commit([
            {
                namespace: "blocks",
                type: "put",
                key: tipHash as string,
                encoded: "0x1234"
            }
        ]);

        const reader = makeStore(port);
        let hydrateError: unknown;
        try {
            await reader.engine.hydrateAll();
        } catch (err) {
            hydrateError = err;
        }

        expect(hydrateError, "hydrateAll() must fail closed").to.not.be
            .undefined;
        expect(reader.errors).to.have.lengthOf(1);
    });

    it("hydrate merges signatures via storeBlock, union preserved", async () => {
        const port = new InMemoryPersistencePort();
        const signedBlock = factory.signedBlock();
        const baseConfirmation = factory.blockConfirmation({ signedBlock });
        const hash = Block.fromBlockConfirmation(baseConfirmation).hash;

        const [sigA, sigB, sigC] = [sig(), sig(), sig()];

        // Durable record carries signature set {A, B}.
        const writer = makeStore(port);
        writer.raw.storeBlock(
            Block.fromBlockConfirmation({
                ...baseConfirmation,
                signatures: [sigA, sigB]
            })
        );
        await writer.engine.awaitDurable();

        // Fresh store already holds the same block with a DIFFERENT live
        // signature {C} before hydrate replays {A, B}.
        const reader = makeStore(port);
        reader.raw.storeBlock(
            Block.fromBlockConfirmation({
                ...baseConfirmation,
                signatures: [sigC]
            })
        );

        await reader.engine.hydrateAll();

        const merged = reader.raw.getBlock(hash);
        expect(merged?.confirmationSignatures.has(sigA)).to.be.true;
        expect(merged?.confirmationSignatures.has(sigB)).to.be.true;
        expect(merged?.confirmationSignatures.has(sigC)).to.be.true;
    });

    it("justPersist blocks are excluded from persistableEntries and never replayed", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);
        writer.raw.storeBlock(blockAt(0));

        const milestone = blockAt(10);
        writer.raw.storeBlock(milestone, { justPersist: true });

        // Excluded from the engine's diff view...
        const persistableHashes = Array.from(
            writer.raw.persistableEntries()
        ).map(([hash]) => hash);
        expect(persistableHashes).to.not.include(milestone.hash);

        // ...but the live in-memory view is unchanged by the exclusion: a
        // justPersist milestone ahead of the tip does not advance maxHeight.
        expect(writer.raw.getNextBlockHeight(forkId)).to.equal(1);

        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();

        expect(reader.raw.getNextBlockHeight(forkId)).to.equal(1);
        expect(reader.raw.getBlock(milestone.hash)).to.be.undefined;
    });

    it("re-storing an already-durable block as justPersist does not delete it from the durable store", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);

        const durable = blockAt(0);
        writer.raw.storeBlock(durable);
        await writer.engine.awaitDurable();

        // Dispute replay re-stores the same hash as a justPersist milestone -
        // a merge must never demote an already-durable record.
        writer.raw.storeBlock(durable, { justPersist: true });

        const persistableHashes = Array.from(
            writer.raw.persistableEntries()
        ).map(([hash]) => hash);
        expect(persistableHashes).to.include(durable.hash);

        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();
        expect(reader.raw.getBlock(durable.hash)).to.not.be.undefined;
    });

    it("hydrate merges over live memory and next flush persists the pre-hydrate mutation", async () => {
        const port = new InMemoryPersistencePort();

        // Durable: block at height 0.
        const writer = makeStore(port);
        const durable = blockAt(0);
        writer.raw.storeBlock(durable);
        await writer.engine.awaitDurable();

        // Fresh store with an un-flushed live mutation (block at height 1)
        // BEFORE hydrate replays the durable block.
        const reader = makeStore(port);
        const liveBlock = blockAt(1);
        reader.raw.storeBlock(liveBlock);

        await reader.engine.hydrateAll();

        // Merge-not-clear: nothing lost in memory.
        expect(reader.raw.getBlock(durable.hash)).to.not.be.undefined;
        expect(reader.raw.getBlock(liveBlock.hash)).to.not.be.undefined;

        // The next flush persists the pre-hydrate live mutation.
        await reader.engine.awaitDurable();

        const restored = makeStore(port);
        await restored.engine.hydrateAll();
        expect(restored.raw.getBlock(durable.hash)).to.not.be.undefined;
        expect(restored.raw.getBlock(liveBlock.hash)).to.not.be.undefined;
    });

    it("Storage.hydrate() rehydrates through the deepCopyProxy without corrupting the promise", async () => {
        const port = new InMemoryPersistencePort();
        const writer = new Storage({ port });
        writer.blocks.storeBlock(blockAt(0));
        writer.blocks.storeBlock(blockAt(1));
        await writer.awaitDurable();

        const reader = new Storage({ port });
        expect(reader.blocks.getNextBlockHeight(forkId)).to.equal(0);

        await reader.hydrate();

        expect(reader.blocks.getLatestBlock(forkId)?.height).to.equal(1);
        expect(reader.blocks.getNextBlockHeight(forkId)).to.equal(2);
    });

    it("Storage.hydrate() fails closed when a MIDDLE block is corrupt, leaving heights above a real gap", async () => {
        const port = new InMemoryPersistencePort();
        const writer = new Storage({ port });
        const hashes = [0, 1, 2].map(
            (height) => writer.blocks.storeBlock(blockAt(height))!
        );
        await writer.awaitDurable();

        // Corrupt the MIDDLE height's persisted bytes (not the tip) - height 2
        // still decodes fine, so a naive max-height-seen tracker would trust
        // it despite height 1 being missing.
        const middleHash = hashes[1];
        await port.commit([
            {
                namespace: "blocks",
                type: "put",
                key: middleHash as string,
                encoded: "0x1234"
            }
        ]);

        const reader = new Storage({ port });
        let hydrateError: unknown;
        try {
            await reader.hydrate();
        } catch (err) {
            hydrateError = err;
        }
        // FR2: PersistenceEngine.hydrateAll() now fails closed on ANY
        // decode/replay failure before Storage.hydrate() ever reaches
        // checkHeightContiguity() - so this throws HydrationRecordError, not
        // the height-gap-specific HydrationIntegrityError.
        expect(hydrateError).to.be.instanceOf(HydrationRecordError);
    });

    it("Storage.hydrate() fails closed for a corrupt TIP too (FR2 - a commit is one durable transaction, not an incomplete write)", async () => {
        const port = new InMemoryPersistencePort();
        const writer = new Storage({ port });
        const hashes = [0, 1, 2].map(
            (height) => writer.blocks.storeBlock(blockAt(height))!
        );
        await writer.awaitDurable();

        const tipHash = hashes[hashes.length - 1];
        await port.commit([
            {
                namespace: "blocks",
                type: "put",
                key: tipHash as string,
                encoded: "0x1234"
            }
        ]);

        const reader = new Storage({ port });
        let hydrateError: unknown;
        try {
            await reader.hydrate();
        } catch (err) {
            hydrateError = err;
        }
        expect(hydrateError, "hydrate() must fail closed on the corrupt tip").to
            .not.be.undefined;
    });

    it("Storage's flushIntervalMs durably flushes non-barrier state with no explicit awaitDurable() (TR3 - inspected before dispose's own final flush)", async () => {
        const port = new InMemoryPersistencePort();
        const writer = new Storage({ port, flushIntervalMs: 10 });

        try {
            // Force-join is never touched by a signature-release barrier;
            // only the background flush interval can make this durable.
            writer.forceJoin.setValue(7);

            await new Promise((resolve) => setTimeout(resolve, 50));

            // Inspect a fresh reader BEFORE disposing the writer - dispose()
            // performs its own final flush (FR3), which would mask whether
            // the interval itself ever fired.
            const reader = new Storage({ port });
            await reader.hydrate();
            expect(reader.forceJoin.getValue()).to.equal(7);
        } finally {
            await writer.dispose();
        }
    });

    it("a fresh Storage stores and reads blocks with no flush (default in-memory port)", () => {
        const storage = new Storage();
        const block = blockAt(0);
        const hash = storage.blocks.storeBlock(block)!;
        expect(storage.blocks.getBlock(hash)?.equals(block)).to.be.true;
    });

    it("FR1: justPersist -> normal promotion advances the live tip exactly like a fresh hydrate would", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);

        // A milestone ahead of the live tip (e.g. a dispute-proof block)
        // must not move the tip while it's justPersist.
        const milestone = blockAt(5);
        writer.raw.storeBlock(milestone, { justPersist: true });
        expect(writer.raw.getNextBlockHeight(forkId)).to.equal(0);

        // Promotion (the live chain catching up to height 5) must advance
        // the tip exactly like a brand-new normal block would.
        writer.raw.storeBlock(milestone);
        expect(
            writer.raw.getNextBlockHeight(forkId),
            "promotion must advance max height, not just clear justPersist"
        ).to.equal(6);

        await writer.engine.awaitDurable();

        // A fresh hydrate replays the now-durable record through the
        // "new entry" branch, which always advances max height - live and
        // restarted state must agree.
        const reader = makeStore(port);
        await reader.engine.hydrateAll();
        expect(reader.raw.getNextBlockHeight(forkId)).to.equal(6);
    });

    it("RR1: a same-hash mutation racing an in-flight commit survives to the next flush instead of being dropped", async () => {
        const port = new GatedPort();
        const writer = makeStore(port);

        const hash = writer.raw.storeBlock(blockAt(0))!;
        await writer.engine.awaitDurable();

        const commitsBeforeA = port.commits.length;
        writer.raw.setOnChainTimestamp(hash, 111);
        port.gateNextCommit();
        const barrierA = writer.engine.awaitDurable();

        // Wait for A's commit to start (its ops are already diffed from
        // timestamp=111) before mutating the SAME key again.
        await waitUntil(() => port.commits.length === commitsBeforeA + 1);
        writer.raw.setOnChainTimestamp(hash, 222);

        port.releaseCommit();
        await barrierA;

        // A's diffed value (111) is what actually committed...
        const afterA = makeStore(port);
        await afterA.engine.hydrateAll();
        expect(afterA.raw.getBlock(hash)?.onChainTimestamp).to.equal(111);

        // ...but the second mutation (222) must still be dirty - a plain Set
        // would have had its re-add wiped by A's post-commit clear.
        await writer.engine.awaitDurable();
        const afterB = makeStore(port);
        await afterB.engine.hydrateAll();
        expect(afterB.raw.getBlock(hash)?.onChainTimestamp).to.equal(222);
    });

    it("FO4: a signature/timestamp mutation on a hash-override block (by hash) is durable, not silently dropped", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);

        const block = blockAt(0);
        const overrideHash = factory.hash();
        writer.raw.storeBlock(block, { hash: overrideHash });
        await writer.engine.awaitDurable();

        writer.raw.setOnChainTimestamp(overrideHash, 555);
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();
        expect(reader.raw.getBlock(overrideHash)?.onChainTimestamp).to.equal(
            555
        );
    });

    it("FO4: a signature insertion by COORDINATES on a hash-override block dirties the persisted key, not block's own hash", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);

        const block = blockAt(3);
        const overrideHash = factory.hash();
        writer.raw.storeBlock(block, { hash: overrideHash });
        await writer.engine.awaitDurable();

        const newSig = sig();
        writer.raw.insertSignature(newSig, forkId, 3);
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();
        expect(
            reader.raw
                .getBlock(overrideHash)
                ?.confirmationSignatures.has(newSig)
        ).to.be.true;
    });

    it("FO4: deleteBlock by COORDINATES on a hash-override block removes the correct persisted key", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);

        const block = blockAt(4);
        const overrideHash = factory.hash();
        writer.raw.storeBlock(block, { hash: overrideHash });
        await writer.engine.awaitDurable();

        expect(writer.raw.deleteBlock(forkId, 4)).to.be.true;
        await writer.engine.awaitDurable();

        const reader = makeStore(port);
        await reader.engine.hydrateAll();
        expect(reader.raw.getBlock(overrideHash)).to.be.undefined;
    });
});
