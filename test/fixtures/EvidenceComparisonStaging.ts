// @spec-test-coverage-ignore: real dispute audits staged for the post-audit evidence comparison
import type { EvidenceComparisonFault } from "./customRpc/harnessControl/services/stub/node/EvidenceComparisonRecorder";
import type { DisputeSubmissionFailureSpec } from "./customRpc/harnessControl/services/stub/StubService";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { Address, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { EvidenceComparisonRecording } from "@test/harness/actions/rpcStubActions";
import { waitFor } from "@test/utils/waitFor";
import type {
    DisputeConfirmationStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";

/**
 * Four peers, one invalid state transition. Every honest peer except
 * `auditorIndex` disputes it; the auditor's dispute initiation is suppressed,
 * so it only audits. Each honest peer records its evidence comparisons;
 * `auditorFault` applies to the auditor's first one. Returns once the
 * disputers initiated their disputes.
 */
async function startDisputeRace(
    h: MathPeerTestHarness,
    auditorFault?: EvidenceComparisonFault
) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const offender = await h.query.getNextPeerToWrite();
    const honest = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== offender.index);
    const auditorIndex = honest[honest.length - 1];
    const disputerIndices = honest.filter((index) => index !== auditorIndex);
    const recorders = new Map(
        await Promise.all(
            honest.map(
                async (index) =>
                    [
                        index,
                        await h.rpcStub.recordEvidenceComparisons(index, {
                            fault:
                                index === auditorIndex
                                    ? auditorFault
                                    : undefined
                        })
                    ] as const
            )
        )
    );
    await h.dispute.suppressDisputeInitiation([auditorIndex]);

    await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
    await h.assert.dispute.initiatedWait({ peersIndices: disputerIndices });
    return { honest, auditorIndex, disputerIndices, recorders };
}

/**
 * {@link startDisputeRace}, returning once the auditor has audited every
 * dispute.
 */
export async function stageEvidenceAuditsOfDisputeRace(h: MathPeerTestHarness) {
    const { honest, auditorIndex, disputerIndices, recorders } =
        await startDisputeRace(h);
    await h.assert.dispute.committedWait({
        peersIndices: honest,
        expectedCount: disputerIndices.length
    });
    return { auditorIndex, disputerIndices, recorders };
}

/**
 * {@link startDisputeRace} with the auditor's first comparison held: returns
 * once that comparison waits at the hold and both disputes' audits have asked
 * for a comparison, so the second audit overlaps the first for certain.
 */
export async function stageHeldEvidenceComparisonRace(h: MathPeerTestHarness) {
    const { auditorIndex, disputerIndices, recorders } = await startDisputeRace(
        h,
        "hold"
    );
    const recorder = recorders.get(auditorIndex)!;
    await recorder.waitUntilHeld();
    await recorder.waitUntilAudited(disputerIndices.length);
    return { auditorIndex, recorder };
}

const EVIDENCE_UPLOAD_FAILURE_MESSAGE = "stubbed evidence upload failure";

/**
 * Four peers, one invalid state transition, two disputes that land one after
 * the other. The auditor asked to leave, so its own dispute adds a
 * self-removal the window lacks: its first comparison answers "more
 * evidence". That comparison is held until the auditor's upload is armed to
 * fail once with `uploadFailure` (by default a send failure that is no
 * custom error: the upload is simply lost), then released. The second disputer's upload waits at its send until
 * the auditor's first audit completed, then lands. Returns right after that
 * release, with the failed first upload.
 */
