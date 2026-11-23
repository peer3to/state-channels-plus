// @spec-test-coverage-ignore: omitted-inbound-joiner and seated-joiner bypass dispute staging exercised by the E38/E44 and final-point regression cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Address, ForkId, Hash } from "@/types/types";
import { Codec, Type, hash } from "@/utils";
import { localDiamondAbi } from "@/utils/localDiamond";
import {
    postAuditingData,
    uploadSelfRemovalDispute
} from "@test/fixtures/ChallengeBoundaryStaging";
import { readLocalFinalizedHeight } from "@test/fixtures/OlderDisputeStaging";
import type {
    BlockStruct,
    MessageBlockStruct,
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { ProofWalkInputStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import type {
    DisputeAuditingDataStruct,
    DisputeInputStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { id, Interface } from "ethers";

const ALICE_INDEX = 0;
const BOB_INDEX = 1;

/** The colluders' private block before the forged hop, which Charlie never received. */
export type PrivatePredecessor = {
    hash: Hash;
    height: number;
    stateSnapshotHash: Hash;
    stateMachineStateHash: Hash;
};

/**
 * Alice and Bob are participants with a chain anchor; Charlie synced as a
 * spectator, stopped receiving block gossip, and joined (his JOIN is on chain
 * and pending). Alice and Bob then authored the private blocks `predecessor`
 * and `hopSource` that Charlie does not hold.
 */
export type OmittedInboundJoinerHistory = {
    forkId: ForkId;
    aliceIndex: number;
    bobIndex: number;
    charlieIndex: number;
    anchorHeight: number;
    predecessor: PrivatePredecessor;
    /** The private block the forged hop re-signs with a forged snapshot. */
    hopSource: {
        encodedBlock: string;
        author: Address;
        snapshot: StateSnapshotStruct;
        encodedState: string;
    };
};

/** The uploaded dispute with its posted auditing data. */
export type OmittedInboundJoinerDispute = {
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
    /** The hop's first block: it commits the forged snapshot, signed by Alice and Bob only. */
    hopBlock: Block;
    /** The participants of the dispute's output snapshot. */
    outputParticipants: Address[];
};

/** What one peer holds of the private predecessor. */
export type PredecessorHoldings = {
    block: boolean;
    blockAtHeight: boolean;
    snapshot: boolean;
    state: boolean;
};

/**
 * Stage the history of the U122 example. Every peer's kill is suppressed
 * except Charlie's, and Alice and Bob start no
 * disputes of their own, so the forged dispute is the only one and only
 * Charlie can counter it.
 */
export async function stageOmittedInboundJoinerHistory(
    h: MathPeerTestHarness
): Promise<OmittedInboundJoinerHistory> {
    // the forged dispute posts its auditing data: the kill period covers
    // a full audit of it
    await h.lifecycle.start(2, 2, { timeConfig: { evidenceTime: 12 } });
    const forkId = h.activeForkId!;
    const anchor = await h.transition.postSnapshotWait();
    if (!anchor) throw new Error("No finalized snapshot to anchor on chain");

    const { peer: charlie } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [ALICE_INDEX, BOB_INDEX],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait();

    await h.dispute.suppressDisputeInitiation([ALICE_INDEX, BOB_INDEX]);
    await h.rpcStub.suppressDisputeKill(ALICE_INDEX);
    await h.rpcStub.suppressDisputeKill(BOB_INDEX);

    // Charlie stops receiving blocks: Alice and Bob author privately
    await h.rpcStub.dropNetworkConfirmations(charlie.index);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: [ALICE_INDEX, BOB_INDEX],
        waitForFinalization: true
    });

    const alice = h.control(h.getPeer(ALICE_INDEX));
    const inboundBeforeJoin = await alice.query
        .getLatestInboundMessageHash()
        .request();
    await h.join.joinChannelWait({ joiner: charlie });
    await h.assert.storage.honestPeersObserveInboundMessageWait({
        previousLatestHash: (inboundBeforeJoin ?? undefined) as
            | Hash
            | undefined,
        peerIndices: [ALICE_INDEX, BOB_INDEX, charlie.index]
    });
    const charlieStatus = await h.control(charlie).query.getStatus().request();
    if (charlieStatus !== Status.PENDING_PARTICIPANT)
        throw new Error(
            `Charlie must be a pending participant, got ${Status[charlieStatus]}`
        );

    const hopSource = await alice.query.getLatestBlockInfo(forkId).request();
    if (!hopSource) throw new Error("Alice holds no private block");
    const hopSnapshot = await alice.query
        .getStateSnapshotStructByHash(hopSource.stateSnapshotHash as Hash)
        .request();
    if (!hopSnapshot) throw new Error("Alice lacks the private snapshot");
    const snapshot = Codec.decode(
        hopSnapshot.encodedSnapshot,
        Type.StateSnapshot
    );
    const encodedState = await alice.query
        .getStateMachineState(
            snapshot.snapshotData.stateMachineStateHash as Hash
        )
        .request();
    if (!encodedState) throw new Error("Alice lacks the private state");

    const hopHeight = Number(snapshot.blockHeight);
    const predecessorBlock = await alice.query
        .getBlockByHeight(forkId, hopHeight - 1)
        .request();
    if (!predecessorBlock) throw new Error("Alice lacks the predecessor");
    const predecessorSnapshot = await alice.query
        .getStateSnapshotStructByHash(
            predecessorBlock.stateSnapshotHash as Hash
        )
        .request();
    if (!predecessorSnapshot)
        throw new Error("Alice lacks the predecessor snapshot");

    return {
        forkId,
        aliceIndex: ALICE_INDEX,
        bobIndex: BOB_INDEX,
        charlieIndex: charlie.index,
        anchorHeight: anchor.blockHeight,
        predecessor: {
            hash: predecessorBlock.hash as Hash,
            height: predecessorBlock.height,
            stateSnapshotHash: predecessorBlock.stateSnapshotHash as Hash,
            stateMachineStateHash: Codec.decode(
                predecessorSnapshot.encodedSnapshot,
                Type.StateSnapshot
            ).snapshotData.stateMachineStateHash as Hash
        },
        hopSource: {
            encodedBlock: hopSource.encodedBlock,
            author: hopSource.author as Address,
            snapshot,
            encodedState
        }
    };
}

/** What `peerIndex` holds of the private predecessor. */
export async function readPredecessorHoldings(
    h: MathPeerTestHarness,
    peerIndex: number,
    history: OmittedInboundJoinerHistory
): Promise<PredecessorHoldings> {
    const query = h.control(h.getPeer(peerIndex)).query;
    const { predecessor } = history;
    return {
        block:
            (await query.getBlockByHash(predecessor.hash).request()) !== null,
        blockAtHeight:
            (await query
                .getBlockHashAt(history.forkId, predecessor.height)
                .request()) !== null,
        snapshot:
            (await query
                .getStateSnapshotStructByHash(predecessor.stateSnapshotHash)
                .request()) !== null,
        state:
            (await query
                .getStateMachineState(predecessor.stateMachineStateHash)
                .request()) !== null
    };
}

/**
 * Alice uploads a self-removal dispute with posted auditing data. Its proof is
 * one threshold hop from the chain anchor: the private block re-signed by
 * Alice and Bob only, committing a snapshot that consumes Charlie's JOIN
 * (inbound head, height and deposits) but keeps the participants {Alice, Bob}.
 * The posted data is consistent with that hop and its output is recomputed,
 * so the omitted joiner is the dispute's only fault.
 */
export async function postOmittedInboundJoinerDispute(
    h: MathPeerTestHarness,
    history: OmittedInboundJoinerHistory,
    options: {
        /** the run holding the chain anchor goes first: the forged hop is milestone 1 */
        anchorRunFirst?: boolean;
    } = {}
): Promise<OmittedInboundJoinerDispute> {
    const alice = h.getPeer(history.aliceIndex);
    const author = h.peers.find(
        (peer) => peer.address === history.hopSource.author
    );
    const coSigner = h.peers.find(
        (peer) =>
            peer.index !== author?.index &&
            (peer.index === history.aliceIndex ||
                peer.index === history.bobIndex)
    );
    if (!author || !coSigner)
        throw new Error("The private block's signers are not Alice and Bob");

    const anchorBundle = options.anchorRunFirst
        ? await h
              .control(alice)
              .query.getBlockByHeight(history.forkId, history.anchorHeight)
              .request()
        : undefined;
    if (options.anchorRunFirst && !anchorBundle)
        throw new Error("Alice holds no anchor block");
    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: history.bobIndex });
    await h.control(alice).dispute.setForceExit(true).request();
    h.event.resetEventSpies();

    let posted:
        | {
              auditingData: DisputeAuditingDataStruct;
              hopBlock: Block;
              outputParticipants: Address[];
          }
        | undefined;
    const { dispute } = await h.tamper.postTamperedDispute(
        history.aliceIndex,
        async (dispute, _disputeConfirmation, auditingData) => {
            if (!auditingData) throw new Error("expected auditing data");
            const join = auditingData.inboundMessageBlocks.at(-1);
            const joinHash = join
                ? hash(Codec.encode(join, Type.MessageBlock))
                : undefined;
            if (
                !join ||
                joinHash !== dispute.input.latestInboundMessageBlockHash
            )
                throw new Error("Alice's dispute does not name Charlie's JOIN");

            const sourceBlock = Codec.decode(
                history.hopSource.encodedBlock,
                Type.Block
            );
            // the hop consumes the JOIN, so it is stamped no earlier than it
            const timestamp = Math.max(
                Number(sourceBlock.transaction.header.timestamp),
                Number(join.timestamp)
            );
            const forgedSnapshot = StateSnapshot.from({
                ...history.hopSource.snapshot,
                timestamp,
                snapshotData: {
                    ...history.hopSource.snapshot.snapshotData,
                    latestInboundMessageBlockHash: joinHash,
                    latestInboundMessageBlockHeight: join.blockHeight,
                    totalDeposits: join.totalBalance
                }
            });
            const hopStruct: BlockStruct = {
                ...sourceBlock,
                transaction: {
                    ...sourceBlock.transaction,
                    header: { ...sourceBlock.transaction.header, timestamp }
                },
                stateSnapshotHash: forgedSnapshot.hash
            };
            const hopBlock = await Block.fromBlockStruct(
                hopStruct,
                author.signer
            );
            hopBlock.expandSignatures([await hopBlock.sign(coSigner.signer)]);

            dispute.input.stateProof = {
                milestones: [
                    { blockConfirmations: [hopBlock.blockConfirmationStruct] }
                ]
            };
            auditingData.milestoneSnapshots = [forgedSnapshot.toStruct()];
            if (anchorBundle) {
                // the run holding the anchor proves no hop: its snapshot entry is not read
                dispute.input.stateProof.milestones.unshift({
                    blockConfirmations: [
                        Codec.decode(
                            anchorBundle.encodedBlockConfirmation,
                            Type.BlockConfirmation
                        )
                    ]
                });
                auditingData.milestoneSnapshots.unshift(
                    forgedSnapshot.toStruct()
                );
            }
            // the forged latest state already consumed the dispute's inbound head
            const outputParticipants = await commitPostedLatestState(
                h,
                history.aliceIndex,
                { dispute, auditingData },
                {
                    latest: forgedSnapshot,
                    encodedState: history.hopSource.encodedState,
                    inboundMessageBlocks: []
                }
            );
            posted = { auditingData, hopBlock, outputParticipants };
        }
    );
    if (!posted) throw new Error("The forged dispute was not built");
    return { dispute, ...posted };
}

