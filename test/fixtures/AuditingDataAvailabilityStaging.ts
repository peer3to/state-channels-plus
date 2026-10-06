// @spec-test-coverage-ignore: auditing-data availability staging shared by the E2E-AuditingDataAvailability cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import { Status } from "@/types";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { Address, ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { waitFor } from "@test/utils/waitFor";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";

export type AnchoredTailStaging = {
    forkId: ForkId;
    /** height of the block whose snapshot is the on-chain anchor */
    anchorHeight: number;
    /** participant that never receives the tail: it holds the anchor state only */
    blindParticipantIndex: number;
    /** pending participant (join on chain, held out of blocks) that never receives the tail */
    pendingJoinerIndex: number;
    /** connected participant that authored the tail; its invalid block opens the dispute */
    offenderIndex: number;
    /** connected honest participant that disputes the offender */
    disputerIndex: number;
};

/**
 * Three participants and a pending joiner. The anchor block is final by the
 * participants and posted on chain; then the joiner's join lands and is held
 * out of blocks, and one participant and the joiner stop receiving block
 * gossip. One tail block follows: the blind participant never signs it, so
 * the last milestone of an honest dispute starts at the anchor block. The
 * pending joiner is in the required on-chain set and signed nothing, so only
 * the anchor rule permits omitting the auditing data.
 */
export async function stageAnchoredUnfinalizedTail(
    h: MathPeerTestHarness
): Promise<AnchoredTailStaging> {
    // The snapshot post and the join (two transactions and the join's
    // confirmation round) sit in one writer window before the tail block.
    await h.lifecycle.start(3, 0, {
        timeConfig: {
            p2pTime: 4,
            agreementTime: 4,
            chainFallbackTime: 4,
            evidenceTime: 8
        }
    });
    const { peer: joiner } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 2,
        maximumBlocks: 18
    });
    await h.assert.sync.peersInSyncWait();
    const forkId = h.activeForkId!;
    const participantIndices = [0, 1, 2];

    // Install independent controls before the anchor starts the tail's window.
    await Promise.all(
        participantIndices.map((index) =>
            h.byzantine.stubPendingInboundInclusion(index)
        )
    );

    // the anchor block: every participant signs it, and the synced joiner sees it final
    await h.transition.advanceState({ count: 1 });
    const anchorHeight = await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(forkId)
        .request();
    if (anchorHeight === null) throw new Error("No anchor block");
    const anchor = await h.transition.postSnapshotWait();
    if (!anchor || Number(anchor.blockHeight) !== anchorHeight)
        throw new Error(
            `Expected the chain anchor at height ${anchorHeight}, got ${anchor?.blockHeight}`
        );

    const forceJoin = await h.join.prepareForceInboundJoinWait({
        participant: joiner.address
    });
    await h.join.submitPreparedForceInboundJoinWait(forceJoin);
    const joinerStatus = await h.control(joiner).query.getStatus().request();
    if (joinerStatus !== Status.PENDING_PARTICIPANT)
        throw new Error(
            `Expected the joiner to be PENDING_PARTICIPANT, got ${Status[joinerStatus]}`
        );

    const offender = await h.query.getNextPeerToWrite();
    const blindParticipantIndex = participantIndices.find(
        (index) => index !== offender.index
    )!;
    const disputerIndex = participantIndices.find(
        (index) => index !== offender.index && index !== blindParticipantIndex
    )!;
    // the blind peers only audit: their own (older) disputes are not part of the case
    await Promise.all([
        h.dispute.suppressDisputeInitiation([blindParticipantIndex]),
        h.dispute.suppressDisputeInitiation([joiner.index]),
        h.rpcStub.dropNetworkConfirmations(blindParticipantIndex),
        h.rpcStub.dropNetworkConfirmations(joiner.index)
    ]);

    // the tail: the blind participant never signs it
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [offender.index, disputerIndex]
    });

    return {
        forkId,
        anchorHeight,
        blindParticipantIndex,
        pendingJoinerIndex: joiner.index,
        offenderIndex: offender.index,
        disputerIndex
    };
}

export type EveryoneFinalHeadStaging = {
    forkId: ForkId;
    /** height of the head H every participant and the pending joiner signed */
    headHeight: number;
    /** participant that holds H final but never receives the tail */
    blindParticipantIndex: number;
    /** joiner pending on chain (its join consumed off chain only) that holds H final but never receives the tail */
    pendingJoinerIndex: number;
    /** authored the tail H+1; its next block is the offender's */
    disputerIndex: number;
    /** next writer after the tail; its invalid block opens the dispute */
    offenderIndex: number;
};

