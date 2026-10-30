// @spec-test-coverage-ignore: real dispute audits staged for the post-audit evidence comparison
import type { EvidenceComparisonFault } from "./customRpc/harnessControl/services/stub/node/EvidenceComparisonRecorder";
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

export const EVIDENCE_UPLOAD_FAILURE_MESSAGE =
    "stubbed evidence upload failure";

/** The auditor of the higher-state counter-dispute stagings. */
const HIGHER_STATE_AUDITOR = 0;

/** Peer 2 disputes from the genesis; peers 1 and 3 only audit. */
const GENESIS_DISPUTER = 2;
const QUIET_AUDITORS = [1, 3];

/**
 * Four peers; peer 2 is away before block 0, so its view is the genesis
 * while the others reach block 1. Every peer holds its timeout checks and
 * reductions. Peers 1 and 3 only audit (dispute initiation suppressed), as
 * does the auditor (peer 0) with `suppressAuditor`. The auditor's comparisons
 * are recorded with `fault`, and its uploads recorded (forwarded unless
 * `forward` is false, failed once at send with `failUploadOnce`). Peer 2
 * asks to leave. The caller stages its inputs, then calls
 * {@link uploadGenesisDispute}.
 */
export async function prepareHigherStateCounterDispute(
    h: MathPeerTestHarness,
    options: {
        fault?: EvidenceComparisonFault;
        forward?: boolean;
        failUploadOnce?: boolean;
        suppressAuditor?: boolean;
    } = {}
) {
    await h.scenario.preDisputeSetupDisconnectedPeer({
        disconnectedPeerIndex: GENESIS_DISPUTER
    });
    const forkId = h.activeForkId!;
    for (const peer of h.peers) {
        await h.rpcStub.suppressTimeoutCheck(peer.index);
        await h.rpcStub.holdReductionRace(peer.index);
    }
    const recorder = await h.rpcStub.recordEvidenceComparisons(
        HIGHER_STATE_AUDITOR,
        { fault: options.fault }
    );
    const uploads = await h.rpcStub.recordDisputeSubmissions(
        HIGHER_STATE_AUDITOR,
        {
            forward: options.forward ?? true,
            failWith: options.failUploadOnce
                ? {
                      message: EVIDENCE_UPLOAD_FAILURE_MESSAGE,
                      at: "send",
                      times: 1
                  }
                : undefined
        }
    );
    await h.dispute.suppressDisputeInitiation(
        options.suppressAuditor
            ? [...QUIET_AUDITORS, HIGHER_STATE_AUDITOR]
            : QUIET_AUDITORS
    );
    await h
        .control(h.getPeer(GENESIS_DISPUTER))
        .dispute.setForceExit(true)
        .request();
    return {
        forkId,
        auditorIndex: HIGHER_STATE_AUDITOR,
        disputerIndex: GENESIS_DISPUTER,
        quietIndices: QUIET_AUDITORS,
        recorder,
        uploads
    };
}

/**
 * Peer 2 uploads its own genesis-state dispute (a valid self-removal). The
 * auditor's own dispute names the later state, so its comparison answers
 * "more evidence" and it counter-disputes.
 */
export async function uploadGenesisDispute(
    h: MathPeerTestHarness
): Promise<void> {
    await h.tamper.postTamperedDispute(GENESIS_DISPUTER, () => {}, {
        markMalicious: false
    });
}

/**
 * {@link prepareHigherStateCounterDispute} and {@link uploadGenesisDispute}
 * with the auditor's comparison held once its construction is built
 * (`holdBuilt`). Returns while it is held; the release runs the real
 * counter-dispute.
 */
export async function stageHeldHigherStateCounterDispute(
    h: MathPeerTestHarness,
    options: { forward?: boolean } = {}
) {
    const staged = await prepareHigherStateCounterDispute(h, {
        ...options,
        fault: "holdBuilt"
    });
    await uploadGenesisDispute(h);
    await staged.recorder.waitUntilHeld();
    return staged;
}

/**
 * {@link prepareHigherStateCounterDispute} and {@link uploadGenesisDispute}
 * with the auditor's dispute initiation suppressed: returns once its
 * positive comparison is kept and its `dispute()` call was swallowed, so the
 * compared dispute waits for the next `dispute()` of the fork. The caller
 * restores the initiation.
 */
