// @spec-test-coverage-ignore: state-proof dispute lifecycle staging shared by dispute E2E cases
import {
    craftProofBlock,
    forgedTimestamp,
    postedProof,
    storedProofBlock,
    storedState,
    submitPendingJoin
} from "./DisputeAuditStaging";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { Bytes, ForkId, Hash } from "@/types/types";
import { waitFor } from "@test/utils/waitFor";
import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";
import { ZeroAddress } from "ethers";

/**
 * A proof to post: milestone runs, their snapshots and the latest state.
 * `finalizedState` is the state of the snapshot the chain's walk ends at;
 * omitted, the constructed dispute's is kept.
 */
export type PostedProofParts = {
    milestones: BlockConfirmationStruct[][];
    milestoneSnapshots: StateSnapshotStruct[];
    latestStateSnapshot: StateSnapshotStruct;
    finalizedState?: Bytes;
};

/**
 * `disputerIndex` uploads its own constructed dispute re-pointed at the
 * proof `build` returns from it, with the matching auditing data posted.
 */
export async function postDisputeWithProof(
    h: MathPeerTestHarness,
    disputerIndex: number,
    build: (constructed: {
        milestones: BlockConfirmationStruct[][];
        milestoneSnapshots: StateSnapshotStruct[];
        latestStateSnapshot: StateSnapshotStruct;
    }) => Promise<PostedProofParts>,
    options?: { markMalicious?: boolean }
) {
    return await h.tamper.postTamperedDispute(
        disputerIndex,
        async (dispute, _confirmation, auditingData) => {
            const proof = await build({
                milestones: dispute.input.stateProof.milestones.map(
                    ({ blockConfirmations }) => blockConfirmations
                ),
                milestoneSnapshots: auditingData!.milestoneSnapshots,
                latestStateSnapshot: auditingData!.latestStateSnapshot
            });
            const posted = postedProof(dispute, auditingData!, proof);
            Object.assign(dispute, posted.dispute);
            Object.assign(auditingData!, posted.auditingData);
        },
        options
    );
}

/** The encoded proof of the first dispute fraud proof of `type` stored on the peer. */
export async function storedDisputeFraudProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    type: DisputeFraudProofType
): Promise<string | undefined> {
    const stored = await h.execOnHost(h.getPeer(peerIndex), async (sm) =>
        sm.storage.disputeFraudProofs.getDisputeFraudProofs().map((proof) => ({
            proofType: Number(proof.proofType),
            encodedProof: String(proof.encodedProof)
        }))
    );
    return stored.find(
        (proof) => proof.proofType === toSolidityDisputeFraudProofType(type)
    )?.encodedProof;
}

/**
 * Four peers; the next writer leaves, so its exit posts the on-chain
 * snapshot that starts the fork's proofs above height 0, and the other three
 * (disputer, lagging auditor, auditor) author three more blocks past it. The
 * lagging auditor's local diamond never applies that snapshot: its mirror's
 * proof start stays the genesis. Every remaining peer holds the full
 * history. Timeout checks are suppressed.
 */
