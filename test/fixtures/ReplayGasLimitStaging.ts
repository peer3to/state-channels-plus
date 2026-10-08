// @spec-test-coverage-ignore: shared staging for the mapped fraud-proof replay gas-limit cases
import type {
    RecordedDisputeSubmission,
    RecordedFraudProofApply,
    RecordedGasEstimate,
    RecordedReplayGasRead
} from "./customRpc/harnessControl/services/stub/StubService";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { ForkId } from "@/types/types";
import { Codec, Type, hash, sleep } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";

/** Estimate scale as a fraction of the chain signer's real estimate. */
export type EstimateScale = { numerator: number; denominator: number };

/** Run `dispute()` on a peer's host for the active fork. */
export async function disputeOnHost(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId = h.activeForkId!
): Promise<void> {
    await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            await sm.disputeManager.dispute(args.forkId);
        },
        { forkId },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/** Run `killDispute` on a peer's host for its first stored dispute fraud proof. */
export async function killStoredDisputeOnHost(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<void> {
    await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm) => {
            const [proof] =
                sm.storage.disputeFraudProofs.getDisputeFraudProofs();
            await sm.disputeManager.killDispute(proof.dispute);
        },
        {},
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * A settled fork whose peer 0 holds an invalid-transition fraud proof, so its
 * `dispute()` sends the fraud-proof multicall. The upload is recorded, not
 * sent (a real one derails the session); the chain signer's estimate for it
 * is answered scaled by `scale`.
 */
export async function disputeWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale
): Promise<{
    submissions: RecordedDisputeSubmission[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
}> {
    await h.lifecycle.start(3, 3);
    const peer = h.getPeer(0);
    await h.byzantine.storeInvalidTransitionFraudProof(peer.index);
    const recorded = await h.rpcStub.recordDisputeSubmissions(peer.index);
    const estimates = await h.rpcStub.scaleReplayGasEstimates(peer.index, {
        methods: ["multicall"],
        ...scale
    });
    await disputeOnHost(h, peer.index);
    return {
        submissions: await recorded.submissions(),
        estimates: await estimates.estimates(),
        replayGas: await h.channelManager.getStateTransitionReplayGas()
    };
}

/**
 * A committed spam dispute the killer holds a dispute fraud proof against;
 * the killer's `killDispute` sends the real `applyDisputeFraudProofs`, with
 * the chain signer's estimate for it answered scaled by `scale`.
 */
export async function killWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale
): Promise<{
    applies: RecordedFraudProofApply[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
    slashed: string[];
    spammer: string;
}> {
    const { killer, spammer } = await h.scenario.stageUnkilledSpamDispute();
    const recorded = await h.rpcStub.recordDisputeFraudProofApplies(
        killer.index
    );
    const estimates = await h.rpcStub.scaleReplayGasEstimates(killer.index, {
        methods: ["applyDisputeFraudProofs"],
        ...scale
    });
    await killStoredDisputeOnHost(h, killer.index);
    return {
        applies: await recorded.applies(),
        estimates: await estimates.estimates(),
        replayGas: await h.channelManager.getStateTransitionReplayGas(),
        slashed: await h.query.onChainSlashedParticipants(),
        spammer: spammer.address
    };
}

/** Whether `dispute` is still committed in its fork's on-chain window. */
async function isDisputeCommittedOnChain(
    h: MathPeerTestHarness,
    dispute: DisputeStruct
): Promise<boolean> {
    const commitments = await h.channelManager.getWindowCommitments(
        h.channelId,
        dispute.input.forkId
    );
    return commitments.includes(hash(Codec.encode(dispute, Type.Dispute)));
}

/**
 * A committed forced timeout dispute by peer 3 blaming the author of height 2,
 * who posted that block's calldata on-chain because peer 3 could not confirm
 * it. The killer (peer 0) refutes it with a TimeoutCalldataPosted dispute
 * fraud proof, whose check replays the posted block's transition on-chain.
 * Every peer's automatic kill is suppressed until the killer stored its proof;
 * the killer's `killDispute` then sends the real `applyDisputeFraudProofs`,
 * with the chain signer's estimate for it answered scaled by `scale`.
 */
export async function killTimeoutCalldataRefutationWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale
): Promise<{
    storedProofTypes: number[];
    applies: RecordedFraudProofApply[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
    slashed: string[];
    disputer: string;
    committedAfterKill: boolean;
}> {
    const killerIndex = 0;
    const disputerIndex = 3;
    await h.lifecycle.timeoutSetup(4, 0, {
        timeConfig: { evidenceTime: 12 }
    });
    // height 1 exists, so the posted block gets no first-block grace
    await h.transition.advanceState({ count: 2 });
    const calldataAuthor = await h.query.getNextPeerToWrite();
    // peer 3 cannot confirm height 2, so its author posts it as calldata
    await h
        .control(h.getPeer(disputerIndex))
        .stub.stubRejectIngestedConfirmations()
        .request();
    await Promise.all(
        [0, 1, 2, 3].map((peerIndex) =>
            h.rpcStub.suppressTimeoutCheck(peerIndex)
        )
    );
    await h.network.blacklistAndDisconnectPeer(disputerIndex);
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [0, 1, 2],
        waitForFinalization: false
    });
    await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2, 3], 1, {
        mode: "atLeast"
    });
    await h.tamper.plantFreshTimeoutForParticipant(
        disputerIndex,
        calldataAuthor.address
    );
    await sleep(h.event.evidencePeriodWaitMs());
    h.contextApi.captureOriginalFork();
    h.event.resetEventSpies();

    const kills = await Promise.all(
        h.peers.map((peer) => h.rpcStub.suppressDisputeKill(peer.index))
    );
    // forced: the calldata is already on-chain, so an unforced timeout
    // upload would be refused by its race check
    const { dispute } = await h.tamper.postTamperedDispute(
        disputerIndex,
        (tampered) => {
            tampered.input.timeout.isForced = true;
        }
    );
    expect(Number(dispute.input.timeout.blockHeight)).to.equal(2);
    expect(dispute.input.timeout.participant).to.equal(calldataAuthor.address);
    // the skipped kill is the moment the killer stored its fraud proof
    await kills[killerIndex].waitUntilSkipped();
    await kills[killerIndex].restore();
    expect(
        await isDisputeCommittedOnChain(h, dispute),
        "the timeout dispute is committed before the kill"
    ).to.equal(true);

    const storedProofTypes = await h.execOnHost(
        h.getPeer(killerIndex),
        async (sm) =>
            sm.storage.disputeFraudProofs
                .getDisputeFraudProofs()
                .map((proof) => Number(proof.proofType)),
        {},
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
    const recorded =
        await h.rpcStub.recordDisputeFraudProofApplies(killerIndex);
    const estimates = await h.rpcStub.scaleReplayGasEstimates(killerIndex, {
        methods: ["applyDisputeFraudProofs"],
        ...scale
    });
    await killStoredDisputeOnHost(h, killerIndex);
    return {
        storedProofTypes,
        applies: await recorded.applies(),
        estimates: await estimates.estimates(),
        replayGas: await h.channelManager.getStateTransitionReplayGas(),
        slashed: await h.query.onChainSlashedParticipants(),
        disputer: h.getPeer(disputerIndex).address,
        committedAfterKill: await isDisputeCommittedOnChain(h, dispute)
    };
}

