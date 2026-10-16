import * as factory from "../factory";
import { Block } from "@/models";
import Storage from "@/storage";
import type { Address, ForkId } from "@/types/types";
import { contractRejectedSignature } from "@test/fixtures/AcceptedSignersFixture";
import { expect } from "chai";
import { ethers } from "ethers";
import { describe, it } from "mocha";

const FORK = ethers.id("retained-evidence-fork") as ForkId;

// Proof support a walk checked but did not prove final: several identities
// share a height, readers pick from it by eligible signers.
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
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        const block = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );
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

    it("returns no block for an unknown hash", () => {
        const storage = new Storage();

        expect(storage.retainedEvidence.getBlock(factory.hash())).to.equal(
            undefined
        );
    });

    it("lists no blocks at an empty coordinate", () => {
        const storage = new Storage();

        expect(storage.retainedEvidence.getBlocks(FORK, 4)).to.deep.equal([]);
    });

    it("chooses no block at an empty coordinate", () => {
        const storage = new Storage();

        expect(
            storage.retainedEvidence.rankBlocksAt(FORK, 4, new Set<Address>())
        ).to.deep.equal([]);
    });

    it("keeps the retained block unchanged when the stored input is mutated", async () => {
        const storage = new Storage();
        const block = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );
        storage.retainedEvidence.storeBlock(block);

        await factory.confirmBlock(block, [factory.randomWallet()]);

        expect(
            storage.retainedEvidence.getBlock(block.hash)!
                .confirmationSignatures.size
        ).to.equal(0);
    });

    it("keeps the retained block unchanged when a returned copy is mutated", async () => {
        const storage = new Storage();
        const block = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );
        storage.retainedEvidence.storeBlock(block);

        await factory.confirmBlock(
            storage.retainedEvidence.getBlock(block.hash)!,
            [factory.randomWallet()]
        );

        expect(
            storage.retainedEvidence.getBlock(block.hash)!
                .confirmationSignatures.size
        ).to.equal(0);
    });

    it("chooses the block signed by the most eligible participants at a coordinate", async () => {
        const storage = new Storage();
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        const fewer = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [a]
        );
        const more = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [a, b]
        );
        storage.retainedEvidence.storeBlock(fewer);
        storage.retainedEvidence.storeBlock(more);

        expect(
            storage.retainedEvidence.rankBlocksAt(
                FORK,
                4,
                new Set([a.address, b.address] as Address[])
            )[0]?.hash
        ).to.equal(more.hash);
    });

    it("chooses the linked child signed by the most eligible participants", async () => {
        const storage = new Storage();
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        const parent = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            3
        );
        const fewer = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [a]
        );
        const more = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [a, b]
        );
        storage.retainedEvidence.storeBlock(fewer);
        storage.retainedEvidence.storeBlock(more);

        expect(
            storage.retainedEvidence.rankLinkedChildren(
                parent,
                new Set([a.address, b.address] as Address[])
            )[0]?.hash
        ).to.equal(more.hash);
    });

    it("counts no signatures by signers outside the eligible set", async () => {
        const storage = new Storage();
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        const parent = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            3
        );
        const real = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [a, b]
        );
        // twenty signatures by outsiders outnumber the real votes
        const forged = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            Array.from({ length: 20 }, () => factory.randomWallet())
        );
        storage.retainedEvidence.storeBlock(real);
        storage.retainedEvidence.storeBlock(forged);

        expect(
            storage.retainedEvidence.rankLinkedChildren(
                parent,
                new Set([a.address, b.address] as Address[])
            )[0]?.hash
        ).to.equal(real.hash);
    });

    it("takes the lowest block hash among linked children with as many eligible signers", async () => {
        const storage = new Storage();
        const a = factory.randomWallet();
        const parent = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            3
        );
        const first = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [a]
        );
        const second = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [a]
        );
        storage.retainedEvidence.storeBlock(first);
        storage.retainedEvidence.storeBlock(second);

        expect(
            storage.retainedEvidence.rankLinkedChildren(
                parent,
                new Set([a.address] as Address[])
            )[0]?.hash
        ).to.equal([first.hash, second.hash].sort()[0]);
    });

    it("takes the lowest block hash among blocks at a coordinate with as many eligible signers", async () => {
        const storage = new Storage();
        const a = factory.randomWallet();
        const first = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [a]
        );
        const second = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [a]
        );
        storage.retainedEvidence.storeBlock(first);
        storage.retainedEvidence.storeBlock(second);

        expect(
            storage.retainedEvidence.rankBlocksAt(
                FORK,
                4,
                new Set([a.address] as Address[])
            )[0]?.hash
        ).to.equal([first.hash, second.hash].sort()[0]);
    });

    it("counts a signature the contracts reject as no signer among linked children", async () => {
        const storage = new Storage();
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        const parent = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            3
        );
        const rejected = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [a]
        );
        rejected.expandSignatures([
            await contractRejectedSignature(rejected, b, "high s")
        ]);
        const accepted = await factory.confirmBlock(
            await factory.authoredBlockAt(
                factory.randomWallet(),
                FORK,
                4,
                parent.hash
            ),
            [a, b]
        );
        storage.retainedEvidence.storeBlock(rejected);
        storage.retainedEvidence.storeBlock(accepted);

        expect(
            storage.retainedEvidence.rankLinkedChildren(
                parent,
                new Set([a.address, b.address] as Address[])
            )[0]?.hash
        ).to.equal(accepted.hash);
    });

    it("counts a signature the contracts reject as no signer at a coordinate", async () => {
        const storage = new Storage();
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        const rejected = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [a]
        );
        rejected.expandSignatures([
            await contractRejectedSignature(rejected, b, "high s")
        ]);
        const accepted = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [a, b]
        );
        storage.retainedEvidence.storeBlock(rejected);
        storage.retainedEvidence.storeBlock(accepted);

        expect(
            storage.retainedEvidence.rankBlocksAt(
                FORK,
                4,
                new Set([a.address, b.address] as Address[])
            )[0]?.hash
        ).to.equal(accepted.hash);
    });

    it("counts one eligible key that signs a block twice as one signer", async () => {
        const storage = new Storage();
        const [a, b] = [factory.randomWallet(), factory.randomWallet()];
        // authored and confirmed by a: one signer, two signatures
        const repeated = await factory.confirmBlock(
            await factory.authoredBlockAt(a, FORK, 4),
            [a]
        );
        const distinct = await factory.confirmBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4),
            [a, b]
        );
        storage.retainedEvidence.storeBlock(repeated);
        storage.retainedEvidence.storeBlock(distinct);

        expect(
            storage.retainedEvidence.rankBlocksAt(
                FORK,
                4,
                new Set([a.address, b.address] as Address[])
            )[0]?.hash
        ).to.equal(distinct.hash);
    });

    it("ignores a child at the next height that links to another block", async () => {
        const storage = new Storage();
        const a = factory.randomWallet();
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
            [a]
        );
        storage.retainedEvidence.storeBlock(linked);
        storage.retainedEvidence.storeBlock(unlinked);

        expect(
            storage.retainedEvidence.rankLinkedChildren(
                parent,
                new Set([a.address] as Address[])
            )[0]?.hash
        ).to.equal(linked.hash);
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

        expect(
            storage.retainedEvidence.rankLinkedChildren(
                parent,
                new Set<Address>()
            )
        ).to.deep.equal([]);
    });

    it("finds another block by the same author at the coordinate as a double sign", async () => {
        const storage = new Storage();
        const author = factory.randomWallet();
        const retained = await factory.authoredBlockAt(author, FORK, 4);
        const incoming = await factory.authoredBlockAt(author, FORK, 4);
        storage.retainedEvidence.storeBlock(retained);

        expect(
            storage.retainedEvidence.getOtherBlockByAuthor(
                incoming.forkId,
                incoming.height,
                incoming.author,
                incoming.hash
            )?.hash
        ).to.equal(retained.hash);
    });

    it("finds no double sign in the same identity", async () => {
        const storage = new Storage();
        const incoming = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );
        storage.retainedEvidence.storeBlock(incoming);

        expect(
            storage.retainedEvidence.getOtherBlockByAuthor(
                incoming.forkId,
                incoming.height,
                incoming.author,
                incoming.hash
            )
        ).to.equal(undefined);
    });

    it("finds no double sign in another author's block at the coordinate", async () => {
        const storage = new Storage();
        const incoming = await factory.authoredBlockAt(
            factory.randomWallet(),
            FORK,
            4
        );
        storage.retainedEvidence.storeBlock(
            await factory.authoredBlockAt(factory.randomWallet(), FORK, 4)
        );

        expect(
            storage.retainedEvidence.getOtherBlockByAuthor(
                incoming.forkId,
                incoming.height,
                incoming.author,
                incoming.hash
            )
        ).to.equal(undefined);
    });

    it("finds no double sign in the same author's block at another height", async () => {
        const storage = new Storage();
        const author = factory.randomWallet();
        const incoming = await factory.authoredBlockAt(author, FORK, 4);
        storage.retainedEvidence.storeBlock(
            await factory.authoredBlockAt(author, FORK, 5)
        );

        expect(
            storage.retainedEvidence.getOtherBlockByAuthor(
                incoming.forkId,
                incoming.height,
                incoming.author,
                incoming.hash
            )
        ).to.equal(undefined);
    });
});