export async function stageExitAnchoredForkWithLaggingMirror(
    h: MathPeerTestHarness
) {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    // the leave is submitted in the leaver's turn
    const leaver = (await h.query.getNextPeerToWrite()).index;
    const participants = [0, 1, 2, 3].filter((index) => index !== leaver);
    const [disputer, laggingAuditor, auditor] = participants;
    const lagging = h.control(h.getPeer(laggingAuditor));
    await lagging.stub.stubHoldSnapshotUpdatedEvents().request();
    await h.transition.participantLeaveStateTransition({ leaverIndex: leaver });
    await h.transition.keepAuthoringUntilPeersStatus({
        peerIndices: [leaver],
        status: Status.SYNCED,
        waitForPeers: participants,
        excludePeerIndices: [leaver]
    });
    await h.transition.advanceState({ count: 3, waitForPeers: participants });
    // dropped, not replayed
    await lagging.stub.restoreSnapshotUpdatedEvents(false).request();
    for (const index of participants)
        await h.rpcStub.suppressTimeoutCheck(index);
    const forkId = h.activeForkId!;
    const { canUseOnChainSnapshot, onChainSnapshot } =
        await h.channelManager.getAnchorSnapshot(h.channelId, forkId);
    expect(canUseOnChainSnapshot, "the exit must anchor the fork").to.equal(
        true
    );
    const mirrorAnchored = await h.execOnHost(
        h.getPeer(laggingAuditor),
        async (sm, args) =>
            (
                await sm.diamondStateMachine.localDiamondContract.getAnchorSnapshot(
                    args.channelId,
                    args.forkId
                )
            ).canUseOnChainSnapshot,
        { channelId: h.channelId, forkId }
    );
    expect(mirrorAnchored, "the lagging mirror starts at the genesis").to.equal(
        false
    );
    return {
        forkId,
        disputer,
        laggingAuditor,
        auditor,
        anchorHeight: Number(onChainSnapshot.blockHeight),
        anchorSnapshotHash: StateSnapshot.from(onChainSnapshot).hash
    };
}

/**
 * The disputer's posted proof as one run from block 0: the real blocks below
 * the first height (at or below the anchor) whose real author is another
 * peer, then a run from that height the disputer forges and signs alone. The forged block at the anchor
 * height commits the on-chain snapshot, so the chain's walk accepts the run
 * from there; every other forged block commits a random snapshot, and the
 * last one, above the head, the forged latest state. The chain's walk ends
 * at the anchor, so the posted finalized state is the anchor's. Returns the
 * proof and the run index of the first forged block.
 */
export async function branchingRunBelowAnchor(
    h: MathPeerTestHarness,
    staged: {
        forkId: ForkId;
        disputer: number;
        anchorHeight: number;
        anchorSnapshotHash: Hash;
    }
): Promise<PostedProofParts & { branchIndex: number }> {
    const { forkId, disputer, anchorHeight, anchorSnapshotHash } = staged;
    const disputerAddress = h.getPeer(disputer).address;
    const head = (await h
        .control(h.getPeer(disputer))
        .query.getLatestBlockHeight(forkId)
        .request())!;
    const genesisRun = await storedProofBlock(h, disputer, forkId, 0);
    // real blocks from 0 up to the first one by another author
    const run = [genesisRun.confirmation];
    for (let height = 1; height <= anchorHeight; height++) {
        const { confirmation } = await storedProofBlock(
            h,
            disputer,
            forkId,
            height
        );
        if (
            Block.fromBlockConfirmation(confirmation).author !== disputerAddress
        )
            break;
        run.push(confirmation);
    }
    const branchIndex = run.length;
    expect(
        branchIndex,
        "a block at or below the anchor by another author"
    ).to.be.at.most(anchorHeight);
    const latestStateSnapshot = forgedTimestamp(
        (await storedProofBlock(h, disputer, forkId, head)).snapshot
    );
    for (let height = branchIndex; height <= head + 1; height++) {
        const stateSnapshotHash =
            height === anchorHeight
                ? anchorSnapshotHash
                : height === head + 1
                  ? StateSnapshot.from(latestStateSnapshot).hash
                  : undefined;
        const forged = await craftProofBlock(h, {
            authorIndex: disputer,
            forkId,
            height,
            previousBlockHash: Block.fromBlockConfirmation(run.at(-1)!).hash,
            ...(stateSnapshotHash ? { stateSnapshotHash } : {})
        });
        run.push({ signedBlock: forged.signedBlock, signatures: [] });
    }
    const { onChainSnapshot } = await h.channelManager.getAnchorSnapshot(
        h.channelId,
        forkId
    );
    return {
        milestones: [run],
        milestoneSnapshots: [genesisRun.snapshot],
        latestStateSnapshot,
        finalizedState: await storedState(h, disputer, onChainSnapshot),
        branchIndex
    };
}