/**
 * Three participants and a joiner pending on chain whose join is consumed
 * off chain, so it signs as a participant and is in the required on-chain
 * set. Every one of them signs the head H. Then a participant and the joiner
 * stop receiving block gossip and the tail H+1 follows: an honest dispute's
 * last milestone is H (everyone-final, above the chain anchor) plus the tail,
 * so it may omit its auditing data, and the two blind auditors must replay
 * the tail from H themselves.
 */
export async function stageEveryoneFinalHeadWithBlindAuditors(
    h: MathPeerTestHarness
): Promise<EveryoneFinalHeadStaging> {
    const joiner = await h.scenario.spectatorPromotedViaJoinChannelWait({
        initialPeers: 3
    });
    const forkId = h.activeForkId!;
    const query = h.control(h.getPeer(0)).query;
    const participants = await query.getParticipants().request();
    expect(participants).to.include(joiner.address);
    const indexOf = (address: string) =>
        h.peers.find((peer) => peer.address === address)!.index;
    // the tail author and the offender after it must both see every block
    const writersAfterNext = async () => {
        const next = await query.getNextToWrite().request();
        const position = participants.indexOf(next);
        return [next, participants[(position + 1) % participants.length]].map(
            indexOf
        );
    };
    let [disputerIndex, offenderIndex] = await writersAfterNext();
    for (
        let block = 0;
        block < participants.length &&
        [disputerIndex, offenderIndex].includes(joiner.index);
        block++
    ) {
        await h.transition.advanceState({
            count: 1,
            waitForFinalization: true
        });
        [disputerIndex, offenderIndex] = await writersAfterNext();
    }
    expect([disputerIndex, offenderIndex]).to.not.include(joiner.index);
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const headHeight = Number(
        await query.getLatestBlockHeight(forkId).request()
    );
    const blindParticipantIndex = [0, 1, 2].find(
        (index) => index !== disputerIndex && index !== offenderIndex
    )!;

    // the blind peers only audit: their own disputes are not part of the case
    await h.dispute.suppressDisputeInitiation([
        blindParticipantIndex,
        joiner.index
    ]);
    await h.rpcStub.dropNetworkConfirmations(blindParticipantIndex);
    await h.rpcStub.dropNetworkConfirmations(joiner.index);
    // the tail: the blind peers never receive or sign it
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [disputerIndex, offenderIndex]
    });

    return {
        forkId,
        headHeight,
        blindParticipantIndex,
        pendingJoinerIndex: joiner.index,
        disputerIndex,
        offenderIndex
    };
}

/**
 * Make `disputerIndex`'s next dispute omit its auditing data and also commit
 * a random latest-state hash: a fault the latest-state check after the
 * availability check would find.
 */
export async function stubOmittedDataWithLaterFault(
    h: MathPeerTestHarness,
    disputerIndex: number
): Promise<void> {
    await h.tamper.stubConstructDispute(disputerIndex, (dispute, sm) => {
        dispute.postedAuditingData = false;
        dispute.input.latestStateSnapshotHash =
            sm.p2pManager.localRpc.dispute.randomHash();
    });
}

/** The last dispute `peerIndex` initiated, with its hash. */
export function lastInitiatedDispute(
    h: MathPeerTestHarness,
    peerIndex: number
): { disputeHash: Hash; dispute: DisputeStruct } {
    const spy = h.getPeer(peerIndex).eventSpies.onInitiatingDispute;
    if (!spy?.lastCall)
        throw new Error(`Peer ${peerIndex} initiated no dispute`);
    return {
        disputeHash: spy.lastCall.args[0] as Hash,
        dispute: spy.lastCall.args[1] as DisputeStruct
    };
}

/** Heights of the first and the last block of the dispute's last milestone. */
export function lastMilestoneHeights(dispute: DisputeStruct): {
    first: number;
    last: number;
} {
    const run = dispute.input.stateProof.milestones.at(-1)?.blockConfirmations;
    if (!run?.length) throw new Error("The dispute has no last milestone");
    const height = (index: number) =>
        Number(
            Codec.decode(run[index].signedBlock.encodedBlock, Type.Block)
                .transaction.header.transactionCnt
        );
    return { first: height(0), last: height(run.length - 1) };
}

