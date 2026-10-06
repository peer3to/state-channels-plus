// @spec-test-coverage-ignore: anchor-counter and block-challenge-boundary staging shared by mapped dispute-validation cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityDisputeFraudProofType,
    toSolidityFraudProofType
} from "@/types/sol-enums";
import type { Address, ForkId } from "@/types/types";
import { Codec, Type, hash } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import type {
    BlockConfirmationStruct,
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type {
    DisputeFraudProofStruct,
    FraudProofStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { expect } from "chai";
import { Signer, Wallet } from "ethers";

/**
 * Anchored tail staging (`stageAnchorBeforeUnfinalizedTail`): blocks 0..2
 * final, the chain anchor at block 2, then blocks 3 and 4 that peer 2 (offline)
 * never signs. Peer 3 submits the dispute.
 */
export const ANCHORED_TAIL = {
    anchorHeight: 2,
    offlineIndex: 2,
    submitterIndex: 3,
    onlineIndices: [0, 1, 3]
} as const;

/**
 * Lagging auditor staging (`stageLaggingAuditorBelowChainAnchor`): peer 2's
 * local diamond never applies the snapshot post and it never receives another
 * peer's block or signature after block 1, so its own final point is block 1,
 * its mirror anchor is the genesis, and the chain anchor is block 2 (its own
 * block, whose full state it holds).
 */
export const LAGGING_AUDITOR = {
    anchorHeight: 2,
    laggingIndex: 2,
    currentIndices: [0, 1, 3]
} as const;

/** One dispute fraud proof a challenger sends: its type and encoded proof. */
export type BlockChallenge = {
    proofType: DisputeFraudProofType;
    encodedProof: DisputeFraudProofStruct["encodedProof"];
};

/** The block-specific counters whose proof names a last-milestone position. */
export type BlockChallengeType =
    | DisputeFraudProofType.DisputeInvalidBlockStructure
    | DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
    | DisputeFraudProofType.DisputeBlockAuthorNotParticipant;

/** Every participant of the channel suppresses its writer-timeout dispute. */
async function suppressWriterTimeouts(
    h: MathPeerTestHarness,
    peerCount: number
) {
    for (let index = 0; index < peerCount; index++)
        await h.rpcStub.suppressTimeoutCheck(index);
}

function markStaged(h: MathPeerTestHarness): ForkId {
    h.event.resetEventSpies();
    h.contextApi.captureOriginalFork();
    return h.activeForkId!;
}

/**
 * Four peers; blocks 0..2 final on every peer. Publish their snapshot while
 * peer 2 goes offline and blocks 3 and 4 stay unfinalized. Before returning,
 * the chain and every mirror anchor at block 2. Peer 3's own proof is the
 * anchor-holding run [2, 3, 4].
 */
export async function stageAnchorBeforeUnfinalizedTail(
    h: MathPeerTestHarness
): Promise<ForkId> {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    await suppressWriterTimeouts(h, 4);
    await h.transition.advanceState({ count: 3 });
    // The tail cannot finalize with peer 2 offline, so publication still pins
    // block 2. Neither estimation nor mining may idle the next author.
    const [posted] = await Promise.all([
        h.transition.postSameForkSnapshotOnlyWait(),
        (async () => {
            await h.network.blacklistAndDisconnectPeer(
                ANCHORED_TAIL.offlineIndex
            );
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [...ANCHORED_TAIL.onlineIndices]
            });
        })()
    ]);
    const anchor = posted?.snapshot;
    expect(anchor?.blockHeight, "the anchor must be block 2").to.equal(
        ANCHORED_TAIL.anchorHeight
    );
    await h.assert.snapshot.localSnapshotsChangedWait({
        expectedSnapshot: anchor
    });
    return markStaged(h);
}

/**
 * Four peers, no snapshot post (the genesis anchor). `finalizedZero`: block 0
 * is final on every peer before peer 2 goes offline, so the proof's last
 * milestone [0, 1] proves zero by threshold. Otherwise peer 2 is offline from
 * the start and [0, 1] is an unfinalized genesis run.
 */
