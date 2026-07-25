import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";

import Storage from "@/storage";
import { BlockStorage } from "@/storage/BlockStorage";
import { InMemoryPersistencePort } from "@/storage/persistence/InMemoryPersistencePort";
import { PersistenceEngine } from "@/storage/persistence/PersistenceEngine";
import { blocksSchema } from "@/storage/persistence/schemas/blocksSchema";
import { Block } from "@/models";
import { ForkId, BlockHeight } from "@/types/types";
import * as factory from "../../factory";

const sig = () => ethers.hexlify(ethers.randomBytes(65));
const noop = () => undefined;

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

    it("hydrate skips a corrupt mid-write entry via onError and reports the highest contiguous height", async () => {
        const port = new InMemoryPersistencePort();
        const writer = makeStore(port);
        const hashes = [0, 1, 2].map(
            (height) => writer.raw.storeBlock(blockAt(height))!
        );
        await writer.engine.awaitDurable();

        // Simulate a crash mid-write: the tip block's persisted bytes are
        // truncated/corrupt (keyed by the block hash the engine wrote under).
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
        await reader.engine.hydrateAll();

        expect(reader.raw.getLatestBlock(forkId)?.height).to.equal(1);
        expect(reader.raw.getNextBlockHeight(forkId)).to.equal(2);
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
        writer.blocks.storeBlock(blockAt(5));
        await writer.awaitDurable();

        const reader = new Storage({ port });
        expect(reader.blocks.getNextBlockHeight(forkId)).to.equal(0);

        await reader.hydrate();

        expect(reader.blocks.getLatestBlock(forkId)?.height).to.equal(5);
        expect(reader.blocks.getNextBlockHeight(forkId)).to.equal(6);
    });

    it("a fresh Storage stores and reads blocks with no flush (default in-memory port)", () => {
        const storage = new Storage();
        const block = blockAt(0);
        const hash = storage.blocks.storeBlock(block)!;
        expect(storage.blocks.getBlock(hash)?.equals(block)).to.be.true;
    });
});