/** Signers of the first block of the dispute's last milestone. */
export function lastMilestoneFirstBlockSigners(
    dispute: DisputeStruct
): Address[] {
    const confirmation =
        dispute.input.stateProof.milestones.at(-1)?.blockConfirmations[0];
    if (!confirmation) throw new Error("The dispute has no last milestone");
    return [...Block.fromBlockConfirmation(confirmation).allSignerAddresses];
}

/**
 * Wait until `auditorIndex` stored the dispute's confirmation: a committed
 * participant stores it only after its audit returned valid.
 */
export async function waitUntilAuditAccepted(
    h: MathPeerTestHarness,
    auditorIndex: number,
    disputeHash: Hash
): Promise<void> {
    const auditor = h.getPeer(auditorIndex);
    await waitFor(
        () =>
            h
                .control(auditor)
                .query.hasDisputeConfirmation(disputeHash)
                .request(),
        h.event.protocolEventTimeoutMs({ withFirstBlockGrace: true })
    );
}

/** Whether `peerIndex` holds the dispute's latest snapshot and its full state. */
export async function holdsDisputeLatestState(
    h: MathPeerTestHarness,
    peerIndex: number,
    dispute: DisputeStruct
): Promise<boolean> {
    const query = h.control(h.getPeer(peerIndex)).query;
    const snapshot = await query
        .getStateSnapshotStructByHash(
            dispute.input.latestStateSnapshotHash as Hash
        )
        .request();
    if (!snapshot) return false;
    const stateHash = Codec.decode(snapshot.encodedSnapshot, Type.StateSnapshot)
        .snapshotData.stateMachineStateHash as Hash;
    return (await query.getStateMachineState(stateHash).request()) !== null;
}

/**
 * The dispute omitted its auditing data and only the anchor rule permits
 * that: its last milestone starts at or before the chain anchor and runs
 * past it, while the pending joiner is in the required on-chain set (its
 * join is pending on chain and inside the dispute's inbound head) and did
 * not sign the milestone's first block.
 */
export async function expectAnchorRuleAloneAllowsOmission(
    h: MathPeerTestHarness,
    staging: AnchoredTailStaging,
    dispute: DisputeStruct
): Promise<void> {
    expect(dispute.postedAuditingData).to.equal(false);
    const chainAnchor = await h.channelManager.getStateSnapshot(h.channelId);
    expect(Number(chainAnchor.blockHeight)).to.equal(staging.anchorHeight);
    const { first, last } = lastMilestoneHeights(dispute);
    expect(first).to.be.at.most(staging.anchorHeight);
    expect(last).to.be.greaterThan(staging.anchorHeight);

    const joinerAddress = h.getPeer(staging.pendingJoinerIndex).address;
    const pending = [
        ...(await h.channelManager.getPendingParticipants(h.channelId))
    ];
    expect(pending).to.include(joinerAddress);
    expect(dispute.input.latestInboundMessageBlockHash).to.equal(
        await h
            .control(h.getPeer(staging.disputerIndex))
            .query.getLatestInboundMessageHash()
            .request()
    );
    expect(lastMilestoneFirstBlockSigners(dispute)).to.not.include(
        joinerAddress
    );
}

/**
 * Each auditor stored the availability counter and not the invalid-state-proof
 * counter the later latest-state check would have built.
 */
export async function expectOnlyAvailabilityCounter(
    h: MathPeerTestHarness,
    auditorIndices: number[]
): Promise<void> {
    await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
        disputeFraudProofType:
            DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
        peerIndices: auditorIndices
    });
    const laterCounter = String(
        toSolidityDisputeFraudProofType(
            DisputeFraudProofType.DisputeInvalidStateProof
        )
    );
    for (const auditorIndex of auditorIndices) {
        const types = await h
            .control(h.getPeer(auditorIndex))
            .query.getDisputeFraudProofTypes()
            .request();
        expect(
            types,
            `Peer ${auditorIndex} audited past the availability check`
        ).to.not.include(laterCounter);
    }
}

/**
 * The chain's kill of `disputerIndex`'s dispute: one of `auditorIndices`
 * sent it, applying only the availability counter.
 */
export async function expectAvailabilityKillOnChain(
    h: MathPeerTestHarness,
    disputerIndex: number,
    auditorIndices: number[]
): Promise<void> {
    const kill = await readDisputeKill(h, h.getPeer(disputerIndex).address);
    expect(
        auditorIndices.map((index) => h.getPeer(index).address),
        "an auditor sent the kill"
    ).to.include(kill.killer);
    expect(kill.appliedProofTypes).to.deep.equal([
        DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
    ]);
}