export async function stageGenesisAnchorZeroRun(
    h: MathPeerTestHarness,
    options: { finalizedZero: boolean }
): Promise<ForkId> {
    if (!options.finalizedZero) {
        await h.scenario.preDisputeSetupDisconnectedPeer();
        await suppressWriterTimeouts(h, 4);
        return markStaged(h);
    }
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    await suppressWriterTimeouts(h, 4);
    await h.transition.advanceState({ count: 1 });
    await h.network.blacklistAndDisconnectPeer(2);
    await h.transition.advanceState({ count: 1, waitForPeers: [0, 1, 3] });
    return markStaged(h);
}

/**
 * Four peers; block 0 final on every peer and its resulting snapshot posted:
 * the chain anchor is block zero's snapshot (height zero, not the genesis).
 */
export async function stageBlockZeroAnchor(
    h: MathPeerTestHarness
): Promise<ForkId> {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    await suppressWriterTimeouts(h, 4);
    await h.transition.advanceState({ count: 1 });
    const anchor = await h.transition.postSnapshotWait();
    expect(anchor?.blockHeight, "the anchor must be block zero").to.equal(0);
    return markStaged(h);
}

/**
 * Three peers. Peer 1 constructs its self-removal dispute at the genesis (an
 * empty proof), then block 0 becomes final on every peer and its resulting
 * snapshot is posted. With `laggingIndex` that peer's mirror never applies
 * the post. The stale construction is returned unsent.
 */
export async function stageStaleGenesisClaim(
    h: MathPeerTestHarness,
    options: { laggingIndex?: number } = {}
) {
    await h.scenario.preDisputeSetup({
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    await suppressWriterTimeouts(h, 3);
    const forkId = h.activeForkId!;
    await h.control(h.getPeer(1)).dispute.setForceExit(true).request();
    const stale = await h.dispute.fetchConstructedDispute(1);
    expect(
        stale.dispute.input.stateProof.milestones,
        "the genesis claim has an empty proof"
    ).to.deep.equal([]);
    expect(stale.dispute.postedAuditingData).to.equal(false);
    const mirror =
        options.laggingIndex === undefined
            ? undefined
            : await holdMirrorSnapshotUpdates(h, options.laggingIndex);
    await h.transition.advanceState({ count: 1 });
    const anchor = mirror
        ? await postSnapshotPastLaggingMirror(h)
        : await h.transition.postSnapshotWait();
    if (!anchor) throw new Error("the block-zero snapshot post must land");
    const genesisHash = await h
        .control(h.getPeer(0))
        .query.getGenesisSnapshotHash(forkId)
        .request();
    expect(anchor.blockHeight, "the anchor must be block zero").to.equal(0);
    expect(
        anchor.hash,
        "block zero's snapshot is not the genesis"
    ).to.not.equal(genesisHash);
    if (mirror)
        expect(
            await mirror.heldCount(),
            "the lagging mirror must have missed the snapshot post"
        ).to.be.greaterThan(0);
    return { forkId: markStaged(h), stale, genesisHash };
}

/**
 * The peer's local diamond stops applying StateSnapshotUpdated logs for the
 * rest of the test (its event handler, storage and ingest keep running), so
 * its mirror anchor lags the chain. `heldCount` counts the skipped logs.
 */
export async function holdMirrorSnapshotUpdates(
    h: MathPeerTestHarness,
    peerIndex: number
) {
    const peer = h.getPeer(peerIndex);
    await h.execOnHost(peer, (sm) => {
        const held = { count: 0 };
        Object.defineProperty(
            sm.diamondStateMachine.localDiamondContract,
            "onStateSnapshotUpdated",
            {
                value: Object.assign(
                    async () => {
                        held.count++;
                    },
                    { held }
                ),
                configurable: true,
                writable: true
            }
        );
        return true;
    });
    return {
        heldCount: () =>
            h.execOnHost(
                peer,
                (sm) =>
                    (
                        Reflect.get(
                            sm.diamondStateMachine.localDiamondContract
                                .onStateSnapshotUpdated,
                            "held"
                        ) as { count: number }
                    ).count
            )
    };
}

/**
 * Peer 0 posts the latest finalized snapshot; every peer handles the chain
 * event, also one whose mirror holds snapshot updates.
 */
export async function postSnapshotPastLaggingMirror(
    h: MathPeerTestHarness
): Promise<StateSnapshot> {
    const posted = await h.transition.postSameForkSnapshotOnlyWait({
        peerIndex: 0
    });
    if (!posted) throw new Error("the snapshot post must land");
    await h.event.waitForPeers(
        "onStateSnapshotUpdated",
        h.peers.map((peer) => peer.index),
        1,
        { mode: "atLeast" }
    );
    return posted.snapshot;
}

/**
 * Four peers. Blocks 0 and 1 are final on every peer. Then peer 2's mirror
 * holds snapshot updates and it stops receiving gossip: it authors block 2,
 * the others sign it (final for them, not for peer 2), and peer 0 posts its
 * snapshot. `tailBlocks` 1 adds block 3 (peer 3), which peer 2 never sees.
 */
export async function stageLaggingAuditorBelowChainAnchor(
    h: MathPeerTestHarness,
    options: { tailBlocks: 0 | 1 }
) {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    await suppressWriterTimeouts(h, 4);
    await h.transition.advanceState({ count: 2 });
    const mirror = await holdMirrorSnapshotUpdates(
        h,
        LAGGING_AUDITOR.laggingIndex
    );
    await h.rpcStub.dropNetworkConfirmations(LAGGING_AUDITOR.laggingIndex);
    await h.transition.advanceState({
        count: 1,
        waitForPeers: [...LAGGING_AUDITOR.currentIndices],
        waitForFinalization: true
    });
    const anchor = await postSnapshotPastLaggingMirror(h);
    expect(anchor.blockHeight, "the chain anchor must be block 2").to.equal(
        LAGGING_AUDITOR.anchorHeight
    );
    expect(
        await mirror.heldCount(),
        "the lagging mirror must have missed the snapshot post"
    ).to.be.greaterThan(0);
    if (options.tailBlocks === 1)
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [...LAGGING_AUDITOR.currentIndices]
        });
    return { forkId: markStaged(h) };
}