/**
 * Alice and Bob post the chain anchor; Charlie then syncs and joins, the
 * honest history consumes his JOIN and seats him, and it is final past the
 * join block with his signature. Alice and Bob start no disputes and send no
 * kills, so only Charlie can counter their dispute. Timeout checks are
 * suppressed.
 */
export type SeatedJoinerHistory = {
    forkId: ForkId;
    aliceIndex: number;
    bobIndex: number;
    charlieIndex: number;
    /** the chain anchor, below Charlie's JOIN */
    anchor: StateSnapshot;
    /** Charlie's local final point, whose inbound head is his JOIN */
    charlieFinal: StateSnapshot;
};

/** The colluders' one-hop dispute, constructed with its posted auditing data. */
export type JoinerBypassDispute = {
    dispute: DisputeStruct;
    auditingData: DisputeAuditingDataStruct;
    /** the hop: the block above Alice's head, committing `hopSnapshot` */
    hopBlock: Block;
    hopSnapshot: StateSnapshot;
};

/** Where the bypass hop sits and who signs it. */
export type JoinerBypassHopOptions = {
    inbound?: JoinerBypassInbound;
    /** the hop's height (default: the block above Alice's head); it links to Alice's block below it */
    height?: number;
    /** Charlie signs the hop too (default: only for `"join"`) */
    signedByCharlie?: boolean;
};