export async function stageEvidenceUploadRetry(
    h: MathPeerTestHarness,
    uploadFailure: Pick<
        DisputeSubmissionFailureSpec,
        "customError" | "message"
    > = { message: EVIDENCE_UPLOAD_FAILURE_MESSAGE }
) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const offender = await h.query.getNextPeerToWrite();
    const [firstDisputerIndex, secondDisputerIndex, auditorIndex] = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== offender.index);
    const recorder = await h.rpcStub.recordEvidenceComparisons(auditorIndex, {
        fault: "hold"
    });
    const secondUpload = await h.rpcStub.recordDisputeSubmissions(
        secondDisputerIndex,
        { hold: true, forward: true }
    );
    await h.dispute.suppressDisputeInitiation([auditorIndex]);
    await h
        .control(h.getPeer(auditorIndex))
        .dispute.setForceExit(true)
        .request();

    await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
    await h.assert.dispute.initiatedWait({
        peersIndices: [firstDisputerIndex]
    });
    await recorder.waitUntilHeld();
    // the invalid block is behind the auditor: from now on only its evidence
    // comparison makes it dispute
    await h.dispute.restoreDisputeInitiation([auditorIndex]);
    const auditorUploads = await h.rpcStub.recordDisputeSubmissions(
        auditorIndex,
        {
            forward: true,
            failWith: { ...uploadFailure, at: "send", times: 1 }
        }
    );
    await recorder.releaseHeld("forward");
    await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 1);
    const firstUploads = await auditorUploads.submissions();

    await secondUpload.waitUntilHeld();
    await secondUpload.release();
    return { auditorIndex, firstUploads, auditorUploads, recorder };
}

/**
 * Four peers, one invalid state transition, two disputes that land one after
 * the other. The auditor (dispute initiation suppressed) records its evidence
 * comparisons with `fault` on the first one. The second dispute is uploaded
 * only after the first comparison settled, so the auditor's two audits never
 * overlap. Returns once the second comparison settled.
 */
export async function stageSequentialEvidenceAudits(
    h: MathPeerTestHarness,
    fault: EvidenceComparisonFault
) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const forkId = h.activeForkId!;
    const offender = await h.query.getNextPeerToWrite();
    const [firstDisputerIndex, secondDisputerIndex, auditorIndex] = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== offender.index);
    const recorder = await h.rpcStub.recordEvidenceComparisons(auditorIndex, {
        fault
    });
    await h.dispute.suppressDisputeInitiation([
        secondDisputerIndex,
        auditorIndex
    ]);

    await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
    await h.assert.dispute.initiatedWait({
        peersIndices: [firstDisputerIndex]
    });
    await recorder.waitUntilSettled(1);
    const first = await recorder.comparisons();

    await h.rpcStub.restoreDisputeInitiationAndDispute(
        secondDisputerIndex,
        forkId
    );
    await recorder.waitUntilSettled(2);
    return { auditorIndex, first, recorder };
}

/**
 * FY1: four peers. A spam dispute opens the window and every peer audits it
 * as invalid, with kills held back. Peer 2 then adds a state-only dispute,
 * which the auditor (peer 3, dispute initiation suppressed) compares its own
 * evidence against: nothing to add, and that answer is cached. The auditor
 * then asks to leave, so its own dispute would now carry a self-removal the
 * window lacks. Peer 2 kills the spam dispute, the auditor's initiation is
 * restored, and peer 0 adds one more dispute - the first audit after the
 * kill. Every peer holds its reduction timers.
 */
export async function stageEvidenceAuditAfterKill(h: MathPeerTestHarness) {
    const auditorIndex = 3;
    const contributorIndex = 2;
    const lastContributorIndex = 0;
    let recorder: EvidenceComparisonRecording | undefined;
    const { forkId, spammer, killer } =
        await h.scenario.stageUnkilledSpamDispute({
            peerCount: 4,
            killerIndex: contributorIndex,
            spammerIndex: 1,
            // Protocol input: the three uploads and the kill below all land
            // inside one window, with room for a loaded machine.
            timeConfig: { evidenceTime: 20 },
            beforeDispute: async () => {
                for (const peer of h.peers)
                    await h
                        .control(peer)
                        .stub.stubHoldReductionTasks()
                        .request();
                recorder =
                    await h.rpcStub.recordEvidenceComparisons(auditorIndex);
                await h.dispute.suppressDisputeInitiation([
                    lastContributorIndex,
                    contributorIndex,
                    auditorIndex
                ]);
            }
        });
    // the spam dispute's audit failed on the auditor
    await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 1);
    const afterFailedAudit = await recorder!.comparisons();

    await h.rpcStub.restoreDisputeInitiationAndDispute(
        contributorIndex,
        forkId
    );
    await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 2);
    const beforeKill = await recorder!.comparisons();

    await h
        .control(h.getPeer(auditorIndex))
        .dispute.setForceExit(true)
        .request();

    await killSpamDispute(h, killer.index, spammer.address, forkId);
    await h.event.waitForPeers("onDisputeKilled", [auditorIndex], 1);

    await h.dispute.restoreDisputeInitiation([auditorIndex]);
    await h.rpcStub.restoreDisputeInitiationAndDispute(
        lastContributorIndex,
        forkId
    );
    return { auditorIndex, afterFailedAudit, beforeKill, recorder: recorder! };
}

