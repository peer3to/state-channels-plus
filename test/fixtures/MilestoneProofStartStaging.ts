// @spec-test-coverage-ignore: milestone proof-start staging exercised by the E2E-MilestoneProofStart declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { BlockOrigin } from "@/storage/QueueStorage";
import { DisputeFraudProofType } from "@/types/sol-enums";
import type { ForkId, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { hash as randomHash, hexString } from "@test/factory";
import { stageBlindPendingAuditor } from "@test/fixtures/DisputeAuditStaging";
import { readLocalFinalizedHeight } from "@test/fixtures/OlderDisputeStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import type { DisputeTamper } from "@test/harness/actions/DisputeTamperingActions";
import type { SnapshotDataStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type {
    BlockConfirmationStruct,
    MilestoneProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { expect } from "chai";

/** Four peers, a posted chain anchor and `blocksAboveAnchor` final blocks above it. */
export type ChainAnchorStaging = {
    forkId: ForkId;
    anchorHeight: number;
    latestHeight: number;
};

/**
 * Peers that know different final points of one fork. `newer`, `idle` and
 * `submitter` hold `finalHeight` (H) final; `earlier` holds H-1 and H but
 * knows only H-2 final, so its trusted start is below the hop at H-1.
 */
export type SplitStartStaging = ChainAnchorStaging & {
    /** H-1: authored by `newer`; `earlier` stores it with two signers */
    hopHeight: number;
    /** H: authored by `earlier`; final for every other peer */
    finalHeight: number;
    newer: number;
    earlier: number;
    /** the next writer after H; it never authors */
    idle: number;
    submitter: number;
    /** gives `earlier` its network confirmations back */
    restoreEarlierGossip: () => Promise<void>;
};

/** `disputeHash` is the dispute's window commitment */
export type PostedDispute = { dispute: DisputeStruct; disputeHash: string };

/**
 * Four peers author `transitionCount` blocks (default 2), post a chain anchor,
 * then author `blocksAboveAnchor` final blocks. No peer checks writer timeouts: the channel idles while a dispute
 * is posted on a peer's behalf, and a writer-timeout dispute must not race it.
 */
export async function stageChainAnchor(
    h: MathPeerTestHarness,
    blocksAboveAnchor: number,
    options: { transitionCount?: number } = {}
): Promise<ChainAnchorStaging> {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: options.transitionCount ?? 2
    });
    // Pin the anchor before authoring; mining and mirror delivery must not
    // consume the next writer's window.
    const forkId = h.activeForkId!;
    const publisher = h.getPeer(0);
    const [prepared] = await Promise.all([
        h
            .control(publisher)
            .transition.prepareUpdateSnapshotSameFork(forkId)
            .request(),
        ...h.peers.map((peer) => h.rpcStub.suppressTimeoutCheck(peer.index))
    ]);
    if (
        !prepared.canPost ||
        !prepared.encodedExpectedSnapshot ||
        !prepared.callData.length
    )
        throw new Error("The chain anchor must be postable");
    const anchor = StateSnapshot.from(
        Codec.decode(prepared.encodedExpectedSnapshot, Type.StateSnapshot)
    );
    await Promise.all([
        (async () => {
            const transaction =
                await publisher.p2pInstance.stateChannelManagerContract.multicall(
                    prepared.callData
                );
            await transaction.wait();
            await h.assert.snapshot.localSnapshotsChangedWait({
                expectedSnapshot: anchor
            });
        })(),
        blocksAboveAnchor > 0
            ? h.transition.advanceState({
                  count: blocksAboveAnchor,
                  waitForFinalization: true
              })
            : Promise.resolve()
    ]);
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const latestHeight = Number(
        await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request()
    );
    expect(
        latestHeight,
        "the anchor must be the final point the staged blocks build on"
    ).to.equal(anchor.blockHeight + blocksAboveAnchor);
    return { forkId, anchorHeight: anchor.blockHeight, latestHeight };
}

/**
 * Two final blocks above the chain anchor, then the hop H-1 and the head H
 * while `earlier` is deaf to gossip: it ingests H-1 with its author's
 * signature only and authors H itself. Every other peer then holds H final.
 */
export async function stageSplitStartAuditors(
    h: MathPeerTestHarness
): Promise<SplitStartStaging> {
    const anchored = await stageChainAnchor(h, 2);
    const { forkId } = anchored;
    const query = h.control(h.getPeer(0)).query;
    const participants = await query.getParticipants().request();
    const nextWriter = await query.getNextToWrite().request();
    const writerAt = (offset: number) => {
        const address =
            participants[
                (participants.indexOf(nextWriter) + offset) %
                    participants.length
            ];
        return h.peers.find((peer) => peer.address === address)!.index;
    };
    const newer = writerAt(0);
    const earlier = writerAt(1);
    const idle = writerAt(2);
    const submitter = writerAt(3);
    const others = [newer, idle, submitter];
    const hopHeight = anchored.latestHeight + 1;
    const finalHeight = hopHeight + 1;

    const restoreEarlierGossip =
        await h.rpcStub.dropNetworkConfirmations(earlier);
    await h.transition.advanceState({
        count: 1,
        waitForPeers: others,
        waitForFinalization: false
    });
    const hop = await getBlockConfirmation(h, newer, forkId, hopHeight);
    await h.transition.ingestBlockConfirmationWait({
        peerIndex: earlier,
        blockConfirmation: { signedBlock: hop.signedBlock, signatures: [] },
        ingestOptions: {
            origin: BlockOrigin.NETWORK,
            senderAddress: h.getPeer(newer).address
        },
        keepConnection: true
    });
    await h.transition.peerWrite({ peer: earlier, waitForPeers: others });
    // peersInSyncWait drops finalization for a peer subset: wait for H final
    // on the other peers directly
    await h.syncCoordinator.waitForPeersToSync(
        h.getFilteredPeers(others),
        forkId,
        {
            minHeight: finalHeight,
            waitForFinalization: true,
            timeoutMs: h.event.protocolEventTimeoutMs()
        }
    );

    // staging sanity: the trusted starts the audits will walk from
    for (const index of others)
        expect(
            await readLocalFinalizedHeight(h, index, forkId),
            `peer ${index} must know the head final`
        ).to.equal(finalHeight);
    expect(
        await readLocalFinalizedHeight(h, earlier, forkId),
        "the earlier-start auditor must know only the block below the hop final"
    ).to.equal(hopHeight - 1);

    return {
        ...anchored,
        hopHeight,
        finalHeight,
        newer,
        earlier,
        idle,
        submitter,
        restoreEarlierGossip
    };
}

/** The stored confirmation of `forkId:height` on `peerIndex`, with all its signatures. */
export async function getBlockConfirmation(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    height: number
): Promise<BlockConfirmationStruct> {
    const bundle = await h
        .control(h.getPeer(peerIndex))
        .query.getBlockByHeight(forkId, height)
        .request();
    expect(bundle, `peer ${peerIndex} must hold block ${height}`).to.not.equal(
        null
    );
    return Codec.decode(
        bundle!.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
}

/**
 * Malformed history below the chain anchor: an undecodable block, then a
 * forged block at the height just below the anchor, re-signed by its author.
 */
export async function buildBelowAnchorJunkMilestone(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    anchorHeight: number
): Promise<{
    milestone: MilestoneProofStruct;
    originalBlockHash: Hash;
    forgedBlockHash: Hash;
}> {
    const original = await h
        .control(h.getPeer(peerIndex))
        .query.getBlockByHeight(forkId, anchorHeight - 1)
        .request();
    expect(original, "a block below the anchor must exist").to.not.equal(null);
    const signedBlock = Codec.decode(
        original!.encodedSignedBlock,
        Type.SignedBlock
    );
    const author = h.peers.find((peer) => peer.address === original!.author)!;
    const forged = await Block.fromBlockStruct(
        {
            ...Codec.decode(signedBlock.encodedBlock, Type.Block),
            stateSnapshotHash: randomHash()
        },
        author.signer
    );
    return {
        milestone: {
            blockConfirmations: [
                {
                    signedBlock: {
                        encodedBlock: hexString(128),
                        signature: signedBlock.signature
                    },
                    signatures: []
                },
                forged.blockConfirmationStruct
            ]
        },
        originalBlockHash: original!.hash as Hash,
        forgedBlockHash: forged.hash
    };
}

/** The honest proof is one final milestone holding only the head at `height`. */
export function expectFinalHeadProof(
    dispute: DisputeStruct,
    height: number
): void {
    const milestones = dispute.input.stateProof.milestones;
    expect(milestones.length, "one final head milestone").to.equal(1);
    expect(milestones[0].blockConfirmations.length).to.equal(1);
    expect(blockHeightOf(milestones[0].blockConfirmations[0])).to.equal(height);
}

/** The honest proof is one milestone starting at the anchor block, `length` blocks long. */
export function expectAnchorRunProof(
    dispute: DisputeStruct,
    anchorHeight: number,
    length: number
): void {
    const milestones = dispute.input.stateProof.milestones;
    expect(milestones.length, "one milestone holding the anchor").to.equal(1);
    expect(milestones[0].blockConfirmations.length).to.equal(length);
    expect(blockHeightOf(milestones[0].blockConfirmations[0])).to.equal(
        anchorHeight
    );
}

/**
 * Posts a self-removal dispute of `leaverIndex` after `tamper`. The leaver's
 * runtime initiates nothing: the dispute is posted on its behalf. A
 * malicious leaver never kills its own dispute, so every kill is an
 * auditor's. A non-malicious leaver is recorded as leaving the channel.
 */
export async function postSelfRemovalDispute(
    h: MathPeerTestHarness,
    leaverIndex: number,
    tamper: DisputeTamper,
    options: { malicious: boolean }
): Promise<PostedDispute> {
    // the kill stub goes first: it wraps the dispute entry the initiation stub then replaces
    if (options.malicious) await h.rpcStub.suppressDisputeKill(leaverIndex);
    await h.dispute.suppressDisputeInitiation([leaverIndex]);
    await h
        .control(h.getPeer(leaverIndex))
        .dispute.setForceExit(true)
        .request();
    if (!options.malicious)
        h.context.leftChannelPeerIndices = [
            ...h.context.leftChannelPeerIndices,
            leaverIndex
        ];
    const { dispute } = await h.tamper.postTamperedDispute(
        leaverIndex,
        tamper,
        { markMalicious: options.malicious }
    );
    return {
        dispute,
        disputeHash: hash(Codec.encode(dispute, Type.Dispute))
    };
}

/**
 * The on-chain counter landed: the dispute was killed, its submitter is
 * slashed and its commitment left the window.
 */
export async function assertKilledOnChain(
    h: MathPeerTestHarness,
    options: {
        forkId: ForkId;
        submitter: number;
        disputeHash: string;
        observers: number[];
    }
): Promise<void> {
    await h.event.waitForPeers("onDisputeKilled", options.observers, 1, {
        mode: "atLeast"
    });
    await h.assert.dispute.slashedOnChain(
        h.getPeer(options.submitter).address,
        "the dispute submitter must be slashed by the kill"
    );
    const commitments = await h.channelManager.getWindowCommitments(
        h.channelId,
        options.forkId
    );
    expect(
        commitments.includes(options.disputeHash),
        "the killed dispute must leave the window"
    ).to.equal(false);
}

/**
 * Every listed auditor stores `counter` against the dispute, the kill
 * slashes the submitter, the chain's kill transaction is an auditor's
 * applying exactly `counter`, and the channel resolves without it.
 */
export async function assertCounterKills(
    h: MathPeerTestHarness,
    options: {
        counter: DisputeFraudProofType;
        forkId: ForkId;
        submitter: number;
        disputeHash: string;
        auditors: number[];
        /** on-chain participants with no harness peer (a forced joiner) */
        syntheticOnChainParticipants?: number;
    }
) {
    await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
        disputeFraudProofType: options.counter,
        peerIndices: options.auditors
    });
    await assertKilledOnChain(h, {
        ...options,
        observers: options.auditors
    });
    // the chain's kill: an auditor sent it, applying exactly this counter
    const kill = await readDisputeKill(h, h.getPeer(options.submitter).address);
    expect(
        options.auditors.map((index) => h.getPeer(index).address),
        "an auditor sent the kill"
    ).to.include(kill.killer);
    expect(kill.appliedProofTypes).to.deep.equal([options.counter]);
    await h.dispute.resolveDisputeWait({
        forkId: options.forkId,
        syntheticOnChainParticipants: options.syntheticOnChainParticipants
    });
    return kill;
}