/** Which inbound head the bypass hop's snapshot names. */
export type JoinerBypassInbound =
    /** the anchor's, below Charlie's JOIN: the hop's walk never needs him */
    | "anchor"
    /** Charlie's JOIN: Alice's head state with Charlie seated, signed by all three */
    | "join"
    /** an inbound block the chain never held */
    | "unknown";

export async function stageSeatedJoinerHistory(
    h: MathPeerTestHarness
): Promise<SeatedJoinerHistory> {
    const charlie = await h.scenario.spectatorPromotedViaJoinChannelWait({
        initialPeers: 2,
        // the harness baseline timing: Charlie's kill must land in the kill period
        timeConfig: {},
        postAnchorBeforeJoin: true
    });
    const forkId = h.activeForkId!;
    for (const index of [ALICE_INDEX, BOB_INDEX, charlie.index])
        await h.rpcStub.suppressTimeoutCheck(index);
    await h.dispute.suppressDisputeInitiation([ALICE_INDEX, BOB_INDEX]);
    await h.rpcStub.suppressDisputeKill(ALICE_INDEX);
    await h.rpcStub.suppressDisputeKill(BOB_INDEX);

    const anchor = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    return {
        forkId,
        aliceIndex: ALICE_INDEX,
        bobIndex: BOB_INDEX,
        charlieIndex: charlie.index,
        anchor,
        charlieFinal: await readLocalFinalSnapshot(h, charlie.index, forkId)
    };
}