/**
 * Three participants and a synced spectator (peer 3). The snapshot of the
 * latest final block is posted, then peer 3 joins by force (pending), so it
 * never signed that anchor. Returns peer 0's own proof and auditing data that
 * end one block below the anchor, built while the anchor was the genesis.
 */
export async function stagePendingJoinerAfterAnchor(h: MathPeerTestHarness) {
    await h.scenario.preDisputeSetup({
        peerCount: 3,
        transitionCount: 0,
        timeConfig: { evidenceTime: 12 }
    });
    const { peer: joiner } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1, 2],
        minimumBlocks: 2,
        maximumBlocks: 20,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait();
    const forkId = h.activeForkId!;
    const latestHeight = await h
        .control(h.getPeer(0))
        .query.getLatestBlockHeight(forkId)
        .request();
    if (latestHeight === null) throw new Error("expected authored blocks");
    const { encodedStateProof, encodedAuditingData } = await h
        .control(h.getPeer(0))
        .dispute.buildOwnAuditingData(forkId, latestHeight - 1)
        .request();
    await suppressWriterTimeouts(h, 3);
    const anchor = await h.transition.postSnapshotWait();
    expect(
        anchor?.blockHeight,
        "the anchor must be the latest final block"
    ).to.equal(latestHeight);
    await h.join.forceInboundJoinWait({ participant: joiner.address });
    return {
        forkId: markStaged(h),
        joiner,
        anchorHeight: latestHeight,
        belowAnchor: {
            stateProof: Codec.decode(encodedStateProof, Type.StateProof),
            auditingData: Codec.decode(
                encodedAuditingData,
                Type.DisputeAuditingData
            )
        }
    };
}

// ===== proof edits (harness side, inside postTamperedDispute) =====

function signerOf(h: MathPeerTestHarness, address: Address): Signer {
    const peer = h.peers.find((candidate) => candidate.address === address);
    if (!peer) throw new Error(`no harness signer for ${address}`);
    return peer.signer;
}

/** The blocks of the dispute's last milestone. */
export function lastRun(dispute: DisputeStruct): BlockConfirmationStruct[] {
    const milestone = dispute.input.stateProof.milestones.at(-1);
    if (!milestone) throw new Error("the dispute has no milestone");
    return milestone.blockConfirmations;
}