/**
 * The same four-peer window as {@link stageEvidenceAuditAfterKill}, with the
 * auditor's first comparison (against peer 2's dispute) held. While it waits,
 * peer 2 kills the spam dispute, which drops that comparison, and peer 0's
 * dispute starts and settles the replacement comparison. Returns with the
 * first comparison still held.
 */
export async function stageEvidenceComparisonReplacedAfterKill(
    h: MathPeerTestHarness
) {
    const auditorIndex = 3;
    const contributorIndex = 2;
    const lastContributorIndex = 0;
    let recorder: EvidenceComparisonRecording | undefined;
    const { forkId, spammer, killer } =
        await h.scenario.stageUnkilledSpamDispute({
            peerCount: 4,
            killerIndex: contributorIndex,
            spammerIndex: 1,
            // Protocol input: the three uploads and the kill below all land
            // inside one window, with room for a loaded machine.
            timeConfig: { evidenceTime: 20 },
            beforeDispute: async () => {
                for (const peer of h.peers)
                    await h
                        .control(peer)
                        .stub.stubHoldReductionTasks()
                        .request();
                recorder = await h.rpcStub.recordEvidenceComparisons(
                    auditorIndex,
                    { fault: "hold" }
                );
                await h.dispute.suppressDisputeInitiation([
                    lastContributorIndex,
                    contributorIndex,
                    auditorIndex
                ]);
            }
        });
    // the spam dispute's audit failed on the auditor, without a comparison
    await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 1);

    await h.rpcStub.restoreDisputeInitiationAndDispute(
        contributorIndex,
        forkId
    );
    await recorder!.waitUntilHeld();

    await killSpamDispute(h, killer.index, spammer.address, forkId);
    await h.event.waitForPeers("onDisputeKilled", [auditorIndex], 1);

    await h.rpcStub.restoreDisputeInitiationAndDispute(
        lastContributorIndex,
        forkId
    );
    // the replacement's audit completed while the first one is still held
    await h.event.waitForPeers("onDisputeCommitted", [auditorIndex], 2);
    return { auditorIndex, recorder: recorder! };
}

/** Peer `killerIndex` kills the spam dispute `spammer` uploaded on `forkId`. */
async function killSpamDispute(
    h: MathPeerTestHarness,
    killerIndex: number,
    spammer: Address,
    forkId: ForkId
) {
    await h.execOnHost(
        h.getPeer(killerIndex),
        async (sm, args) => {
            const dispute = sm.storage.disputeFraudProofs
                .getDisputeFraudProofs()
                .find(
                    (proof) =>
                        proof.dispute.input.disputer === args.spammer &&
                        proof.dispute.input.forkId === args.forkId
                )?.dispute;
            if (!dispute) throw new Error("The spam dispute is missing");
            await sm.disputeManager.killDispute(dispute);
        },
        { spammer, forkId }
    );
}

/**
 * The dispute `disputer` committed, as peer `observerIndex` handled its
 * DisputeCommitted event; waits for that event.
 */
export async function waitForCommittedDisputeOf(
    h: MathPeerTestHarness,
    observerIndex: number,
    disputer: Address
): Promise<DisputeStruct> {
    const find = () =>
        h
            .getPeer(observerIndex)
            .eventSpies.onDisputeCommitted!.getCalls()
            .map((call) =>
                Codec.decode(
                    (call.args[1] as DisputeConfirmationStruct).signedDispute
                        .encodedDispute,
                    Type.Dispute
                )
            )
            .find((dispute) => dispute.input.disputer === disputer);
    await waitFor(
        async () => find() !== undefined,
        h.event.protocolEventTimeoutMs()
    );
    return find()!;
}