/** `peerIndex`'s latest local final point on `forkId`. */
export async function readLocalFinalSnapshot(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
): Promise<StateSnapshot> {
    const finalHeight = await readLocalFinalizedHeight(h, peerIndex, forkId);
    const final =
        finalHeight === null
            ? null
            : await h
                  .control(h.getPeer(peerIndex))
                  .query.getStateSnapshotStructAt(forkId, finalHeight)
                  .request();
    if (!final) throw new Error(`Peer ${peerIndex} holds no final point`);
    return StateSnapshot.from(
        Codec.decode(final.encodedSnapshot, Type.StateSnapshot)
    );
}

/**
 * The lowest height above the chain anchor whose state Charlie holds with
 * the anchor's inbound head: a block of the honest history before it
 * consumed his JOIN.
 */
export async function readPreJoinHeightAboveAnchor(
    h: MathPeerTestHarness,
    history: SeatedJoinerHistory
): Promise<number> {
    const query = h.control(h.getPeer(history.charlieIndex)).query;
    for (
        let height = history.anchor.blockHeight + 1;
        height < history.charlieFinal.blockHeight;
        height++
    ) {
        const stored = await query
            .getStateSnapshotStructAt(history.forkId, height)
            .request();
        if (!stored) continue;
        const snapshot = Codec.decode(
            stored.encodedSnapshot,
            Type.StateSnapshot
        );
        if (
            snapshot.snapshotData.latestInboundMessageBlockHash ===
            history.anchor.latestInboundMessageBlockHash
        )
            return height;
    }
    throw new Error(
        "The honest history consumed the JOIN right above the anchor"
    );
}

/**
 * Alice's self-removal dispute with posted auditing data whose proof is one
 * threshold hop from the chain anchor to the block above her head. By
 * default (`inbound: "anchor"`) the hop commits the anchor state at that
 * height, signed by Alice and Bob only: its inbound head stays the anchor's,
 * below Charlie's JOIN, so its walk needs no signature of his, and the posted
 * inbound run carries the JOIN up to the dispute's inbound head. With
 * `"join"` it commits Alice's head state (Charlie seated, JOIN consumed) at
 * that height instead, signed by all three. With `"unknown"` it commits the
 * anchor state naming an inbound head the chain never held, signed by Alice
 * and Bob. Constructed, not uploaded.
 */