/** Heights of the dispute's last milestone, in order. */
function lastRunHeights(dispute: DisputeStruct): number[] {
    return lastRun(dispute).map(
        (confirmation) => Block.fromBlockConfirmation(confirmation).height
    );
}

/** The last milestone holds exactly the blocks at `heights`. */
export function expectLastRunHeights(
    dispute: DisputeStruct,
    heights: number[]
): void {
    expect(lastRunHeights(dispute), "last-milestone heights").to.deep.equal(
        heights
    );
}

/**
 * Puts the observer's stored blocks at `heights` in front of the last
 * milestone, so the anchor lies inside it.
 */
export async function prependStoredBlocks(
    h: MathPeerTestHarness,
    dispute: DisputeStruct,
    heights: number[],
    observerIndex = 0
): Promise<void> {
    const prefix: BlockConfirmationStruct[] = [];
    for (const height of heights) {
        const bundle = await h
            .control(h.getPeer(observerIndex))
            .query.getBlockByHeight(dispute.input.forkId as ForkId, height)
            .request();
        if (!bundle) throw new Error(`observer lacks block ${height}`);
        prefix.push(
            Codec.decode(
                bundle.encodedBlockConfirmation,
                Type.BlockConfirmation
            )
        );
    }
    lastRun(dispute).unshift(...prefix);
}

/**
 * Re-issues the last milestone's block at `index` after `edit`: signed by
 * its author, and again by every peer that confirmed the original.
 */
export async function reissueBlock(
    h: MathPeerTestHarness,
    dispute: DisputeStruct,
    index: number,
    edit: (block: BlockStruct) => BlockStruct
): Promise<void> {
    const run = lastRun(dispute);
    const original = Block.fromBlockConfirmation(run[index]);
    const struct = edit(
        Codec.decode(run[index].signedBlock.encodedBlock, Type.Block)
    );
    const author = struct.transaction.header.participant;
    const block = await Block.fromBlockStruct(struct, signerOf(h, author));
    const confirmers = [...original.confirmationSignerAddresses].filter(
        (address) => address !== author
    );
    block.expandSignatures(
        await Promise.all(
            confirmers.map((address) => block.sign(signerOf(h, address)))
        )
    );
    run[index] = block.blockConfirmationStruct;
}

/** A different transaction body: the block no longer yields its committed state. */
export function withForgedBody(block: BlockStruct): BlockStruct {
    return {
        ...block,
        transaction: {
            ...block.transaction,
            body: { ...block.transaction.body, data: "0x" }
        }
    };
}

/** The block after the last one of the run, linked to it, committing the same snapshot. */
function nextBlockStruct(dispute: DisputeStruct): BlockStruct {
    const previous = lastRun(dispute).at(-1)!;
    const block = Codec.decode(previous.signedBlock.encodedBlock, Type.Block);
    block.transaction.header.transactionCnt =
        BigInt(block.transaction.header.transactionCnt) + 1n;
    block.transaction.header.timestamp =
        BigInt(block.transaction.header.timestamp) + 1n;
    block.previousBlockHash = hash(previous.signedBlock.encodedBlock);
    return block;
}

/**
 * Appends a block whose transaction does not yield the snapshot it commits,
 * authored by `authorIndex`; `confirmerIndices` sign it too.
 */
export async function appendInvalidTransition(
    h: MathPeerTestHarness,
    dispute: DisputeStruct,
    authorIndex: number,
    confirmerIndices: number[] = []
): Promise<void> {
    const author = h.getPeer(authorIndex);
    const struct = withForgedBody(nextBlockStruct(dispute));
    struct.transaction.header.participant = author.address;
    const block = await Block.fromBlockStruct(struct, author.signer);
    block.expandSignatures(
        await Promise.all(
            confirmerIndices.map((index) => block.sign(h.getPeer(index).signer))
        )
    );
    lastRun(dispute).push(block.blockConfirmationStruct);
}

