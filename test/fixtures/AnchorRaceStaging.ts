// @spec-test-coverage-ignore: chain-anchor race staging shared by dispute audit tests; executable evidence belongs to its calling test declarations.
import type { RecordedFraudProofApply } from "./customRpc/harnessControl/services/stub/StubService";
import {
    craftProofBlock,
    forgedTimestamp,
    postedProof,
    storedProofBlock,
    withChainFinalizedState,
    withForgedTip
} from "./DisputeAuditStaging";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { killStoredDisputeOnHost } from "./ReplayGasLimitStaging";
import { postSnapshotAt } from "./StateProofConstructionStaging";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import type { ForkId, Hash } from "@/types/types";
import { Codec, hash as keccakHash, Type } from "@/utils";
import type { StoredDisputeFraudProof } from "@test/fixtures/customRpc/harnessControl/services/dispute/DisputeService";
import { waitFor } from "@test/utils/waitFor";
import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";

/** Peer 0 disputes and peer 1 audits; three participants. */
const DISPUTER = 0;
const AUDITOR = 1;
const PARTICIPANTS = [0, 1, 2];

/** The kill window outlasts the audit and the kill (as in stageUnkilledSpamDispute). */
const KILL_WINDOW_TIME_CONFIG = { evidenceTime: 12 };

type AnchorRaceStage = {
    forkId: ForkId;
    disputerIndex: number;
    auditorIndex: number;
    participants: number[];
};

type PostedDispute = {
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
};

/** `posted` opens its own dispute window, as a direct upload must. */
function opening<T extends PostedDispute>(posted: T): T {
    posted.dispute.input.requireExistingDisputeWindow = false;
    return posted;
}

/**
 * Three participants author blocks 0..`headHeight`, each final, and peer 0
 * posts the same-fork snapshots. Every mirror applies the post at
 * `mirrorAnchorHeight` (when given). From then on the auditor (peer 1) holds
 * its StateSnapshotUpdated events, so the post at `chainAnchorHeight`
 * reaches the chain and the other mirrors, not the auditor's: its proof
 * start stays at `mirrorAnchorHeight`, else the genesis. No block follows
 * the head, so timeout checks are suppressed. `releaseHeldSnapshots` applies
 * the held events to the auditor's mirror.
 */
export async function stageChainAnchorAheadOfMirror(
    h: MathPeerTestHarness,
    options: {
        mirrorAnchorHeight?: number;
        chainAnchorHeight: number;
        headHeight: number;
    }
) {
    const { mirrorAnchorHeight, chainAnchorHeight, headHeight } = options;
    await h.lifecycle.start(3, (mirrorAnchorHeight ?? chainAnchorHeight) + 1, {
        timeConfig: KILL_WINDOW_TIME_CONFIG
    });
    const auditor = h.getPeer(AUDITOR);
    const stub = h.control(auditor).stub;
    if (mirrorAnchorHeight !== undefined) {
        await postSnapshotAt(h, DISPUTER, mirrorAnchorHeight);
    }
    await stub.stubHoldSnapshotUpdatedEvents().request();
    if (mirrorAnchorHeight !== undefined) {
        await h.transition.advanceState({
            count: chainAnchorHeight - mirrorAnchorHeight,
            waitForFinalization: true
        });
    }
    const posted = await h.transition.postSameForkSnapshotOnlyWait({
        peerIndex: DISPUTER
    });
    expect(posted?.snapshot.blockHeight, "the chain anchor").to.equal(
        chainAnchorHeight
    );
    await waitFor(
        async () => (await stub.getHeldSnapshotUpdatedCount().request()) > 0,
        h.event.protocolEventTimeoutMs()
    );
    if (headHeight > chainAnchorHeight) {
        await h.transition.advanceState({
            count: headHeight - chainAnchorHeight,
            waitForFinalization: true
        });
    }
    for (const index of PARTICIPANTS)
        await h.rpcStub.suppressTimeoutCheck(index);
    expect(
        (await h.query.getLocalStateSnapshot(auditor)).blockHeight,
        "the auditor's mirror start"
    ).to.equal(mirrorAnchorHeight ?? 0);
    return {
        forkId: h.activeForkId!,
        disputerIndex: DISPUTER,
        auditorIndex: AUDITOR,
        participants: PARTICIPANTS,
        /** Replay the held events; resolves once the auditor's mirror starts at the chain anchor. */
        releaseHeldSnapshots: async () => {
            await stub.restoreSnapshotUpdatedEvents(true).request();
            await waitFor(
                async () =>
                    (await h.query.getLocalStateSnapshot(auditor))
                        .blockHeight === chainAnchorHeight,
                h.event.protocolEventTimeoutMs()
            );
        }
    };
}

