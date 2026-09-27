// @spec-test-coverage-ignore: local mirror divergence staging shared by mapped local-first tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { timeoutWaitTime } from "@/types";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
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

export const TIMEOUT_CALLDATA_TIME_CONFIG = { evidenceTime: 8 };

/**
 * Four peers, height-2 calldata posted on-chain by its author while peer 3
 * could not confirm, a force-exit dispute window opened by peer 2, and peer
 * 3's constructed dispute (stopping at height 1) blaming the calldata author
 * for height 2. Auditing it finds the calldata on-chain: the
 * TimeoutCalldataPosted preflight runs. `block1` is the previous block.
 */
export async function stageTimeoutCalldataPostedDispute(
    h: MathPeerTestHarness
) {
    await h.lifecycle.timeoutSetup(4, 0, {
        timeConfig: TIMEOUT_CALLDATA_TIME_CONFIG
    });
    await h.transition.advanceState({ count: 2 });
    const calldataAuthor = await h.query.getNextPeerToWrite();
    await h
        .control(h.getPeer(3))
        .stub.stubRejectIngestedConfirmations()
        .request();
    await Promise.all(
        [0, 1, 2, 3].map((i) => h.rpcStub.suppressTimeoutCheck(i))
    );
    await h.network.blacklistAndDisconnectPeer(3);
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: false
    });
    await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2], 1, {
        mode: "atLeast"
    });
    const forkId = h.activeForkId!;
    for (const i of [0, 1, 2, 3]) {
        await h.rpcStub.holdReductionRace(i);
    }

    // too-early clock for coords height 2 is block 1
    const block1 = await h
        .control(h.getPeer(1))
        .query.getBlockByHeight(forkId, 1)
        .request();
    const wait = timeoutWaitTime(
        resolveTestTimeConfig(TIMEOUT_CALLDATA_TIME_CONFIG),
        2
    );
    await h.event.waitUntilTimestamp(block1!.timestamp + wait + 1);
    await h.control(h.getPeer(2)).dispute.setForceExit(true).request();
    await h.tamper.postTamperedDispute(2, () => {}, {
        markMalicious: false
    });

    // peer 3's proof stops at height 1, blaming the calldata author
    await h.tamper.plantFreshTimeoutForParticipant(3, calldataAuthor.address);
    const { dispute } = await h.dispute.fetchConstructedDispute(3);
    await h
        .control(h.getPeer(3))
        .stub.restoreRejectIngestedConfirmations()
        .request();
    expect(Number(dispute.input.timeout.blockHeight)).to.equal(2);
    expect(dispute.postedAuditingData).to.equal(false);
    return { dispute, block1: block1! };
}

/**
 * Three peers; peer 0's dispute constructed at genesis (empty state proof,
 * latest state = the fork's genesis snapshot), then two finalized blocks and
 * a same-fork snapshot post. The dispute is now stale: the chain's current
 * snapshot is no longer the genesis one, so the empty-proof genesis check
 * (`isCorrectLatestState`, also inside `verifyStateProof`) answers "incorrect"
 * on the mirror and on the chain alike. Serving the auditor's chain reads
 * from before the snapshot post then gives a chain view on which the same
 * dispute is correct.
 */
export async function stageStaleGenesisDispute(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0);
    const constructed = await h.dispute.fetchConstructedDispute(0);
    expect(constructed.dispute.input.stateProof.milestones).to.deep.equal([]);
    expect(constructed.dispute.input.stateProof.signedBlocks).to.deep.equal([]);
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    const snapshot = await h.transition.postSnapshotWait();
    expect(snapshot, "the same-fork snapshot post must land").to.not.equal(
        undefined
    );
    return constructed;
}