/** The peer's dispute whose input names no reason: no timeout, no slashes, no self-removal. */
async function postNoReasonDispute(h: MathPeerTestHarness, peerIndex: number) {
    return await h.tamper.postTamperedDispute(peerIndex, (dispute) => {
        dispute.input.timeout.participant = ZeroAddress;
        dispute.input.onChainSlashes = [];
        dispute.input.selfRemoval = false;
        dispute.input.requireExistingDisputeWindow = false;
    });
}

/**
 * Four peers. Peer 3 will leave through a threshold-final self-removal
 * dispute. Peer 2 posts a dispute naming no reason; peers 1-3 skip its kill,
 * so only peer 0 decides it, and peer 0's decision parks at `hold`: its
 * audit at the on-chain slashes read, or its kill at the replay-gas read.
 * `release` resumes it. Dispute initiation is suppressed everywhere: the
 * only uploads are the no-reason dispute and the final dispute.
 */
export async function stageHeldNoReasonDisputeDecision(
    h: MathPeerTestHarness,
    hold: "audit" | "gasPreparation"
) {
    // the threshold-final dispute is assembled inside the ordinary window
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 15 }
    });
    const forkId = h.activeForkId!;
    const [decider, other, spammer, finalAuthor] = [0, 1, 2, 3];
    await h.dispute.suppressDisputeInitiation([
        decider,
        other,
        spammer,
        finalAuthor
    ]);
    await h
        .control(h.getPeer(finalAuthor))
        .dispute.setForceExit(true)
        .request();
    h.context.leftChannelPeerIndices = [
        ...h.context.leftChannelPeerIndices,
        finalAuthor
    ];
    for (const index of [other, spammer, finalAuthor])
        await h.rpcStub.suppressDisputeKill(index);
    const applies = await h.rpcStub.recordDisputeFraudProofApplies(decider);
    const control = h.control(h.getPeer(decider));
    let release: () => Promise<void>;
    if (hold === "audit") {
        await control.stub.stubHoldOnChainSlashesQuery().request();
        await postNoReasonDispute(h, spammer);
        await control.stub
            .waitForHeldOnChainSlashesQuery()
            .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
        release = async () => {
            await control.stub.restoreOnChainSlashesQuery().request();
        };
    } else {
        const reads = await h.rpcStub.recordReplayGasReads(decider, {
            hold: true
        });
        await postNoReasonDispute(h, spammer);
        await reads.waitUntilHeld(1);
        release = async () => {
            await reads.release();
            await waitFor(async () =>
                (await reads.reads()).every(
                    (read) => read.outcome !== "pending"
                )
            );
        };
    }
    return {
        forkId,
        decider,
        remaining: [decider, other],
        finalAuthor,
        applies,
        release
    };
}

/**
 * Alice (peer 0) and Bob (peer 1) author blocks 0-3, final by both. Charlie
 * (peer 2) syncs, its block work is held, so it never signs again, and it
 * submits its join: the chain's required set names Charlie. Alice and Bob
 * author one more block without Charlie's signature. Timeout checks are
 * suppressed. `release` resumes Charlie's block work.
 */
export async function stageHistoryWithoutCharlie(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 0);
    const [alice, bob] = [0, 1];
    const charlie = await h.join.addSpectatorWait();
    const hold = await h.rpcStub.holdBlockWork(charlie.index, "queueDequeue");
    try {
        await h.transition.advanceState({
            count: 4,
            waitForFinalization: true,
            waitForPeers: [alice, bob]
        });
        await submitPendingJoin(h, charlie, [alice, bob]);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [alice, bob]
        });
    } catch (error) {
        await hold.release();
        throw error;
    }
    return {
        forkId: h.activeForkId!,
        alice,
        bob,
        charlie: charlie.index,
        release: hold.release
    };
}