/** Appends a block naming `authorIndex` as its author but signed by `signerIndex`. */
export async function appendNonAuthenticBlock(
    h: MathPeerTestHarness,
    dispute: DisputeStruct,
    authorIndex: number,
    signerIndex: number
): Promise<void> {
    const struct = nextBlockStruct(dispute);
    struct.transaction.header.participant = h.getPeer(authorIndex).address;
    const block = await Block.fromBlockStruct(
        struct,
        h.getPeer(signerIndex).signer
    );
    lastRun(dispute).push(block.blockConfirmationStruct);
}

/** Appends a block authored and signed by a wallet that is no participant. */
export async function appendOutsiderBlock(
    dispute: DisputeStruct
): Promise<string> {
    const outsider = Wallet.createRandom();
    const struct = nextBlockStruct(dispute);
    struct.transaction.header.participant = outsider.address;
    const block = await Block.fromBlockStruct(struct, outsider);
    lastRun(dispute).push(block.blockConfirmationStruct);
    return outsider.address;
}

/** Adds the signatures of `signerIndices` to the last milestone's block at `index`. */
export async function addConfirmations(
    h: MathPeerTestHarness,
    dispute: DisputeStruct,
    index: number,
    signerIndices: number[]
): Promise<void> {
    const run = lastRun(dispute);
    const block = Block.fromBlockConfirmation(run[index]);
    block.expandSignatures(
        await Promise.all(
            signerIndices.map((signer) => block.sign(h.getPeer(signer).signer))
        )
    );
    run[index] = block.blockConfirmationStruct;
}

/** The last milestone's block at `index` carries `signerIndex`'s signature as its author signature. */
export async function replaceAuthorSignature(
    h: MathPeerTestHarness,
    dispute: DisputeStruct,
    index: number,
    signerIndex: number
): Promise<void> {
    const run = lastRun(dispute);
    const block = Block.fromBlockConfirmation(run[index]);
    run[index] = {
        signedBlock: await block.signBlock(h.getPeer(signerIndex).signer),
        signatures: run[index].signatures
    };
}

/** The dispute now carries `auditingData` on chain. */
export function postAuditingData(
    dispute: DisputeStruct,
    auditingData: DisputeAuditingDataStruct
): void {
    dispute.postedAuditingData = true;
    dispute.input.disputeAuditingDataHash = hash(
        Codec.encode(auditingData, Type.DisputeAuditingData)
    );
}

// ===== dispute upload and on-chain challenge =====

/**
 * `submitterIndex` uploads its own self-removal dispute (a valid reason)
 * after `edit` changed its proof. `markMalicious` false for a correct
 * dispute.
 */
export async function uploadSelfRemovalDispute(
    h: MathPeerTestHarness,
    submitterIndex: number,
    edit: (
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ) => Promise<void>,
    options: { markMalicious: boolean }
): Promise<DisputeStruct> {
    await h
        .control(h.getPeer(submitterIndex))
        .dispute.setForceExit(true)
        .request();
    const { dispute } = await h.tamper.postTamperedDispute(
        submitterIndex,
        async (dispute, _confirmation, auditingData) => {
            if (!auditingData) throw new Error("expected auditing data");
            await edit(dispute, auditingData);
        },
        { markMalicious: options.markMalicious }
    );
    return dispute;
}

/** `peerIndex` uploads its earlier, unchanged dispute construction. */
export async function uploadStaleDispute(
    h: MathPeerTestHarness,
    peerIndex: number,
    stale: { disputeConfirmation: DisputeConfirmationStruct }
): Promise<void> {
    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: peerIndex });
    const tx = await h
        .getPeer(peerIndex)
        .p2pInstance.stateChannelManagerContract.uploadDispute(
            stale.disputeConfirmation
        );
    await tx.wait();
}

/**
 * `joinerIndex` uploads its own dispute with the proof, latest state and
 * posted auditing data of `belowAnchor` instead of its own.
 */