/**
 * One peer sends both fraud-proof transactions: its dispute (the fraud-proof
 * multicall, recorded instead of sent) and its kill of a committed spam
 * dispute (sent for real), with every read of the manager's replay
 * requirement recorded. The transition fraud proof is stored on the healthy
 * fork, before the spam dispute; the killer's dispute may already be sent by
 * its own audit of the spam dispute, so the explicit `dispute()` below is a
 * no-op then.
 */
export async function disputeThenKillRecordingReads(
    h: MathPeerTestHarness
): Promise<{
    reads: RecordedReplayGasRead[];
    submissions: RecordedDisputeSubmission[];
    applies: RecordedFraudProofApply[];
    replayGas: bigint;
}> {
    const killerIndex = 0;
    const { killer } = await h.scenario.stageUnkilledSpamDispute({
        killerIndex,
        beforeDispute: async () => {
            await h.rpcStub.recordReplayGasReads(killerIndex);
            await h.rpcStub.recordDisputeSubmissions(killerIndex);
            await h.byzantine.storeInvalidTransitionFraudProof(killerIndex);
        }
    });
    const applies = await h.rpcStub.recordDisputeFraudProofApplies(
        killer.index
    );
    await disputeOnHost(h, killer.index);
    await killStoredDisputeOnHost(h, killer.index);
    const stub = h.control(killer).stub;
    return {
        reads: await stub.getRecordedReplayGasReads().request(),
        submissions: (await stub.getRecordedDisputeSubmissions().request())
            .submissions,
        applies: await applies.applies(),
        replayGas: await h.channelManager.getStateTransitionReplayGas()
    };
}

