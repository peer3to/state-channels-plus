// @spec-test-coverage-ignore: shared staging for the mapped fraud-proof replay gas-limit cases
import {
    ANCHORED_TAIL,
    appendInvalidTransition,
    prependStoredBlocks,
    stageAnchorBeforeUnfinalizedTail,
    uploadSelfRemovalDispute
} from "./ChallengeBoundaryStaging";
import type {
    RecordedDisputeSubmission,
    RecordedFraudProofApply,
    RecordedGasEstimate,
    RecordedReplayGasRead
} from "./customRpc/harnessControl/services/stub/StubService";
import { killAndDisputeStoredDispute } from "./EvidenceComparisonStaging";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { ForkId } from "@/types/types";
import { Codec, Type, hash, sleep } from "@/utils";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import { waitFor } from "@test/utils/waitFor";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";

/**
 * Estimate scale as a fraction of the chain's real estimate, without
 * headroom; with `times`, only the first `times` estimates are scaled.
 */
export type EstimateScale = {
    numerator: number;
    denominator: number;
    times?: number;
};

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
 * sent (a real one derails the session); the chain's estimate for it is
 * answered scaled by `scale`. With `blockRead`, the dispute's latest-block
 * read answers `blockRead.gasLimit` as the block's gas limit.
 */
export async function disputeWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale,
    options: { blockRead?: { gasLimit: bigint } } = {}
): Promise<{
    submissions: RecordedDisputeSubmission[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
    stubbedBlockReads: number;
}> {
    await h.lifecycle.start(3, 3);
    const peer = h.getPeer(0);
    await h.byzantine.storeInvalidTransitionFraudProof(peer.index);
    const recorded = await h.rpcStub.recordDisputeSubmissions(peer.index);
    const estimates = await h.rpcStub.scaleReplayGasEstimates(peer.index, {
        methods: ["multicall"],
        ...scale
    });
    const stub = h.control(peer).stub;
    if (options.blockRead)
        await stub
            .stubReplayGasBlockRead(String(options.blockRead.gasLimit))
            .request();
    await disputeOnHost(h, peer.index);
    return {
        submissions: await recorded.submissions(),
        estimates: await estimates.estimates(),
        replayGas: await h.channelManager.getStateTransitionReplayGas(),
        stubbedBlockReads: await stub.getStubbedReplayGasBlockReads().request()
    };
}

/**
 * A committed spam dispute the killer holds a dispute fraud proof against,
 * whose check replays no transition; the killer's `killDispute` sends the
 * real `applyDisputeFraudProofs`, with the chain's estimate for it answered
 * scaled by `scale`. `sends` counts the mined kill sends, resends included.
 */
export async function killWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale
): Promise<{
    storedProofTypes: number[];
    applies: RecordedFraudProofApply[];
    estimates: RecordedGasEstimate[];
    slashed: string[];
    spammer: string;
    sends: SendOutcomes;
}> {
    const { killer, spammer } = await h.scenario.stageUnkilledSpamDispute();
    const recorded = await h.rpcStub.recordDisputeFraudProofApplies(
        killer.index
    );
    const estimates = await h.rpcStub.scaleReplayGasEstimates(killer.index, {
        methods: ["applyDisputeFraudProofs"],
        ...scale
    });
    const before = await fraudProofSendOutcomes(h, killer.index);
    await killStoredDisputeOnHost(h, killer.index);
    const after = await fraudProofSendOutcomes(h, killer.index);
    return {
        storedProofTypes: await storedDisputeFraudProofTypes(h, killer.index),
        applies: await recorded.applies(),
        estimates: await estimates.estimates(),
        slashed: await h.query.onChainSlashedParticipants(),
        spammer: spammer.address,
        sends: sendDelta(
            before.applyDisputeFraudProofs,
            after.applyDisputeFraudProofs
        )
    };
}

/**
 * The killer of a committed spam dispute (see killWithScaledEstimate) has not
 * disputed yet, so its `dispute(forkId, { kill })` sends the kill and its own
 * dispute in one best-effort multicall, forwarded to the chain and recorded;
 * no proof in it replays a transition. The chain's estimate for the
 * multicall is answered scaled by `scale`.
 */
