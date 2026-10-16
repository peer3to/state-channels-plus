import * as factory from "../factory";
import { Block } from "@/models";
import Storage from "@/storage";
import type { ForkId } from "@/types/types";
import { expect } from "chai";
import { ethers } from "ethers";
import { describe, it } from "mocha";

const FORK = ethers.id("retained-evidence-fork") as ForkId;

// Proof support a walk checked but did not prove final: several identities
// share a height, it never fills the block history, readers pick from it.
describe("RetainedEvidenceStorage", () => {
    it("retains a block by hash and lists it at its coordinate", async () => {
        const storage = new Storage();
        const block = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );

        storage.retainedEvidence.storeBlock(block);

        expect(storage.retainedEvidence.getBlock(block.hash)?.hash).to.equal(
            block.hash
        );
        expect(
            storage.retainedEvidence
                .getBlocks(FORK, 4)
                .map((retained) => retained.hash)
        ).to.deep.equal([block.hash]);
    });

    it("keeps every identity retained at one coordinate", async () => {
        const storage = new Storage();
        const first = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );
        const second = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );

        storage.retainedEvidence.storeBlock(first);
        storage.retainedEvidence.storeBlock(second);

        expect(
            storage.retainedEvidence
                .getBlocks(FORK, 4)
                .map((retained) => retained.hash)
                .sort()
        ).to.deep.equal([first.hash, second.hash].sort());
    });

    it("merges the confirmations of a repeated identity into the retained block", async () => {
        const storage = new Storage();
        const author = factory.randomWallet();
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        const block = await factory.authoredBlockAt(author, FORK, 4);
        const copy = Block.fromSignedBlock(block.signedBlock);
        await factory.confirmBlock(block, [a]);
        await factory.confirmBlock(copy, [b]);

        storage.retainedEvidence.storeBlock(block);
        storage.retainedEvidence.storeBlock(copy);

        const retained = storage.retainedEvidence.getBlocks(FORK, 4);
        expect(retained).to.have.length(1);
        expect(
            [...retained[0].confirmationSignerAddresses].sort()
        ).to.deep.equal([a.address, b.address].sort());
    });

    it("returns nothing for an unknown hash or an empty coordinate", () => {
        const storage = new Storage();

        expect(storage.retainedEvidence.getBlock(factory.hash())).to.equal(
            undefined
        );
        expect(storage.retainedEvidence.getBlocks(FORK, 4)).to.deep.equal([]);
        expect(storage.retainedEvidence.getMostSignedBlock(FORK, 4)).to.equal(
            undefined
        );
    });

    it("never fills the block history or moves its view", async () => {
        const storage = new Storage();
        const block = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );

        storage.retainedEvidence.storeBlock(block);

        expect(storage.blocks.getBlock(FORK, 4)).to.equal(undefined);
        expect(storage.blocks.getBlock(block.hash)).to.equal(undefined);
        expect(storage.blocks.getLatestBlockHeight(FORK)).to.equal(-1);
    });

    it("picks the block carrying the most signatures at a coordinate", async () => {
        const storage = new Storage();
        const less = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );
        const more = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [factory.randomWallet(), factory.randomWallet()]
        );
        storage.retainedEvidence.storeBlock(less);
        storage.retainedEvidence.storeBlock(more);

        expect(
            storage.retainedEvidence.getMostSignedBlock(FORK, 4)?.hash
        ).to.equal(more.hash);
    });

    it("picks the linked child carrying the most signatures", async () => {
        const storage = new Storage();
        const parent = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            3
        );
        const less = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4,
            parent.hash
        );
        const more = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [factory.randomWallet()]
        );
        storage.retainedEvidence.storeBlock(less);
        storage.retainedEvidence.storeBlock(more);

        expect(storage.retainedEvidence.getLinkedChild(parent)?.hash).to.equal(
            more.hash
        );
    });

    it("ignores a child at the next height that links to another block", async () => {
        const storage = new Storage();
        const parent = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            3
        );
        const linked = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4,
            parent.hash
        );
        const unlinked = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [factory.randomWallet(), factory.randomWallet()]
        );
        storage.retainedEvidence.storeBlock(linked);
        storage.retainedEvidence.storeBlock(unlinked);

        expect(storage.retainedEvidence.getLinkedChild(parent)?.hash).to.equal(
            linked.hash
        );
    });

    it("returns no linked child when nothing links above the block", async () => {
        const storage = new Storage();
        const parent = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            3
        );
        storage.retainedEvidence.storeBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4)
        );
        storage.retainedEvidence.storeBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                5,
                parent.hash
            )
        );

        expect(storage.retainedEvidence.getLinkedChild(parent)).to.equal(
            undefined
        );
    });

    it("finds another block by the same author at the coordinate as a double sign", async () => {
        const storage = new Storage();
        const author = factory.randomWallet();
        const retained = await factory.authoredBlockAt(author, FORK, 4);
        const incoming = await factory.authoredBlockAt(author, FORK, 4);
        storage.retainedEvidence.storeBlock(retained);

        expect(
            storage.retainedEvidence.getOtherBlockByAuthor(incoming)?.hash
        ).to.equal(retained.hash);
    });

    it("finds no double sign in the same identity or in another author's block", async () => {
        const storage = new Storage();
        const author = factory.randomWallet();
        const incoming = await factory.authoredBlockAt(author, FORK, 4);
        storage.retainedEvidence.storeBlock(incoming);
        storage.retainedEvidence.storeBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4)
        );
        storage.retainedEvidence.storeBlock(
            await factory.authoredBlockAt(author, FORK, 5)
        );

        expect(
            storage.retainedEvidence.getOtherBlockByAuthor(incoming)
        ).to.equal(undefined);
    });
});