/**
 * Every listed auditor accepts the dispute: each stores its confirmation and
 * no dispute fraud proof, the leaver is not slashed, and its self-removal
 * resolves the channel.
 */
export async function assertSelfRemovalAccepted(
    h: MathPeerTestHarness,
    options: {
        forkId: ForkId;
        leaver: number;
        disputeHash: string;
        auditors: number[];
    }
): Promise<void> {
    await h.assert.storage.storedDisputeConfirmationsWait({
        peerIndices: options.auditors,
        disputeHashes: [options.disputeHash]
    });
    for (const index of options.auditors)
        expect(
            await h
                .control(h.getPeer(index))
                .query.getDisputeFraudProofTypes()
                .request(),
            `auditor ${index} must store no counter`
        ).to.deep.equal([]);
    const slashed = await h.channelManager.getOnChainSlashedParticipants(
        h.channelId
    );
    expect(
        slashed.some(
            (address) => address === h.getPeer(options.leaver).address
        ),
        "the disputer must not be slashed"
    ).to.equal(false);
    await h.dispute.resolveDisputeWait({
        forkId: options.forkId,
        assertMaliciousRemoved: false,
        honestPeerIndices: options.auditors
    });
}

/** Every peer index but `peerIndex`. */
export function otherPeers(
    h: MathPeerTestHarness,
    peerIndex: number
): number[] {
    return h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== peerIndex);
}