export async function constructJoinerBypassDispute(
    h: MathPeerTestHarness,
    history: SeatedJoinerHistory,
    options: JoinerBypassHopOptions = {}
): Promise<JoinerBypassDispute> {
    await h
        .control(h.getPeer(history.aliceIndex))
        .dispute.setForceExit(true)
        .request();
    const { dispute, auditingData } = await h.dispute.fetchConstructedDispute(
        history.aliceIndex,
        history.forkId
    );
    const hop = await forgeJoinerBypassHop(
        h,
        history,
        { dispute, auditingData },
        options
    );
    return { dispute, auditingData, ...hop };
}

/**
 * {@link constructJoinerBypassDispute}'s default hop, uploaded by Alice;
 * `edit` changes the dispute after the hop is forged.
 */
export async function postJoinerBypassDispute(
    h: MathPeerTestHarness,
    history: SeatedJoinerHistory,
    edit: (dispute: DisputeStruct) => void = () => {}
): Promise<JoinerBypassDispute> {
    h.contextApi.markMaliciousPeer({ maliciousPeerIndex: history.bobIndex });
    let forged: Omit<JoinerBypassDispute, "dispute"> | undefined;
    const dispute = await uploadSelfRemovalDispute(
        h,
        history.aliceIndex,
        async (dispute, auditingData) => {
            const hop = await forgeJoinerBypassHop(
                h,
                history,
                { dispute, auditingData },
                {}
            );
            edit(dispute);
            forged = { auditingData, ...hop };
        },
        { markMalicious: true }
    );
    if (!forged) throw new Error("The forged dispute was not built");
    return { dispute, ...forged };
}

/**
 * Alice and Bob's side-chain final point at `height`: one threshold hop from
 * the chain anchor committing the anchor state at that height, signed by
 * them only, so its inbound head stays below Charlie's JOIN. Returned as the
 * walk input a final-history counter carries.
 */
export async function forgeSideChainFinalProof(
    h: MathPeerTestHarness,
    history: SeatedJoinerHistory,
    options: {
        height: number;
        genesisStateSnapshotData: SnapshotDataStruct;
    }
): Promise<{ finalProof: ProofWalkInputStruct; finalSnapshot: StateSnapshot }> {
    const { hopBlock, hopSnapshot } = await forgeAnchorHop(h, history, {
        height: options.height
    });
    return {
        finalProof: {
            channelId: h.channelId,
            forkId: history.forkId,
            stateProof: {
                milestones: [
                    { blockConfirmations: [hopBlock.blockConfirmationStruct] }
                ]
            },
            genesisStateSnapshotData: options.genesisStateSnapshotData,
            milestoneSnapshots: [hopSnapshot.toStruct()]
        },
        finalSnapshot: hopSnapshot
    };
}

async function forgeJoinerBypassHop(
    h: MathPeerTestHarness,
    history: SeatedJoinerHistory,
    constructed: {
        dispute: DisputeStruct;
        auditingData: DisputeAuditingDataStruct;
    },
    options: JoinerBypassHopOptions
): Promise<{ hopBlock: Block; hopSnapshot: StateSnapshot }> {
    const inbound = options.inbound ?? "anchor";
    const { hopBlock, hopSnapshot, encodedState } = await forgeAnchorHop(
        h,
        history,
        options
    );
    const query = h.control(h.getPeer(history.aliceIndex)).query;
    const join = await query
        .getInboundMessageBlock(
            history.charlieFinal.latestInboundMessageBlockHash
        )
        .request();
    if (!join) throw new Error("Alice lacks Charlie's JOIN");
    const { dispute, auditingData } = constructed;
    dispute.input.stateProof = {
        milestones: [{ blockConfirmations: [hopBlock.blockConfirmationStruct] }]
    };
    auditingData.milestoneSnapshots = [hopSnapshot.toStruct()];
    await commitPostedLatestState(h, history.aliceIndex, constructed, {
        latest: hopSnapshot,
        encodedState,
        // the anchor-headed hop still owes the JOIN; no run is known above an unknown head
        inboundMessageBlocks:
            inbound === "anchor"
                ? [Codec.decode(join.encodedMessageBlock, Type.MessageBlock)]
                : []
    });
    return { hopBlock, hopSnapshot };
}