export async function uploadBelowAnchorClaim(
    h: MathPeerTestHarness,
    joinerIndex: number,
    belowAnchor: {
        stateProof: StateProofStruct;
        auditingData: DisputeAuditingDataStruct;
    }
): Promise<DisputeStruct> {
    const { dispute } = await h.tamper.postTamperedDispute(
        joinerIndex,
        (dispute, _confirmation, auditingData) => {
            if (!auditingData) throw new Error("expected auditing data");
            dispute.input.stateProof = belowAnchor.stateProof;
            Object.assign(auditingData, belowAnchor.auditingData);
            dispute.input.latestStateSnapshotHash = StateSnapshot.from(
                belowAnchor.auditingData.latestStateSnapshot
            ).hash;
            postAuditingData(dispute, auditingData);
        }
    );
    return dispute;
}

/**
 * `challengerIndex` applies a block-structure challenge naming `blockIndex` of
 * the committed `dispute` directly on chain.
 */
export async function applyStructureChallenge(
    h: MathPeerTestHarness,
    challengerIndex: number,
    dispute: DisputeStruct,
    blockIndex: number
): Promise<void> {
    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: challengerIndex });
    const challenge: DisputeFraudProofStruct = {
        proofType: toSolidityDisputeFraudProofType(
            DisputeFraudProofType.DisputeInvalidBlockStructure
        ),
        participant: dispute.input.disputer,
        dispute,
        encodedProof: Codec.encode(
            { blockIndex },
            DisputeFraudProofType.DisputeInvalidBlockStructure
        )
    };
    const tx = await h
        .getPeer(challengerIndex)
        .p2pInstance.stateChannelManagerContract.applyDisputeFraudProofs([
            challenge
        ]);
    await tx.wait();
}

/** A structure challenge naming `blockIndex` of the last milestone. */
export function structureChallenge(blockIndex: number): BlockChallenge {
    return {
        proofType: DisputeFraudProofType.DisputeInvalidBlockStructure,
        encodedProof: Codec.encode(
            { blockIndex },
            DisputeFraudProofType.DisputeInvalidBlockStructure
        )
    };
}

/**
 * The real evidence before the last milestone's block at `index`, as the
 * observer holds it: the block before it (none at height 0), that block's
 * snapshot (the fork genesis at height 0) and its full state.
 */
async function evidenceBefore(
    h: MathPeerTestHarness,
    observerIndex: number,
    dispute: DisputeStruct,
    index: number
) {
    const control = h.control(h.getPeer(observerIndex));
    const run = lastRun(dispute);
    let previousBlock: SignedBlockStruct = {
        encodedBlock: "0x",
        signature: "0x"
    };
    let encodedPreviousSnapshot: string | undefined;
    if (Block.fromBlockConfirmation(run[index]).height === 0) {
        encodedPreviousSnapshot = (
            await control.dispute
                .getGenesisSnapshotStruct(dispute.input.forkId as ForkId)
                .request()
        )?.encodedSnapshot;
    } else {
        previousBlock = run[index - 1].signedBlock;
        encodedPreviousSnapshot = (
            await control.query
                .getStateSnapshotStructByHash(
                    Block.fromBlockConfirmation(run[index - 1])
                        .stateSnapshotHash
                )
                .request()
        )?.encodedSnapshot;
    }
    if (!encodedPreviousSnapshot)
        throw new Error(`observer lacks the snapshot before index ${index}`);
    const previousSnapshot = Codec.decode(
        encodedPreviousSnapshot,
        Type.StateSnapshot
    );
    const previousState = await control.query
        .getStateMachineState(
            StateSnapshot.from(previousSnapshot).stateMachineStateHash
        )
        .request();
    if (previousState === null)
        throw new Error(`observer lacks the state before index ${index}`);
    return { previousBlock, previousSnapshot, previousState };
}

/**
 * The invalid-state-transition challenge against the last milestone's block
 * at `index`, built from the observer's real evidence before it.
 */
export async function invalidTransitionChallenge(
    h: MathPeerTestHarness,
    observerIndex: number,
    dispute: DisputeStruct,
    index: number
): Promise<BlockChallenge> {
    const run = lastRun(dispute);
    const { previousBlock, previousSnapshot, previousState } =
        await evidenceBefore(h, observerIndex, dispute, index);
    const fraudProof: FraudProofStruct = {
        proofType: toSolidityFraudProofType(
            FraudProofType.BlockInvalidStateTransition
        ),
        participant: Block.fromBlockConfirmation(run[index]).author,
        encodedProof: Codec.encode(
            {
                invalidBlock: run[index].signedBlock,
                previousBlock,
                previousBlockStateSnapshot: previousSnapshot,
                previousStateStateMachineState: previousState
            },
            FraudProofType.BlockInvalidStateTransition
        )
    };
    return {
        proofType:
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
        encodedProof: Codec.encode(
            { fraudProof, blockIndex: index },
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        )
    };
}

