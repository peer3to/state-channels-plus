// @spec-test-coverage-ignore: past-block intake staging exercised by explicit BlockQueueManager declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { keepOnlyAuthorSignatures } from "./MilestoneSyncStaging";

/**
 * Three participants author three final blocks (0, 1, 2); the observer
 * (peer 0) records its confirmation operations from the start. The genuine
 * block at height 1 is captured, then the observer prunes heights 0 and 1,
 * as a compact sync proof leaves them: height 1 is free below its next
 * height 3. With `stripStoredHead`, the observer's stored block 2 keeps only
 * its author's signature, so a full copy of it carries new signatures.
 */
export async function stagePrunedObserver(
    h: MathPeerTestHarness,
    options: { stripStoredHead: boolean }
) {
    await h.lifecycle.start(3, 0);
    const observer = h.getPeer(0);
    const source = h.getPeer(1);
    const control = h.control(observer);
    await control.stub.recordConfirmationOperations().request();
    await h.transition.advanceState({ count: 3, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    const forkId = h.activeForkId!;
    const pruned = (await control.query.getBlockByHeight(forkId, 1).request())!;
    const head = (await h
        .control(source)
        .query.getBlockByHeight(forkId, 2)
        .request())!;
    const { prunedHeights } = await control.stub
        .pruneStoredBlocksBelowAnchor(forkId, 2)
        .request();
    if (options.stripStoredHead)
        await keepOnlyAuthorSignatures(h, observer.index, forkId, [2]);
    return { observer, source, forkId, pruned, head, prunedHeights };
}