/** A block confirmation whose block bytes do not decode, carrying `source`'s real author signature. */
export function undecodableConfirmation(
    source: BlockConfirmationStruct
): BlockConfirmationStruct {
    return {
        signedBlock: {
            encodedBlock: hexString(128),
            signature: source.signedBlock.signature
        },
        signatures: []
    };
}

/** `peerIndex`'s own proof through `height` and the auditing data DisputeManager builds for it. */
export async function buildOwnProof(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    height: number
): Promise<{
    stateProof: StateProofStruct;
    auditingData: DisputeAuditingDataStruct;
}> {
    const { encodedStateProof, encodedAuditingData } = await h
        .control(h.getPeer(peerIndex))
        .dispute.buildOwnAuditingData(forkId, height)
        .request();
    return {
        stateProof: Codec.decode(encodedStateProof, Type.StateProof),
        auditingData: Codec.decode(
            encodedAuditingData,
            Type.DisputeAuditingData
        )
    };
}

/**
 * Only the earlier-start auditor walks the invalid material: it stores the
 * invalid-state-proof counter from its evidence and kills the dispute on
 * chain without being slashed. The newer-start auditors accept the dispute
 * from their final head and store no counter.
 */
export async function assertEarlierStartAuditorKills(
    h: MathPeerTestHarness,
    staging: SplitStartStaging,
    posted: PostedDispute
): Promise<void> {
    const { forkId, earlier, newer, idle, submitter } = staging;
    await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
        disputeFraudProofType: DisputeFraudProofType.DisputeInvalidStateProof,
        peerIndices: [earlier]
    });
    await assertKilledOnChain(h, {
        forkId,
        submitter,
        disputeHash: posted.disputeHash,
        observers: [newer, idle]
    });
    // the chain's kill is the earlier-start auditor's invalid-state-proof counter
    const kill = await readDisputeKill(h, h.getPeer(submitter).address);
    expect(kill.killer).to.equal(h.getPeer(earlier).address);
    expect(kill.appliedProofTypes).to.deep.equal([
        DisputeFraudProofType.DisputeInvalidStateProof
    ]);
    // the chain accepted the earlier-start auditor's evidence: a forged
    // snapshot would have slashed the challenger instead
    const slashed = await h.channelManager.getOnChainSlashedParticipants(
        h.channelId
    );
    expect(
        slashed.some((address) => address === h.getPeer(earlier).address),
        "the earlier-start auditor must not be slashed"
    ).to.equal(false);

    await h.assert.storage.storedDisputeConfirmationsWait({
        peerIndices: [newer, idle],
        disputeHashes: [posted.disputeHash]
    });
    for (const index of [newer, idle])
        expect(
            await h
                .control(h.getPeer(index))
                .query.getDisputeFraudProofTypes()
                .request(),
            `newer-start auditor ${index} must store no counter`
        ).to.deep.equal([]);

    await staging.restoreEarlierGossip();
    await h.dispute.resolveDisputeWait({ forkId });
}