export async function killAndDisputeWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale
): Promise<{
    rejected: string;
    submissions: RecordedDisputeSubmission[];
    estimates: RecordedGasEstimate[];
    slashed: string[];
    spammer: string;
}> {
    const { forkId, killer, spammer } =
        await h.scenario.stageUnkilledSpamDispute();
    const recorded = await h.rpcStub.recordDisputeSubmissions(killer.index, {
        forward: true
    });
    const estimates = await h.rpcStub.scaleReplayGasEstimates(killer.index, {
        methods: ["multicall"],
        ...scale
    });
    const { rejected } = await killAndDisputeStoredDispute(
        h,
        killer.index,
        spammer.address,
        forkId
    );
    return {
        rejected,
        submissions: await recorded.submissions(),
        estimates: await estimates.estimates(),
        slashed: await h.query.onChainSlashedParticipants(),
        spammer: spammer.address
    };
}

/** Solidity proof types of the dispute fraud proofs a peer stored. */
async function storedDisputeFraudProofTypes(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<number[]> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm) =>
            sm.storage.disputeFraudProofs
                .getDisputeFraudProofs()
                .map((proof) => Number(proof.proofType)),
        {},
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/** Mined outcomes of one manager function's sends, from a peer's gas usage. */
export type SendOutcomes = {
    succeeded: number;
    reverted: number;
    /** Gas the reverted sends burned. */
    revertedGasUsed: bigint;
};

/**
 * Mined outcomes of the fraud-proof sends a peer's chain signer broadcast,
 * resends included, per manager function.
 */
async function fraudProofSendOutcomes(
    h: MathPeerTestHarness,
    peerIndex: number
): Promise<
    Record<"applyDisputeFraudProofs" | "multicallBestEffortLast", SendOutcomes>
> {
    const { gasUsage } = await h
        .control(h.getPeer(peerIndex))
        .query.getGasUsageTable()
        .request();
    const outcomes = (functionName: string): SendOutcomes => {
        const row = gasUsage.find((r) => r.functionName === functionName);
        return {
            succeeded: row?.successCount ?? 0,
            reverted: row?.revertedCount ?? 0,
            revertedGasUsed: BigInt(row?.revertedGasUsed ?? 0)
        };
    };
    return {
        applyDisputeFraudProofs: outcomes("applyDisputeFraudProofs"),
        multicallBestEffortLast: outcomes("multicallBestEffortLast")
    };
}

