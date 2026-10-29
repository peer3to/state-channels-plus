// @spec-test-coverage-ignore: local mirror divergence staging shared by mapped local-first tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { expect } from "chai";

/**
 * Four peers; `laggingIndex`'s local diamond misses the InboundMessagesProcessed
 * log of a later forced join while its storage and ingest keep up. The other
 * peers' mirrors, and the chain, have the join. The join is the channel's
 * latest inbound message and leaves the head milestone waiting on the joiner
 * (the `preDisputeSetupCalldataPath` staging with one lagging mirror).
 */
export async function stageMirrorMissingJoin(
    h: MathPeerTestHarness,
    laggingIndex: number
) {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    const held = await h.mirror.holdUpdates(
        laggingIndex,
        "onInboundMessagesProcessed"
    );
    const forceJoin = await h.join.prepareForceInboundJoinWait();
    await h.transition.advanceState({ count: 2 });
    await h.join.submitPreparedForceInboundJoinWait(forceJoin);
    h.contextApi.captureOriginalFork();
    h.event.resetEventSpies();
    expect(
        await held.heldCount(),
        "the lagging mirror must have missed the join"
    ).to.be.greaterThan(0);
    return held;
}

/**
 * Three peers; `laggingIndex`'s local diamond misses the InboundMessagesProcessed
 * log of peer 0's top-up while its storage and ingest keep up. Two finalized
 * blocks consume the top-up, so the latest snapshot's deposits name an inbound
 * block only the chain and the other mirrors hold. The channel is idle
 * afterwards; `suppressWriterTimeouts` keeps every peer from disputing the
 * idle next writer, for a workflow that outlives the participant timeout.
 */
export async function stageMirrorMissingConsumedTopUp(
    h: MathPeerTestHarness,
    laggingIndex: number,
    options: { suppressWriterTimeouts?: boolean } = {}
) {
    await h.scenario.preDisputeSetup();
    if (options.suppressWriterTimeouts)
        for (const peer of h.peers)
            await h.rpcStub.suppressTimeoutCheck(peer.index);
    const held = await h.mirror.holdUpdates(
        laggingIndex,
        "onInboundMessagesProcessed"
    );
    await h.join.forceInboundJoinWait({ participant: h.getPeer(0).address });
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    h.event.resetEventSpies();
    h.contextApi.captureOriginalFork();
    expect(
        await held.heldCount(),
        "the lagging mirror must have missed the top-up"
    ).to.be.greaterThan(0);
    return held;
}

/**
 * Three peers; peer 0's dispute constructed at genesis (empty state proof,
 * latest state = the fork's genesis snapshot), then two finalized blocks and
 * a same-fork snapshot post. The dispute is now stale: the chain's current
 * snapshot is no longer the genesis one, so the empty-proof genesis check
 * (`isCorrectLatestState`, also inside the invalid-state-proof counter) answers "incorrect"
 * on the mirror and on the chain alike. Serving the auditor's chain reads
 * from before the snapshot post then gives a chain view on which the same
 * dispute is correct.
 */
export async function stageStaleGenesisDispute(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0);
    const constructed = await h.dispute.fetchConstructedDispute(0);
    expect(constructed.dispute.input.stateProof.milestones).to.deep.equal([]);
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    const snapshot = await h.transition.postSnapshotWait();
    expect(snapshot, "the same-fork snapshot post must land").to.not.equal(
        undefined
    );
    return constructed;
}