export async function stageKeptHigherStateComparison(h: MathPeerTestHarness) {
    const staged = await prepareHigherStateCounterDispute(h, {
        suppressAuditor: true
    });
    await uploadGenesisDispute(h);
    await waitFor(
        async () => (await staged.recorder.audits())[0]?.outcome === "resolved",
        h.event.protocolEventTimeoutMs()
    );
    return staged;
}

/**
 * A real InvalidStateTransition fraud proof against `offenderIndex` lands in
 * `observerIndex`'s storage: the observer's live strategy handles that
 * deviation for a crafted next block (its dispute and disconnect are only
 * recorded). The strategy hook is driven directly because a disputed fork
 * takes no new block. Returns the offender's address.
 */
async function storeFraudProofOnDisputedFork(
    h: MathPeerTestHarness,
    observerIndex: number,
    offenderIndex: number
): Promise<Address> {
    const { offender, encodedBlock } =
        await h.byzantine.craftInvalidTransitionBlock(observerIndex, {
            offenderIndex
        });
    const validation = await h
        .control(h.getPeer(observerIndex))
        .validation.runBlockValidation(encodedBlock, {
            hook: "invalidStateTransitionDetected"
        })
        .request();
    if (validation.fraudProofType === null)
        throw new Error(`no fraud proof stored (${validation.resultName})`);
    return offender.address;
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
 * then stores a real fraud proof against peer 0 or 2 (whichever is not the
 * next writer), so its own dispute would now apply a slash the window lacks.
 * Peer 2 kills the spam dispute, the auditor's initiation is restored, and
 * peer 0 adds one more dispute - the first audit after the kill. Every peer
 * holds its reduction timers.
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

    const nextWriter = await h.query.getNextPeerToWrite();
    const offender = await storeFraudProofOnDisputedFork(
        h,
        auditorIndex,
        [lastContributorIndex, contributorIndex].find(
            (index) => index !== nextWriter.index
        )!
    );

    await killSpamDispute(h, killer.index, spammer.address, forkId);
    await h.event.waitForPeers("onDisputeKilled", [auditorIndex], 1);

    await h.dispute.restoreDisputeInitiation([auditorIndex]);
    await h.rpcStub.restoreDisputeInitiationAndDispute(
        lastContributorIndex,
        forkId
    );
    return {
        auditorIndex,
        afterFailedAudit,
        beforeKill,
        offender,
        recorder: recorder!
    };
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

/**
 * Peer `spammerIndex` uploads a dispute that names no reason of its own:
 * every auditor finds it invalid and kills it.
 */
export async function postReasonlessDispute(
    h: MathPeerTestHarness,
    spammerIndex: number
): Promise<void> {
    await h.tamper.postTamperedDispute(spammerIndex, (dispute) => {
        dispute.input.timeout.participant =
            "0x0000000000000000000000000000000000000000";
        dispute.input.onChainSlashes = [];
        dispute.input.selfRemoval = false;
        dispute.input.requireExistingDisputeWindow = false;
    });
}

/** Peer `killerIndex` kills the spam dispute `spammer` uploaded on `forkId`. */
export async function killSpamDispute(
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
 * Peer `peerIndex` kills the spam dispute it stored a counter for and
 * disputes `forkId` in one multicall, as its audit would. Returns the
 * message `dispute()` rejected with ("" when it did not) and the peer's
 * dispute marker read right after.
 */
export async function killAndDisputeSpamDispute(
    h: MathPeerTestHarness,
    peerIndex: number,
    spammer: Address,
    forkId: ForkId
): Promise<{ rejected: string; disputed: boolean }> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const kill = sm.storage.disputeFraudProofs
                .getDisputeFraudProofs()
                .find(
                    (proof) =>
                        proof.dispute.input.disputer === args.spammer &&
                        proof.dispute.input.forkId === args.forkId
                )?.dispute;
            if (!kill) throw new Error("The spam dispute is missing");
            let rejected = "";
            try {
                await sm.disputeManager.dispute(args.forkId, { kill });
            } catch (error) {
                rejected =
                    error instanceof Error ? error.message : String(error);
            }
            return {
                rejected,
                disputed: sm.storage.disputes.didIDispute(args.forkId)
            };
        },
        { spammer, forkId },
        { timeoutMs: h.event.hostExecTimeoutMs() }
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