/**
 * The hop block of {@link JoinerBypassHopOptions}, authored by Alice above
 * her block below `height`, with the snapshot it commits and that
 * snapshot's application state.
 */
async function forgeAnchorHop(
    h: MathPeerTestHarness,
    history: SeatedJoinerHistory,
    options: JoinerBypassHopOptions
): Promise<{
    hopBlock: Block;
    hopSnapshot: StateSnapshot;
    encodedState: string;
}> {
    const inbound = options.inbound ?? "anchor";
    const [alice, bob, charlie] = [
        history.aliceIndex,
        history.bobIndex,
        history.charlieIndex
    ].map((index) => h.getPeer(index));
    const query = h.control(alice).query;
    const head = await query.getLatestBlockInfo(history.forkId).request();
    if (!head) throw new Error("Alice holds no block");
    const headBlock = Codec.decode(head.encodedBlock, Type.Block);
    const headSnapshot = await query
        .getStateSnapshotStructByHash(head.stateSnapshotHash as Hash)
        .request();
    if (!headSnapshot) throw new Error("Alice lacks her head snapshot");
    const source =
        inbound === "join"
            ? StateSnapshot.from(
                  Codec.decode(headSnapshot.encodedSnapshot, Type.StateSnapshot)
              )
            : history.anchor;
    const encodedState = await query
        .getStateMachineState(source.stateMachineStateHash)
        .request();
    if (!encodedState) throw new Error("Alice lacks the hop's state");

    const headHeight = Number(headBlock.transaction.header.transactionCnt);
    const height = options.height ?? headHeight + 1;
    const previousBlockHash =
        height > headHeight + 1
            ? head.hash
            : await query.getBlockHashAt(history.forkId, height - 1).request();
    if (!previousBlockHash)
        throw new Error(`Alice holds no block at ${height - 1}`);
    const timestamp = headBlock.transaction.header.timestamp;
    const sourceStruct = source.toStruct();
    const hopSnapshot = StateSnapshot.from({
        ...sourceStruct,
        blockHeight: height,
        timestamp,
        snapshotData:
            inbound === "unknown"
                ? {
                      ...sourceStruct.snapshotData,
                      latestInboundMessageBlockHash: id(
                          "an inbound block the chain never held"
                      )
                  }
                : sourceStruct.snapshotData
    });
    const hopBlock = await Block.fromBlockStruct(
        {
            ...headBlock,
            transaction: {
                ...headBlock.transaction,
                header: {
                    ...headBlock.transaction.header,
                    participant: alice.address,
                    transactionCnt: height
                }
            },
            previousBlockHash,
            stateSnapshotHash: hopSnapshot.hash
        },
        alice.signer
    );
    const signedByCharlie = options.signedByCharlie ?? inbound === "join";
    hopBlock.expandSignatures(
        await Promise.all(
            (signedByCharlie ? [bob, charlie] : [bob]).map((peer) =>
                hopBlock.sign(peer.signer)
            )
        )
    );
    return { hopBlock, hopSnapshot, encodedState };
}

/**
 * Post `latest` as the dispute's latest state with its application state and
 * the inbound run above its inbound head, commit the data and recompute the
 * dispute output, as the disputer's own constructor does. Returns the
 * output's participants.
 */
async function commitPostedLatestState(
    h: MathPeerTestHarness,
    disputerIndex: number,
    {
        dispute,
        auditingData
    }: { dispute: DisputeStruct; auditingData: DisputeAuditingDataStruct },
    posted: {
        latest: StateSnapshot;
        encodedState: string;
        inboundMessageBlocks: MessageBlockStruct[];
    }
): Promise<Address[]> {
    dispute.input.latestStateSnapshotHash = posted.latest.hash;
    auditingData.latestStateSnapshot = posted.latest.toStruct();
    auditingData.latestFinalizedStateStateMachineState = posted.encodedState;
    auditingData.inboundMessageBlocks = posted.inboundMessageBlocks;
    postAuditingData(dispute, auditingData);
    const output = await computeDisputeOutputSnapshotData(
        h,
        disputerIndex,
        dispute.input,
        posted.latest.toStruct(),
        posted.encodedState,
        posted.inboundMessageBlocks
    );
    dispute.outputSnapshotDataHash = hash(
        Codec.encode(output, Type.SnapshotData)
    );
    return [...output.participants] as Address[];
}