/** A pending forced joiner that never signs, and a tail block above the final head known only to its author. */
export type OffWireTailStaging = {
    forkId: ForkId;
    /** the final head H: every harness peer signed it */
    headHeight: number;
    /** authored H+1 off the network; the dispute submitter */
    submitter: number;
    auditors: number[];
    /** a participant holding H final; default the first auditor */
    headHolder?: number;
    /** peers that never sign the colluders' forged head */
    outsideColluders?: number[];
};

/**
 * Four participants and a pending auditor that never finalized the head H
 * (`stageBlindPendingAuditor`): its JOIN is pending and it never signs, so no
 * dispute may omit its auditing data. No peer checks writer timeouts. The
 * next writer then authors H+1 off the network: its proof is the final head
 * H with the unfinalized tail H+1. The pending auditor is the only auditor;
 * `restoreGossip` gives it its block gossip back.
 */
export async function stageOffWireTailOverBlindPendingAuditor(
    h: MathPeerTestHarness
): Promise<OffWireTailStaging & { restoreGossip: () => Promise<void> }> {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const participants = [0, 1, 2, 3];
    const { auditorIndex, headHeight, restoreGossip } =
        await stageBlindPendingAuditor(h, participants);
    const { leader, startHeight } =
        await h.transition.authorNextBlockOffWireWait();
    expect(startHeight, "the tail must be the block after the head").to.equal(
        headHeight + 1
    );
    return {
        forkId: h.activeForkId!,
        headHeight,
        submitter: leader.index,
        auditors: [auditorIndex],
        headHolder: participants.find((index) => index !== leader.index)!,
        outsideColluders: [auditorIndex],
        restoreGossip
    };
}