/**
 * The author-not-participant challenge naming the last milestone's block at
 * `index`, with the observer's real snapshots before and after it.
 */
export async function authorChallenge(
    h: MathPeerTestHarness,
    observerIndex: number,
    dispute: DisputeStruct,
    index: number
): Promise<BlockChallenge> {
    const { previousBlock, previousSnapshot } = await evidenceBefore(
        h,
        observerIndex,
        dispute,
        index
    );
    const resulting = await h
        .control(h.getPeer(observerIndex))
        .query.getStateSnapshotStructByHash(
            Block.fromBlockConfirmation(lastRun(dispute)[index])
                .stateSnapshotHash
        )
        .request();
    if (!resulting)
        throw new Error(`observer lacks the snapshot of index ${index}`);
    return {
        proofType: DisputeFraudProofType.DisputeBlockAuthorNotParticipant,
        encodedProof: Codec.encode(
            {
                blockIndex: index,
                previousBlock,
                previousStateSnapshot: previousSnapshot,
                resultingStateSnapshot: Codec.decode(
                    resulting.encodedSnapshot,
                    Type.StateSnapshot
                )
            },
            DisputeFraudProofType.DisputeBlockAuthorNotParticipant
        )
    };
}

/**
 * `challengerIndex` applies `challenges` against the committed `dispute` in
 * one `applyDisputeFraudProofs` transaction. `markMalicious` for a challenger
 * whose allegation the chain is expected to reject.
 */
export async function applyChallenges(
    h: MathPeerTestHarness,
    challengerIndex: number,
    dispute: DisputeStruct,
    challenges: BlockChallenge[],
    options: { markMalicious: boolean }
): Promise<void> {
    if (options.markMalicious)
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: challengerIndex });
    const proofs: DisputeFraudProofStruct[] = challenges.map((challenge) => ({
        proofType: toSolidityDisputeFraudProofType(challenge.proofType),
        participant: dispute.input.disputer,
        dispute,
        encodedProof: challenge.encodedProof
    }));
    const tx = await h
        .getPeer(challengerIndex)
        .p2pInstance.stateChannelManagerContract.applyDisputeFraudProofs(
            proofs
        );
    await tx.wait();
}

/** Every participant signs the last milestone's block at `index`, its author included. */
export function signersOf(dispute: DisputeStruct, index: number): Address[] {
    const block = Block.fromBlockConfirmation(lastRun(dispute)[index]);
    return [block.author, ...block.confirmationSignerAddresses];
}

/** The last milestone's block at `index` links to the block before it again (after that one was re-issued). */
export async function relinkBlock(
    h: MathPeerTestHarness,
    dispute: DisputeStruct,
    index: number
): Promise<void> {
    const previousHash = hash(
        lastRun(dispute)[index - 1].signedBlock.encodedBlock
    );
    await reissueBlock(h, dispute, index, (block) => ({
        ...block,
        previousBlockHash: previousHash
    }));
}

// ===== outcomes =====

/**
 * The dispute is killed with `proofType` stored by `auditorIndices`, and the
 * chain slashed exactly `slashedIndices`. The counter slashes the submitter;
 * an issuer that signed the invalid block is slashed by the separate block
 * fraud proof. The challenger is never slashed. Waits for every expected
 * slash, then checks the exact set.
 */