/**
 * Three participants author blocks 0..`anchorHeight`, each final, and peer 0
 * posts the head snapshot: the chain and every mirror start there. No block
 * follows the head, so timeout checks are suppressed.
 */
export async function stageAnchorAtHead(
    h: MathPeerTestHarness,
    anchorHeight: number
): Promise<AnchorRaceStage> {
    await h.lifecycle.start(3, anchorHeight + 1, {
        timeConfig: KILL_WINDOW_TIME_CONFIG
    });
    await postSnapshotAt(h, DISPUTER, anchorHeight);
    for (const index of PARTICIPANTS)
        await h.rpcStub.suppressTimeoutCheck(index);
    return {
        forkId: h.activeForkId!,
        disputerIndex: DISPUTER,
        auditorIndex: AUDITOR,
        participants: PARTICIPANTS
    };
}

/**
 * The disputer's dispute posted as one milestone: its real blocks
 * `fromHeight`..`headHeight`, then an unseen block above them by a
 * participant that is neither the next writer nor the auditor, committing a re-timed copy of the
 * head snapshot. The replay judges that block, the last of the run.
 */
export async function postedRunWithForgedTip(
    h: MathPeerTestHarness,
    stage: AnchorRaceStage,
    fromHeight: number,
    headHeight: number
) {
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        stage.disputerIndex
    );
    const heights = Array.from(
        { length: headHeight - fromHeight + 1 },
        (_, offset) => fromHeight + offset
    );
    const blocks = await Promise.all(
        heights.map((height) =>
            storedProofBlock(h, stage.disputerIndex, stage.forkId, height)
        )
    );
    const latest = forgedTimestamp(blocks.at(-1)!.snapshot);
    // the applied fraud proof slashes the unseen block's author: never the
    // honest auditor
    const { run, forged } = await withForgedTip(
        h,
        blocks.map(({ confirmation }) => confirmation),
        latest,
        stage.participants.filter((index) => index !== stage.auditorIndex)
    );
    const posted = await withChainFinalizedState(
        h,
        stage.disputerIndex,
        postedProof(dispute, auditingData, {
            milestones: [run],
            milestoneSnapshots: [blocks[0].snapshot],
            latestStateSnapshot: latest
        })
    );
    return { ...opening(posted), forged };
}

/**
 * The disputer's dispute posted as one milestone: its real block at
 * `baseHeight` (without its confirmation signatures when `stripBase`), then
 * `count` crafted blocks by `authorIndex`, each linked to the one before.
 * The last commits a re-timed copy of the base snapshot as the latest state;
 * the others commit random snapshots.
 */
export async function postedForgedRunFrom(
    h: MathPeerTestHarness,
    stage: AnchorRaceStage,
    options: {
        baseHeight: number;
        authorIndex: number;
        count: number;
        stripBase?: boolean;
    }
) {
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        stage.disputerIndex
    );
    const base = await storedProofBlock(
        h,
        stage.disputerIndex,
        stage.forkId,
        options.baseHeight
    );
    const latest = forgedTimestamp(base.snapshot);
    const run: BlockConfirmationStruct[] = [
        options.stripBase
            ? { signedBlock: base.confirmation.signedBlock, signatures: [] }
            : base.confirmation
    ];
    const forged: Block[] = [];
    let previous = Block.fromBlockConfirmation(base.confirmation);
    for (let offset = 1; offset <= options.count; offset++) {
        const crafted = await craftProofBlock(h, {
            authorIndex: options.authorIndex,
            forkId: stage.forkId,
            height: options.baseHeight + offset,
            previousBlockHash: previous.hash,
            ...(offset === options.count
                ? { stateSnapshotHash: StateSnapshot.from(latest).hash }
                : {})
        });
        run.push({ signedBlock: crafted.signedBlock, signatures: [] });
        forged.push(crafted.block);
        previous = crafted.block;
    }
    const posted = await withChainFinalizedState(
        h,
        stage.disputerIndex,
        postedProof(dispute, auditingData, {
            milestones: [run],
            milestoneSnapshots: [base.snapshot],
            latestStateSnapshot: latest
        })
    );
    return { ...opening(posted), forged };
}