/** The sends mined between two reads of a peer's send outcomes. */
function sendDelta(before: SendOutcomes, after: SendOutcomes): SendOutcomes {
    return {
        succeeded: after.succeeded - before.succeeded,
        reverted: after.reverted - before.reverted,
        revertedGasUsed: after.revertedGasUsed - before.revertedGasUsed
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
 * Every peer's automatic kill is suppressed until the killer stored its proof,
 * then the killer's `killDispute` is restored so a test can drive the kill.
 * `beforeDispute` runs on the healthy fork, before the timeout dispute.
 */
export async function stageUnkilledTimeoutCalldataDispute(
    h: MathPeerTestHarness,
    options: {
        stateMachineGasLimit?: number;
        beforeDispute?: () => Promise<void>;
    } = {}
): Promise<{
    killerIndex: number;
    disputerIndex: number;
    dispute: DisputeStruct;
}> {
    const killerIndex = 0;
    const disputerIndex = 3;
    await h.lifecycle.start(4, 0, {
        timeConfig: resolveTestTimeConfig({ evidenceTime: 12 }),
        stateMachineGasLimit: options.stateMachineGasLimit
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
    await options.beforeDispute?.();

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
    return { killerIndex, disputerIndex, dispute };
}

/**
 * The killer's `killDispute` of the staged timeout dispute (see
 * stageUnkilledTimeoutCalldataDispute) sends the real
 * `applyDisputeFraudProofs`, with the chain's estimate for it answered scaled
 * by `scale`. The kill's latest-block read fails (`"fail"`), answers
 * `blockRead.gasLimit` as the block's gas limit, or answers the manager's
 * replay requirement (`"replayGas"`), a limit below what the replay needs.
 * With `passPreflight`, the handler's preflight of the mined revert at the
 * kill's limit is answered as passed once, so it resends.
 * `rejected` is the kill's rejection message, empty when it resolved.
 */
export async function killTimeoutCalldataRefutationWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale,
    options: {
        blockRead?: { gasLimit: bigint } | "fail" | "replayGas";
        stateMachineGasLimit?: number;
        passPreflight?: boolean;
    } = {}
): Promise<{
    storedProofTypes: number[];
    applies: RecordedFraudProofApply[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
    slashed: string[];
    disputer: string;
    committedAfterKill: boolean;
    stubbedBlockReads: number;
    rejected: string;
    sends: SendOutcomes;
    passedPreflights: number;
}> {
    const { killerIndex, disputerIndex, dispute } =
        await stageUnkilledTimeoutCalldataDispute(h, {
            stateMachineGasLimit: options.stateMachineGasLimit
        });
    const storedProofTypes = await storedDisputeFraudProofTypes(h, killerIndex);
    const recorded =
        await h.rpcStub.recordDisputeFraudProofApplies(killerIndex);
    const estimates = await h.rpcStub.scaleReplayGasEstimates(killerIndex, {
        methods: ["applyDisputeFraudProofs"],
        ...scale
    });
    const killer = h.control(h.getPeer(killerIndex)).stub;
    const replayGas = await h.channelManager.getStateTransitionReplayGas();
    const { blockRead } = options;
    if (blockRead)
        await killer
            .stubReplayGasBlockRead(
                blockRead === "fail"
                    ? null
                    : String(
                          blockRead === "replayGas"
                              ? replayGas
                              : blockRead.gasLimit
                      )
            )
            .request();
    if (options.passPreflight) await killer.stubPassReplayPreflight().request();
    const before = await fraudProofSendOutcomes(h, killerIndex);
    let rejected = "";
    try {
        await killStoredDisputeOnHost(h, killerIndex);
    } catch (error) {
        rejected = error instanceof Error ? error.message : String(error);
    }
    const after = await fraudProofSendOutcomes(h, killerIndex);
    return {
        storedProofTypes,
        applies: await recorded.applies(),
        estimates: await estimates.estimates(),
        replayGas,
        slashed: await h.query.onChainSlashedParticipants(),
        disputer: h.getPeer(disputerIndex).address,
        committedAfterKill: await isDisputeCommittedOnChain(h, dispute),
        stubbedBlockReads: await killer
            .getStubbedReplayGasBlockReads()
            .request(),
        rejected,
        sends: sendDelta(
            before.applyDisputeFraudProofs,
            after.applyDisputeFraudProofs
        ),
        passedPreflights: await killer.getPassedReplayPreflights().request()
    };
}

/**
 * The killer of the staged timeout dispute (see
 * stageUnkilledTimeoutCalldataDispute) has not disputed yet, so its
 * `dispute(forkId, { kill })` sends the replaying refutation and its own
 * dispute in one best-effort multicall, forwarded to the chain and recorded,
 * with the chain's estimate for it answered scaled by `scale`. A kill sent
 * alone after a failed multicall is recorded too. With `blockRead:
 * "replayGas"`, the multicall's latest-block read (the first one) answers
 * the manager's replay requirement, a limit below what the replay needs.
 */
export async function killAndDisputeTimeoutCalldataRefutationWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale,
    options: { stateMachineGasLimit?: number; blockRead?: "replayGas" } = {}
): Promise<{
    rejected: string;
    submissions: RecordedDisputeSubmission[];
    applies: RecordedFraudProofApply[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
    slashed: string[];
    disputer: string;
    committedAfterKill: boolean;
    multicallSends: SendOutcomes;
    killSends: SendOutcomes;
}> {
    const { killerIndex, disputerIndex, dispute } =
        await stageUnkilledTimeoutCalldataDispute(h, {
            stateMachineGasLimit: options.stateMachineGasLimit
        });
    const recorded = await h.rpcStub.recordDisputeSubmissions(killerIndex, {
        forward: true
    });
    const applies = await h.rpcStub.recordDisputeFraudProofApplies(killerIndex);
    const estimates = await h.rpcStub.scaleReplayGasEstimates(killerIndex, {
        methods: ["multicall"],
        ...scale
    });
    const replayGas = await h.channelManager.getStateTransitionReplayGas();
    if (options.blockRead === "replayGas")
        await h
            .control(h.getPeer(killerIndex))
            .stub.stubReplayGasBlockRead(String(replayGas))
            .request();
    const disputer = h.getPeer(disputerIndex).address;
    const before = await fraudProofSendOutcomes(h, killerIndex);
    const { rejected } = await killAndDisputeStoredDispute(
        h,
        killerIndex,
        disputer,
        dispute.input.forkId
    );
    const after = await fraudProofSendOutcomes(h, killerIndex);
    return {
        rejected,
        submissions: await recorded.submissions(),
        applies: await applies.applies(),
        estimates: await estimates.estimates(),
        replayGas,
        slashed: await h.query.onChainSlashedParticipants(),
        disputer,
        committedAfterKill: await isDisputeCommittedOnChain(h, dispute),
        multicallSends: sendDelta(
            before.multicallBestEffortLast,
            after.multicallBestEffortLast
        ),
        killSends: sendDelta(
            before.applyDisputeFraudProofs,
            after.applyDisputeFraudProofs
        )
    };
}

/**
 * A committed self-removal dispute whose state proof ends in a block with an
 * invalid transition after the anchor (stageAnchorBeforeUnfinalizedTail).
 * Every auditor's automatic kill is suppressed until peer 0 stored its
 * DisputeInvalidBlockInStateProofApplyFraudProof, then peer 0's
 * `killDispute` sends the real `applyDisputeFraudProofs`, with the chain's
 * estimate for it answered scaled by `scale`.
 */
export async function killStateProofChallengeWithScaledEstimate(
    h: MathPeerTestHarness,
    scale: EstimateScale
): Promise<{
    storedProofTypes: number[];
    applies: RecordedFraudProofApply[];
    estimates: RecordedGasEstimate[];
    replayGas: bigint;
    slashed: string[];
    submitter: string;
}> {
    const killerIndex = 0;
    const { submitterIndex, offlineIndex } = ANCHORED_TAIL;
    await stageAnchorBeforeUnfinalizedTail(h);
    const kills = await Promise.all(
        [killerIndex, 1, offlineIndex].map((index) =>
            h.rpcStub.suppressDisputeKill(index)
        )
    );
    await uploadSelfRemovalDispute(
        h,
        submitterIndex,
        async (dispute) => {
            await prependStoredBlocks(h, dispute, [0, 1]);
            await appendInvalidTransition(h, dispute, submitterIndex);
        },
        { markMalicious: true }
    );
    // the skipped kill is the moment the killer stored its fraud proof
    await kills[0].waitUntilSkipped();
    await kills[0].restore();
    const recorded =
        await h.rpcStub.recordDisputeFraudProofApplies(killerIndex);
    const estimates = await h.rpcStub.scaleReplayGasEstimates(killerIndex, {
        methods: ["applyDisputeFraudProofs"],
        ...scale
    });
    await killStoredDisputeOnHost(h, killerIndex);
    return {
        storedProofTypes: await storedDisputeFraudProofTypes(h, killerIndex),
        applies: await recorded.applies(),
        estimates: await estimates.estimates(),
        replayGas: await h.channelManager.getStateTransitionReplayGas(),
        slashed: await h.query.onChainSlashedParticipants(),
        submitter: h.getPeer(submitterIndex).address
    };
}

/**
 * One peer sends both replaying fraud-proof transactions: its dispute (the
 * fraud-proof multicall, recorded instead of sent) and its kill of the staged
 * timeout dispute (sent for real, see stageUnkilledTimeoutCalldataDispute),
 * with every read of the manager's replay requirement recorded. The
 * transition fraud proof is stored on the healthy fork, before the timeout
 * dispute; the killer's dispute may already be sent by its own audit of the
 * timeout dispute, so the explicit `dispute()` below is a no-op then.
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
    await stageUnkilledTimeoutCalldataDispute(h, {
        beforeDispute: async () => {
            await h.rpcStub.recordReplayGasReads(killerIndex);
            await h.rpcStub.recordDisputeSubmissions(killerIndex);
            await h.byzantine.storeInvalidTransitionFraudProof(killerIndex);
        }
    });
    const killer = h.getPeer(killerIndex);
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
 * and its kill of the staged timeout dispute (sent for real), both replaying,
 * run concurrently while the manager's replay-requirement read is held. `whileHeld` is taken
 * once both sends have asked for their gas limit (each send's estimate is
 * taken beside the requirement read, so a recorded estimate means its send
 * waits on the requirement) and before the read is released. Estimates are
 * the chain's real ones, recorded.
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
    await stageUnkilledTimeoutCalldataDispute(h, {
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
    const killer = h.getPeer(killerIndex);
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
