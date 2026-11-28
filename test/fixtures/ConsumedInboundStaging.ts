// @spec-test-coverage-ignore: consumed-inbound and stale-genesis staging shared by mapped chain-read tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { expect } from "chai";

/**
 * Four peers; a forced join lands after the setup and two more blocks are
 * authored. The join is the channel's latest inbound message and leaves the
 * head milestone waiting on the joiner (the `preDisputeSetupCalldataPath`
 * staging).
 */
export async function stageForcedJoinBeforeHeadFinal(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    const forceJoin = await h.join.prepareForceInboundJoinWait();
    await h.transition.advanceState({ count: 2 });
    await h.join.submitPreparedForceInboundJoinWait(forceJoin);
    h.contextApi.captureOriginalFork();
    h.event.resetEventSpies();
}

/**
 * Three peers; peer 0's top-up is force-joined and two finalized blocks
 * consume it. The channel is idle afterwards; `suppressWriterTimeouts` keeps
 * every peer from disputing the idle next writer, for a workflow that outlives
 * the participant timeout.
 */
export async function stageConsumedTopUpAfterSetup(
    h: MathPeerTestHarness,
    options: { suppressWriterTimeouts?: boolean } = {}
) {
    await h.scenario.preDisputeSetup();
    if (options.suppressWriterTimeouts)
        for (const peer of h.peers)
            await h.rpcStub.suppressTimeoutCheck(peer.index);
    await h.join.forceInboundJoinWait({ participant: h.getPeer(0).address });
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    h.event.resetEventSpies();
    h.contextApi.captureOriginalFork();
}

/**
 * Three peers; peer 0's dispute constructed at genesis (empty state proof,
 * latest state = the fork's genesis snapshot), then two finalized blocks and
 * a same-fork snapshot post. The dispute is now stale: the chain's current
 * snapshot is no longer the genesis one, so the empty-proof genesis check
 * (`isCorrectLatestState`, also inside the invalid-state-proof counter) answers "incorrect"
 * on the chain. Serving the auditor's chain reads
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
