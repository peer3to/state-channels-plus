import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { hash as randomHash } from "../factory";

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
    });
});
