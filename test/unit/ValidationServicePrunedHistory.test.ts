import type { Address } from "@/types/types";
import * as factory from "@test/factory";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// crafted confirmations run through validateBlockConfirmation host-side via
// validation.runBlockValidation (record-only side effects) on a peer whose
// stored history below its latest block is pruned, as a compact sync proof
// leaves it. A free height below the next height never reaches validation
// (BlockQueueManager settles it as past); a stored or next height still
// takes the normal paths.

describe("Unit: ValidationService pruned history", function () {
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
});
