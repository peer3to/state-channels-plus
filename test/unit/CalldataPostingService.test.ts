import { hash as randomHash } from "../factory";
import { authorIndexAt } from "@test/fixtures/ProofOwnerStaging";
import {
    peerBlockHeights,
    stagePrunedChannelPastAnchor,
    stagePrunedFinalPointMissingSignature
} from "@test/fixtures/PruningStaging";
import { storedProofView } from "@test/fixtures/StoredProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// maybePostBlockOnChain is called directly on the author, so the decision
// (post or stand down) is observed without waiting out agreementTime.

describe("Unit: CalldataPostingService", function () {
    describe("maybePostBlockOnChain", function () {
        it("every participant signed the block → nothing posted on-chain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();

            const block = await h
                .control(h.getPeer(0))
                .query.getBlockByHeight(forkId, 1)
                .request();
            const author = h.peers.find((p) => p.address === block!.author)!;
            const signed = await h
                .control(author)
                .query.didEveryoneSignBlockAt(forkId, 1)
                .request();
            expect(signed, "block 1 is fully signed").to.equal(true);

            await h.execOnHost(
                author,
                async (sm, args) => {
                    sm.calldataPostingService.maybePostBlockOnChain(
                        args.blockHash
                    );
                    return true;
                },
                { blockHash: block!.hash }
            );

            h.assert.calldata.noCalldataPosted();
            expect(
                await h
                    .control(author)
                    .query.getBlockCalldataTimestamp(forkId, 1, author.address)
                    .request()
            ).to.equal(null);
        });

        it("hash of a block this peer does not store → no-op", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();

            await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    sm.calldataPostingService.maybePostBlockOnChain(
                        args.blockHash
                    );
                    return true;
                },
                { blockHash: randomHash() }
            );

            h.assert.calldata.noCalldataPosted();
        });

        it("an expired calldata receipt is handled before detached collection", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const { leader, authored } =
                await h.transition.authorNextBlockOffWireWait();
            await h.control(leader).stub.stubExpireCalldataPost().request();
            await h
                .control(leader)
                .stub.restoreSuppressMaybePostBlockOnChain()
                .request();
            try {
                await h.execOnHost(
                    leader,
                    async (sm, args) => {
                        sm.calldataPostingService.maybePostBlockOnChain(
                            args.blockHash
                        );
                        return true;
                    },
                    { blockHash: authored.hash }
                );
                expect(
                    (await h.quiesceHosts()).map((error) => error.message)
                ).to.deep.equal([]);
                expect(
                    await h
                        .control(leader)
                        .query.getBlockCalldataTimestamp(
                            h.activeForkId!,
                            authored.height,
                            leader.address
                        )
                        .request()
                ).to.equal(null);
            } finally {
                await h.control(leader).stub.restoreCalldataPost().request();
            }
        });

        it("a block nobody else signed → author posts its calldata on-chain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;

            // the block stays on the author's storage only, so it carries just
            // the author's signature
            const { leader, authored } =
                await h.transition.authorNextBlockOffWireWait();
            const blockHash = authored.hash;
            const blockHeight = authored.height;
            await h
                .control(leader)
                .stub.restoreSuppressMaybePostBlockOnChain()
                .request();
            h.event.resetEventSpies();

            const signed = await h
                .control(leader)
                .query.didEveryoneSignBlockAt(forkId, blockHeight)
                .request();
            expect(signed, "only the author signed").to.equal(false);

            await h.execOnHost(
                leader,
                async (sm, args) => {
                    sm.calldataPostingService.maybePostBlockOnChain(
                        args.blockHash
                    );
                    return true;
                },
                { blockHash }
            );

            await h.assert.calldata.calldataPosted();
        });

        it("pruning on, a fully signed final-point block whose block below is pruned → resolves and nothing is posted on-chain", async function () {
            const h = TestSession.getHarness();
            const { forkId } = await stagePrunedChannelPastAnchor(h, {
                peerCount: 3,
                blocksBefore: 2,
                blocksAfter: 3
            });
            const finalHeight = (await storedProofView(h, 0, forkId))!.finalized
                .height;
            const authorIndex = await authorIndexAt(h, 0, finalHeight);
            const author = h.getPeer(authorIndex);
            // premise - the author's own final point, fully signed, with the
            // block below it pruned
            expect(
                (await storedProofView(h, authorIndex, forkId))!.finalized
                    .height
            ).to.equal(finalHeight);
            expect(
                await h
                    .control(author)
                    .query.didEveryoneSignBlockAt(forkId, finalHeight)
                    .request()
            ).to.equal(true);
            const heldHeights = await peerBlockHeights(h, authorIndex, forkId);
            expect(heldHeights).to.include(finalHeight);
            expect(heldHeights).to.not.include(finalHeight - 1);
            const block = (await h
                .control(author)
                .query.getBlockByHeight(forkId, finalHeight)
                .request())!;
            h.event.resetEventSpies();

            await h.execOnHost(
                author,
                async (sm, args) => {
                    sm.calldataPostingService.maybePostBlockOnChain(
                        args.blockHash
                    );
                    return true;
                },
                { blockHash: block.hash }
            );

            expect(
                (await h.quiesceHosts()).map((error) => error.message)
            ).to.deep.equal([]);
            h.assert.calldata.noCalldataPosted();
            expect(
                await h
                    .control(author)
                    .query.getBlockCalldataTimestamp(
                        forkId,
                        finalHeight,
                        author.address
                    )
                    .request()
            ).to.equal(null);
        });

        it("pruning on, a final-point block one signature short whose block below is pruned → resolves and nothing is posted on-chain", async function () {
            const h = TestSession.getHarness();
            const { forkId, writer, finalHeight } =
                await stagePrunedFinalPointMissingSignature(h);
            const author = h.getPeer(writer.index);
            // premise - the writer's own final point, one signature short
            // there, with the block below it pruned
            expect(
                (await storedProofView(h, writer.index, forkId))!.finalized
                    .height
            ).to.equal(finalHeight);
            expect(
                await h
                    .control(author)
                    .query.didEveryoneSignBlockAt(forkId, finalHeight)
                    .request()
            ).to.equal(false);
            const heldHeights = await peerBlockHeights(h, writer.index, forkId);
            expect(heldHeights).to.include(finalHeight);
            expect(heldHeights).to.not.include(finalHeight - 1);
            const block = (await h
                .control(author)
                .query.getBlockByHeight(forkId, finalHeight)
                .request())!;
            await h
                .control(author)
                .stub.restoreSuppressMaybePostBlockOnChain()
                .request();
            h.event.resetEventSpies();

            await h.execOnHost(
                author,
                async (sm, args) => {
                    sm.calldataPostingService.maybePostBlockOnChain(
                        args.blockHash
                    );
                    return true;
                },
                { blockHash: block.hash }
            );

            expect(
                (await h.quiesceHosts()).map((error) => error.message)
            ).to.deep.equal([]);
            h.assert.calldata.noCalldataPosted();
            expect(
                await h
                    .control(author)
                    .query.getBlockCalldataTimestamp(
                        forkId,
                        finalHeight,
                        author.address
                    )
                    .request()
            ).to.equal(null);
        });
    });
});
