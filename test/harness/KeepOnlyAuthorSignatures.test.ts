// @spec-test-coverage-ignore: harness helper contract test; the helper is test infrastructure with no specification or implementation IDs
import { BlockOrigin } from "@/storage/QueueStorage";
import { sleep } from "@/utils";
import { keepOnlyAuthorSignatures } from "@test/fixtures/MilestoneSyncStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

const MERGE_TASK = "BlockQueueManager.handleStoredBlockConfirmationMerge";

describe("keepOnlyAuthorSignatures", function () {
    it("waits for a held admitted merge of a stripped block before it strips and returns, so the block keeps only its author's signature", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const peer = h.getPeer(0);
        const stub = h.control(peer).stub;
        await stub.recordConfirmationOperations().request();
        await h.transition.advanceState({
            count: 1,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait();
        const forkId = h.activeForkId!;
        const stored = (await h
            .control(peer)
            .query.getLatestBlockBundle(forkId)
            .request())!;
        expect(stored.confirmationSignerAddresses).to.have.length(2);

        // admit a merge of the stored block's full confirmation and hold it
        await stub.stubHoldScheduledTasks(MERGE_TASK).request();
        await h
            .control(peer)
            .transition.ingestBlockConfirmation(
                stored.encodedBlockConfirmation,
                {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: h.getPeer(1).address
                }
            )
            .request();
        await waitFor(
            async () =>
                (await stub.getHeldScheduledTaskCount(MERGE_TASK).request()) ===
                1
        );

        let returned = false;
        const stripping = keepOnlyAuthorSignatures(h, 0, forkId, [
            stored.height
        ]).then(() => {
            returned = true;
        });
        // The hold is the test input: it outlasts a short quiet interval.
        await sleep(500);
        expect(returned, "the strip waits for the held merge").to.equal(false);
        await stub.restoreHeldScheduledTasks(MERGE_TASK, true).request();
        await stripping;

        const stripped = (await h
            .control(peer)
            .query.getBlockByHash(stored.hash)
            .request())!;
        // only the author's block signature is left, no confirmation
        expect(stripped.confirmationSignerAddresses).to.deep.equal([]);
    });
});