export async function expectKilledByChallenge(
    h: MathPeerTestHarness,
    options: {
        proofType: DisputeFraudProofType;
        auditorIndices: number[];
        slashedIndices: number[];
    }
): Promise<void> {
    await h.event.waitForPeers(
        "onDisputeKilled",
        options.auditorIndices.slice(0, 1),
        1,
        { mode: "atLeast" }
    );
    await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
        disputeFraudProofType: options.proofType,
        peerIndices: options.auditorIndices
    });
    const expected = options.slashedIndices.map(
        (index) => h.getPeer(index).address
    );
    // a block issuer's slash lands with the auditors' own disputes, which
    // can come after the kill: wait for every expected slash first
    await waitFor(async () => {
        const slashed = await h.channelManager.getOnChainSlashedParticipants(
            h.channelId
        );
        return expected.every((address) => slashed.includes(address));
    }, h.event.protocolEventTimeoutMs());
    await h.assert.dispute.slashedOnChainExactly(expected);
}

/**
 * Waits until the kill period of `forkId` expired (it restarts with every
 * evidence submission), so no kill can land any more.
 */
export async function waitUntilKillPeriodExpired(
    h: MathPeerTestHarness,
    forkId: ForkId,
    observerIndex: number
): Promise<void> {
    for (;;) {
        const killPeriod = await h.query.killPeriod(forkId, observerIndex);
        expect(killPeriod.windowExists, "the dispute window must exist").to.be
            .true;
        if (killPeriod.isExpired) return;
        await h.event.waitUntilTimestamp(killPeriod.killPeriodEnd + 2);
    }
}

/**
 * Through the whole kill period no auditor of `auditorIndices` stored a
 * dispute fraud proof or saw a kill, and the chain slashed exactly
 * `slashedIndices` (by default nobody; never the submitter).
 */
export async function expectNoChallengeThroughKillPeriod(
    h: MathPeerTestHarness,
    options: {
        forkId: ForkId;
        auditorIndices: number[];
        slashedIndices?: number[];
    }
): Promise<void> {
    await waitUntilKillPeriodExpired(
        h,
        options.forkId,
        options.auditorIndices[0]
    );
    for (const index of options.auditorIndices) {
        expect(
            h.event.getEventCallCount(index, "onDisputeKilled"),
            `peer ${index} saw a kill`
        ).to.equal(0);
        expect(
            await h
                .control(h.getPeer(index))
                .query.getDisputeFraudProofTypes()
                .request(),
            `peer ${index} stored a dispute fraud proof`
        ).to.deep.equal([]);
    }
    await h.assert.dispute.slashedOnChainExactly(
        (options.slashedIndices ?? []).map((index) => h.getPeer(index).address)
    );
}

/**
 * The last-milestone position named by the single `proofType` proof that
 * `peerIndex` stored (record-only host read).
 */
export async function storedChallengeBlockIndex(
    h: MathPeerTestHarness,
    peerIndex: number,
    proofType: BlockChallengeType
): Promise<number> {
    const stored = await h.execOnHost(h.getPeer(peerIndex), (sm) =>
        sm.storage.disputeFraudProofs.getDisputeFraudProofs().map((proof) => ({
            proofType: Number(proof.proofType),
            encodedProof: String(proof.encodedProof)
        }))
    );
    const wanted = Number(toSolidityDisputeFraudProofType(proofType));
    const matches = stored.filter((proof) => proof.proofType === wanted);
    expect(
        matches,
        `peer ${peerIndex} must store one ${DisputeFraudProofType[proofType]}`
    ).to.have.length(1);
    const encodedProof = matches[0].encodedProof;
    switch (proofType) {
        case DisputeFraudProofType.DisputeInvalidBlockStructure:
            return Number(
                Codec.decode(
                    encodedProof,
                    DisputeFraudProofType.DisputeInvalidBlockStructure
                ).blockIndex
            );
        case DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof:
            return Number(
                Codec.decode(
                    encodedProof,
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                ).blockIndex
            );
        case DisputeFraudProofType.DisputeBlockAuthorNotParticipant:
            return Number(
                Codec.decode(
                    encodedProof,
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant
                ).blockIndex
            );
    }
}

/** Every listed auditor except `killerIndex` stays out of the kill race. */
export async function onlyAuditorKills(
    h: MathPeerTestHarness,
    killerIndex: number,
    auditorIndices: number[]
) {
    const suppressed = auditorIndices.filter((index) => index !== killerIndex);
    return await Promise.all(
        suppressed.map(async (index) => ({
            index,
            kill: await h.rpcStub.suppressDisputeKill(index)
        }))
    );
}