/**
 * Collusion staging: the head H re-signed by every harness peer (but
 * `staging.outsideColluders`) with a
 * snapshot whose total withdrawals are one higher (the invariant fails
 * against the chain), and the submitter's real tail block re-signed by its
 * author on top of it. The tail's transaction, state and every other
 * snapshot field are its real ones: the snapshot assembly copies the total
 * withdrawals from the previous snapshot when a block emits no outbound
 * message, so the tail replays correctly from the forged head and keeps the
 * wrong total. Total deposits cannot carry the fault: a tail that consumes
 * the pending join takes them from the chain's inbound block.
 */
export async function buildTeleportedTail(
    h: MathPeerTestHarness,
    staging: OffWireTailStaging
): Promise<{
    head: { confirmation: BlockConfirmationStruct; snapshot: StateSnapshot };
    tail: { confirmation: BlockConfirmationStruct; snapshot: StateSnapshot };
}> {
    const breakWithdrawals = (
        data: SnapshotDataStruct
    ): SnapshotDataStruct => ({
        ...data,
        totalWithdrawals: {
            ...data.totalWithdrawals,
            amount: BigInt(data.totalWithdrawals.amount) + 1n
        }
    });
    // the head holder's latest block is the head; the submitter's is the tail
    const forged = await h.tamper.buildForgedSnapshot(
        staging.headHolder ?? staging.auditors[0]!,
        (ctx) => ({ snapshotData: breakWithdrawals(ctx.originalSnapshotData) }),
        { withoutSignerIndices: staging.outsideColluders }
    );
    expect(forged.forgedBlock.height).to.equal(staging.headHeight);

    const submitter = h.getPeer(staging.submitter);
    const bundle = await h
        .control(submitter)
        .query.getBlockByHeight(staging.forkId, staging.headHeight + 1)
        .request();
    expect(bundle, "the submitter must hold its tail block").to.not.equal(null);
    const realSnapshot = await h
        .control(submitter)
        .query.getStateSnapshotStructByHash(bundle!.stateSnapshotHash as Hash)
        .request();
    expect(
        realSnapshot,
        "the submitter must hold its tail snapshot"
    ).to.not.equal(null);
    const realTailSnapshot = Codec.decode(
        realSnapshot!.encodedSnapshot,
        Type.StateSnapshot
    );
    const tailSnapshot = StateSnapshot.from({
        ...realTailSnapshot,
        snapshotData: breakWithdrawals(realTailSnapshot.snapshotData)
    });
    const signedTail = Codec.decode(
        bundle!.encodedSignedBlock,
        Type.SignedBlock
    );
    const tailBlock = await Block.fromBlockStruct(
        {
            ...Codec.decode(signedTail.encodedBlock, Type.Block),
            previousBlockHash: forged.forgedBlock.hash,
            stateSnapshotHash: tailSnapshot.hash
        },
        submitter.signer
    );
    return {
        head: {
            confirmation: forged.forgedBlock.blockConfirmationStruct,
            snapshot: forged.forgedSnapshot
        },
        tail: {
            confirmation: tailBlock.blockConfirmationStruct,
            snapshot: tailSnapshot
        }
    };
}

/** The proof is the final head followed by its one-block unfinalized tail. */
export function expectHeadAndTailProof(
    dispute: DisputeStruct,
    headHeight: number
): void {
    const milestones = dispute.input.stateProof.milestones;
    expect(milestones.length, "one milestone: head and tail").to.equal(1);
    const run = milestones[0].blockConfirmations;
    expect(run.length).to.equal(2);
    expect(blockHeightOf(run[0])).to.equal(headHeight);
    expect(blockHeightOf(run[1])).to.equal(headHeight + 1);
}

function blockHeightOf(confirmation: BlockConfirmationStruct): number {
    return Number(
        Codec.decode(
            confirmation.signedBlock.encodedBlock as string,
            Type.Block
        ).transaction.header.transactionCnt
    );
}
