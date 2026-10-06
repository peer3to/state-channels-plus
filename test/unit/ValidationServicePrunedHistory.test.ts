import type { Address } from "@/types/types";
import * as factory from "@test/factory";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// crafted confirmations run through validateBlockConfirmation host-side via
// validation.runBlockValidation (record-only side effects) on a peer whose
// stored history below its latest block is pruned, as a compact sync proof
// leaves it. A free height below the next height is inconclusive under the
// live-gated strategies, not misbehaviour.

describe("Unit: ValidationService pruned history", function () {
    it("live strategy, no predecessor, free height below the next height → NOT_READY, dropped through the strategy hook without a disconnect", async function () {
        const h = TestSession.getHarness();
        // 3 blocks (0, 1, 2), then heights 0 and 1 pruned on the observer
        await h.lifecycle.start(3, 3);
        const observer = h.getPeer(0);
        const forkId = h.activeForkId!;
        const latestHeight = 2;
        const { prunedHeights } = await h
            .control(observer)
            .stub.pruneStoredBlocksBelowAnchor(forkId, latestHeight)
            .request();
        const nextHeight = await h
            .control(observer)
            .query.getNextBlockHeight(forkId)
            .request();
        // premise - height 1 is free, the next height is above it
        expect(prunedHeights).to.deep.equal([0, 1]);
        expect(nextHeight).to.equal(3);

        // a participant's block at the pruned height; its link cannot be
        // judged without the history the proof skipped
        const encoded = await factory.buildAndEncodeBlock(observer.signer, {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: 1,
                participant: observer.address as Address
            },
            previousBlockHash: factory.hash()
        });

        const r = await h
            .control(observer)
            .validation.runBlockValidation(encoded)
            .request();

        expect(r.resultName).to.equal("NOT_READY");
        expect(r.firedHooks).to.deep.equal(["blockIsBelowInstalledHistory"]);
        expect(r.disconnectedAddresses).to.deep.equal([]);
        expect(r.disputedForkIds).to.deep.equal([]);
        expect(r.restoreQueuedEntryCalled).to.equal(false);
    });

    it("live strategy, a stored block at the same height → still the conflict path: conflictingButNotLinkedBlockDetected → DISCONNECT", async function () {
        const h = TestSession.getHarness();
        // 3 blocks (0, 1, 2), then heights 0 and 1 pruned on the observer
        await h.lifecycle.start(3, 3);
        const observer = h.getPeer(0);
        const forkId = h.activeForkId!;
        const latestHeight = 2;
        const { prunedHeights } = await h
            .control(observer)
            .stub.pruneStoredBlocksBelowAnchor(forkId, latestHeight)
            .request();
        const nextHeight = await h
            .control(observer)
            .query.getNextBlockHeight(forkId)
            .request();
        // premise - the same height still holds the stored block
        expect(prunedHeights).to.deep.equal([0, 1]);
        expect(latestHeight).to.be.lessThan(nextHeight);

        const stored = await h
            .control(observer)
            .query.getBlockByHeight(forkId, latestHeight)
            .request();
        const other = h.peers.find((p) => p.address !== stored!.author)!;
        const encoded = await factory.buildAndEncodeBlock(other.signer, {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: latestHeight,
                participant: other.address as Address
            },
            previousBlockHash: factory.hash()
        });

        const r = await h
            .control(observer)
            .validation.runBlockValidation(encoded)
            .request();

        expect(r.resultName).to.equal("DISCONNECT");
        expect(r.disputedForkIds).to.deep.equal([]);
        expect(r.firedHooks).to.include("conflictingButNotLinkedBlockDetected");
    });

    it("live strategy, an unlinked block at the next height → still blockIsNotLinkedAndIsNotFirstBlock → DISCONNECT", async function () {
        const h = TestSession.getHarness();
        // 3 blocks (0, 1, 2), then heights 0 and 1 pruned on the observer
        await h.lifecycle.start(3, 3);
        const observer = h.getPeer(0);
        const forkId = h.activeForkId!;
        const latestHeight = 2;
        const { prunedHeights } = await h
            .control(observer)
            .stub.pruneStoredBlocksBelowAnchor(forkId, latestHeight)
            .request();
        const nextHeight = await h
            .control(observer)
            .query.getNextBlockHeight(forkId)
            .request();
        // premise - the pruned history leaves the next height unchanged
        expect(prunedHeights).to.deep.equal([0, 1]);
        expect(nextHeight).to.equal(3);

        const encoded = await factory.buildAndEncodeBlock(observer.signer, {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: nextHeight,
                participant: observer.address as Address
            },
            previousBlockHash: factory.hash()
        });

        const r = await h
            .control(observer)
            .validation.runBlockValidation(encoded)
            .request();

        expect(r.resultName).to.equal("DISCONNECT");
        expect(r.disputedForkIds).to.deep.equal([]);
        expect(r.firedHooks).to.include("blockIsNotLinkedAndIsNotFirstBlock");
    });

    it("dispute replay (no live gates) at a free height below the next height → not dropped by the live free-height rule, validation reaches the linkage guard", async function () {
        const h = TestSession.getHarness();
        // 3 blocks (0, 1, 2), then heights 0 and 1 pruned on the observer
        await h.lifecycle.start(3, 3);
        const observer = h.getPeer(0);
        const forkId = h.activeForkId!;
        const latestHeight = 2;
        const { prunedHeights } = await h
            .control(observer)
            .stub.pruneStoredBlocksBelowAnchor(forkId, latestHeight)
            .request();
        const nextHeight = await h
            .control(observer)
            .query.getNextBlockHeight(forkId)
            .request();
        expect(prunedHeights).to.include(1);
        expect(nextHeight).to.be.greaterThan(1);

        const encoded = await factory.buildAndEncodeBlock(observer.signer, {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: 1,
                participant: observer.address as Address
            },
            previousBlockHash: factory.hash()
        });

        // the dispute strategy enforces no live gates
        const error = await h
            .control(observer)
            .validation.runBlockValidation(encoded, { strategy: "dispute" })
            .request()
            .then(
                () => null,
                (e: unknown) => String(e)
            );

        // the linkage hook throws on this strategy (a replayed block is
        // always linked), so reaching it proves the free-height rule did not
        // drop the entry
        expect(error).to.match(
            /blockIsNotLinkedAndIsNotFirstBlock should not be called/
        );
    });
});