/**
 * One peer's dispute (the fraud-proof multicall, recorded instead of sent)
 * and its kill of a committed spam dispute (sent for real) run concurrently
 * while the manager's replay-requirement read is held. `whileHeld` is taken
 * once both sends have asked for their gas limit (each send's estimate is
 * taken beside the requirement read, so a recorded estimate means its send
 * waits on the requirement) and before the read is released. Estimates are
 * the signer's real ones, recorded.
 */
export async function disputeAndKillSharingHeldRead(
    h: MathPeerTestHarness
): Promise<{
    whileHeld: {
        reads: RecordedReplayGasRead[];
        submissions: RecordedDisputeSubmission[];
        applies: RecordedFraudProofApply[];
    };
    reads: RecordedReplayGasRead[];
    submissions: RecordedDisputeSubmission[];
    applies: RecordedFraudProofApply[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
}> {
    const killerIndex = 0;
    const { killer } = await h.scenario.stageUnkilledSpamDispute({
        killerIndex,
        beforeDispute: async () => {
            await h.rpcStub.recordReplayGasReads(killerIndex, { hold: true });
            await h.rpcStub.recordDisputeSubmissions(killerIndex);
            await h.rpcStub.scaleReplayGasEstimates(killerIndex, {
                methods: ["multicall", "applyDisputeFraudProofs"],
                numerator: 1,
                denominator: 1
            });
            await h.byzantine.storeInvalidTransitionFraudProof(killerIndex);
        }
    });
    const applies = await h.rpcStub.recordDisputeFraudProofApplies(
        killer.index
    );
    const stub = h.control(killer).stub;
    const submissions = async () =>
        (await stub.getRecordedDisputeSubmissions().request()).submissions;
    try {
        const sends = Promise.all([
            disputeOnHost(h, killer.index),
            killStoredDisputeOnHost(h, killer.index)
        ]);
        // a failed send surfaces at `await sends`, not as an unhandled rejection
        sends.catch(() => undefined);
        await waitFor(async () => {
            const methods = (
                await stub.getRecordedReplayGasEstimates().request()
            ).map((estimate) => estimate.method);
            return (
                (await stub.getHeldReplayGasReadCount().request()) > 0 &&
                methods.includes("multicall") &&
                methods.includes("applyDisputeFraudProofs")
            );
        }, h.event.protocolEventTimeoutMs());
        const whileHeld = {
            reads: await stub.getRecordedReplayGasReads().request(),
            submissions: await submissions(),
            applies: await applies.applies()
        };
        await stub.releaseReplayGasReads().request();
        await sends;
        return {
            whileHeld,
            reads: await stub.getRecordedReplayGasReads().request(),
            submissions: await submissions(),
            applies: await applies.applies(),
            estimates: await stub.getRecordedReplayGasEstimates().request(),
            replayGas: await h.channelManager.getStateTransitionReplayGas()
        };
    } finally {
        // a parked read must not outlive the test
        await stub.releaseReplayGasReads().request();
    }
}
