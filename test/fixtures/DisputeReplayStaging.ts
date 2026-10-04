// @spec-test-coverage-ignore: dispute replay staging shared by dispute audit tests
import {
    forgedTimestamp,
    stageExitAnchoredFork,
    storedProofBlock,
    withForgedTip
} from "./DisputeAuditStaging";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import { expect } from "chai";

/**
 * Three peers author blocks 0-2, then peer 2 is cut off and peers 0 and 1
 * author block 3. Peer 0 states self-removal and constructs its dispute.
 * Block 2 is threshold-final; peer 2 never received block 3, a valid
 * transition from block 2. Returns the auditor (peer 2), the dispute and both
 * blocks.
 */
export async function stageCutOffAuditorWithValidTail(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 3, { timeConfig: { chainFallbackTime: 60 } });
    const auditorIndex = 2;
    await h.network.blacklistAndDisconnectPeer(auditorIndex);
    await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
    const forkId = h.activeForkId!;
    await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    const support = await storedProofBlock(h, 0, forkId, 2);
    const tail = await storedProofBlock(h, 0, forkId, 3);
    const tailBlock = Block.fromBlockConfirmation(tail.confirmation);
    expect(
        await h
            .control(h.getPeer(auditorIndex))
            .query.getBlockByHash(tailBlock.hash)
            .request(),
        "the auditor never received block 3"
    ).to.equal(null);
    return { auditorIndex, dispute, auditingData, support, tail, tailBlock };
}

/**
 * `stageExitAnchoredFork`, then one more block final by every participant:
 * the threshold point, above the anchor. The disputer's dispute and a run of
 * the threshold point plus an unseen block linked to it, authored by a
 * participant other than the next writer over a forged latest snapshot. The
 * auditor is a participant that is neither the disputer nor that author.
 */
export async function stageForgedTipAboveAnchorThreshold(
    h: MathPeerTestHarness
) {
    const staged = await stageExitAnchoredFork(h);
    const { forkId, participants, anchorHeight } = staged;
    await h.transition.advanceState({
        count: 1,
        waitForFinalization: true,
        waitForPeers: participants
    });
    const [disputer] = participants;
    const pointHeight = (await h
        .control(h.getPeer(disputer))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    expect(
        pointHeight,
        "the threshold point lies above the anchor"
    ).to.be.greaterThan(anchorHeight);
    const point = await storedProofBlock(h, disputer, forkId, pointHeight);
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(disputer);
    const latest = forgedTimestamp(point.snapshot);
    const { run, forged, offenderIndex } = await withForgedTip(
        h,
        [point.confirmation],
        latest,
        participants
    );
    const auditor = participants.find(
        (index) => index !== disputer && index !== offenderIndex
    )!;
    return {
        ...staged,
        disputer,
        auditor,
        offenderIndex,
        dispute,
        auditingData,
        point,
        run,
        forged,
        latest
    };
}