/**
 * `peerIndex`'s local diamond computes the dispute output, the same contract
 * call an honest dispute constructor makes. The call crosses the runtime port
 * ABI-encoded.
 */
async function computeDisputeOutputSnapshotData(
    h: MathPeerTestHarness,
    peerIndex: number,
    input: DisputeInputStruct,
    latestStateSnapshot: StateSnapshotStruct,
    latestStateMachineState: string,
    inboundMessageBlocks: MessageBlockStruct[]
) {
    const localDiamond = new Interface(localDiamondAbi);
    const { encodedOutput } = await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            const contract = sm.diamondStateMachine.localDiamondContract;
            const call = contract.interface.decodeFunctionData(
                "computeDisputeOutputSnapshotData",
                args.calldata
            );
            const output =
                await contract.computeDisputeOutputSnapshotData.staticCall(
                    call[0],
                    call[1],
                    call[2],
                    call[3]
                );
            return {
                encodedOutput: contract.interface.encodeFunctionResult(
                    "computeDisputeOutputSnapshotData",
                    [output]
                )
            };
        },
        {
            calldata: localDiamond.encodeFunctionData(
                "computeDisputeOutputSnapshotData",
                [
                    input,
                    latestStateSnapshot,
                    latestStateMachineState,
                    inboundMessageBlocks
                ]
            )
        }
    );
    return localDiamond.decodeFunctionResult(
        "computeDisputeOutputSnapshotData",
        encodedOutput
    )[0];
}

/** The dispute with its hop block additionally signed by `peerIndex`. */
export async function withHopAlsoSignedBy(
    h: MathPeerTestHarness,
    posted: OmittedInboundJoinerDispute,
    peerIndex: number
): Promise<DisputeStruct> {
    const hopBlock = Block.fromBlockConfirmation(
        posted.hopBlock.blockConfirmationStruct
    );
    hopBlock.expandSignatures([
        await hopBlock.sign(h.getPeer(peerIndex).signer)
    ]);
    return {
        ...posted.dispute,
        input: {
            ...posted.dispute.input,
            stateProof: {
                milestones: [
                    { blockConfirmations: [hopBlock.blockConfirmationStruct] }
                ]
            }
        }
    };
}

/**
 * The on-chain kill of `disputer`'s dispute: the sender of the killing
 * transaction and the dispute fraud-proof types it applied (directly or
 * inside the kill-then-dispute multicall).
 */
export async function readDisputeKill(
    h: MathPeerTestHarness,
    disputer: Address
): Promise<{
    killer: Address;
    appliedProofTypes: DisputeFraudProofType[];
    /** the applied proofs' `encodedProof`, in order */
    appliedEncodedProofs: string[];
}> {
    const kills = (
        await h.channelManager.queryFilter(
            h.channelManager.filters.DisputeKilled(h.channelId)
        )
    ).filter((log) => log.args.disputer === disputer);
    if (kills.length !== 1)
        throw new Error(
            `Expected one kill of ${disputer}'s dispute, got ${kills.length}`
        );
    const tx = await kills[0].getTransaction();
    const manager = h.channelManager.interface;
    const parsed = manager.parseTransaction({ data: tx.data });
    const calls: string[] =
        parsed?.name === "multicallBestEffortLast"
            ? [...parsed.args[0]]
            : [tx.data];
    const appliedProofTypes: DisputeFraudProofType[] = [];
    const appliedEncodedProofs: string[] = [];
    for (const call of calls) {
        const inner = manager.parseTransaction({ data: call });
        if (inner?.name !== "applyDisputeFraudProofs") continue;
        for (const proof of inner.args[0]) {
            appliedProofTypes.push(
                (Number(proof.proofType) +
                    DisputeFraudProofType.DisputeNotLatestState) as DisputeFraudProofType
            );
            appliedEncodedProofs.push(String(proof.encodedProof));
        }
    }
    return {
        killer: tx.from as Address,
        appliedProofTypes,
        appliedEncodedProofs
    };
}