/**
 * The disputer's dispute posted as one milestone of two crafted blocks by
 * the disputer: one at `height` on `startForkId`, linked to the real block
 * below and committing `startSnapshot`, then one on the dispute's fork linked
 * to it, committing a re-timed copy of `startSnapshot` as the latest state.
 */
export async function postedRunOverFinalPoint(
    h: MathPeerTestHarness,
    stage: Pick<AnchorRaceStage, "forkId" | "disputerIndex">,
    options: {
        height: number;
        startForkId: ForkId;
        startSnapshot: StateSnapshotStruct;
    }
) {
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        stage.disputerIndex
    );
    const below = await storedProofBlock(
        h,
        stage.disputerIndex,
        stage.forkId,
        options.height - 1
    );
    const start = await craftProofBlock(h, {
        authorIndex: stage.disputerIndex,
        forkId: options.startForkId,
        height: options.height,
        previousBlockHash: Block.fromBlockConfirmation(below.confirmation).hash,
        stateSnapshotHash: StateSnapshot.from(options.startSnapshot).hash
    });
    const latest = forgedTimestamp(options.startSnapshot);
    const tip = await craftProofBlock(h, {
        authorIndex: stage.disputerIndex,
        forkId: stage.forkId,
        height: options.height + 1,
        previousBlockHash: start.block.hash,
        stateSnapshotHash: StateSnapshot.from(latest).hash
    });
    const posted = postedProof(dispute, auditingData, {
        milestones: [
            [
                { signedBlock: start.signedBlock, signatures: [] },
                { signedBlock: tip.signedBlock, signatures: [] }
            ]
        ],
        milestoneSnapshots: [options.startSnapshot],
        latestStateSnapshot: latest
    });
    return opening(posted);
}

/**
 * The block allegation a stored `DisputeInvalidBlockInStateProofApplyFraudProof`
 * makes: its position in the last milestone and the hash of the block its
 * invalid-transition fraud proof convicts.
 */
export function blockAllegation(storedProof: StoredDisputeFraudProof): {
    blockIndex: number;
    convictedBlockHash: Hash;
} {
    const wrapper = Codec.decode(
        storedProof.encodedProof,
        DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
    );
    const { invalidBlock } = Codec.decode(
        wrapper.fraudProof.encodedProof,
        FraudProofType.BlockInvalidStateTransition
    );
    return {
        blockIndex: Number(wrapper.blockIndex),
        convictedBlockHash: keccakHash(String(invalidBlock.encodedBlock))
    };
}

/**
 * Upload `posted` as the disputer's own dispute, the struct the auditor
 * audited, with every peer's kill suppressed. Once the auditor audited it
 * (its kill skipped), the auditor's real `killDispute` sends its stored
 * dispute fraud proof. Returns that send, whether the dispute is still
 * committed and the chain's slashed participants.
 */
export async function commitAndKillAsAuditor(
    h: MathPeerTestHarness,
    stage: AnchorRaceStage,
    posted: PostedDispute
): Promise<{
    applies: RecordedFraudProofApply[];
    stillCommitted: boolean;
    slashed: string[];
}> {
    const kills = await Promise.all(
        h.peers.map((peer) => h.rpcStub.suppressDisputeKill(peer.index))
    );
    const committed = await h.tamper.postTamperedDispute(
        stage.disputerIndex,
        (dispute, _confirmation, auditingData) => {
            Object.assign(dispute, posted.dispute);
            Object.assign(auditingData!, posted.auditingData);
        }
    );
    await kills[stage.auditorIndex].waitUntilSkipped();
    await kills[stage.auditorIndex].restore();
    const recorded = await h.rpcStub.recordDisputeFraudProofApplies(
        stage.auditorIndex
    );
    await killStoredDisputeOnHost(h, stage.auditorIndex);
    const commitments = await h.channelManager.getWindowCommitments(
        h.channelId,
        committed.dispute.input.forkId
    );
    return {
        applies: await recorded.applies(),
        stillCommitted: commitments.includes(
            keccakHash(Codec.encode(committed.dispute, Type.Dispute))
        ),
        slashed: await h.query.onChainSlashedParticipants()
    };
}
