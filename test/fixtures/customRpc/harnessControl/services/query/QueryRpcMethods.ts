// @spec-test-coverage-ignore: test-harness query support exercised by owning mapped test declarations
import { ethers } from "ethers";

import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import Clock from "@/Clock";
import { Codec, Type, hash } from "@/utils";
import { getChecksumAddress } from "@/utils/address";
import { Status } from "@/types/flags";
import StateSnapshot from "@/models/StateSnapshot";
import type { Address, ForkId, Hash, BlockHeight } from "@/types/types";
import type { QueryService } from "./QueryService";

/** Serializable inputs needed to assemble a block on top of a fork's head. */
export interface BlockBuildingContext {
    nextBlockHeight: BlockHeight;
    previousBlockHash: string;
    stateSnapshotHash: string;
    latestBlockTimestamp: number | null;
    latestInboundMessageBlockHash: string;
    latestInboundMessageBlockHeight: string;
    currentTimestamp: number;
}

/** Full serializable projection of a stored `Block` (white-box reads). */
export interface BlockBundle {
    hash: string;
    author: string;
    height: number;
    stateSnapshotHash: string;
    encodedSignedBlock: string;
    encodedBlockConfirmation: string;
    timestamp: number;
    onChainTimestamp: number | null;
    confirmationSignatures: string[];
    confirmationSignerAddresses: string[];
}

/**
 * Projection of an assembled state proof plus the on-chain verifier verdicts
 * (verifyMilestones / isMilestoneFinal / areSignedBlocksLinkedAndVerified).
 */
export interface StateProofVerification {
    /** The block height the proof was assembled at. */
    blockHeight: number;
    milestoneCount: number;
    signedBlockCount: number;
    /** Height of the proof's latest block, or null for an empty proof. */
    latestProofHeight: number | null;
    /** Per milestone: the block height each of its confirmations covers. */
    milestoneConfirmationHeights: number[][];
    /** getSnapshotFromMilestone(milestone).hash, one per milestone. */
    milestoneSnapshotHashes: string[];
    /** On-chain verdict for the proof's carrier (false for an empty proof). */
    verified: boolean;
    /** On-chain isMilestoneFinal for the first milestone; null when no milestone. */
    isFinal: boolean | null;
    /** Snapshot hash isMilestoneFinal finalized; null when no milestone. */
    onChainFinalizedSnapshotHash: string | null;
    /** TS extractor: getLatestSnapshotFromStateProof. */
    latestSnapshotHash: string;
    /** TS extractor: getLatestFinalizedSnapshot. */
    finalizedSnapshotHash: string;
    genesisSnapshotHash: string;
}

/**
 * Read-only peer-state queries for the test harness. Every method returns a
 * serializable projection (status, hash, height, address) — never a live
 * `Block`/transport/profile instance, which cannot cross the runtime port.
 */
export class QueryRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: QueryService
    ) {
        super(transport, service.p2pManager);
    }

    // ===== Identity / status =====

    public getStatus(): Status {
        return this.service.sm.status;
    }

    public getChannelId(): string {
        return this.service.sm.channelId as string;
    }

    public getSignerAddress(): string {
        return this.service.sm.signerAddress as string;
    }

    public getForkId(): string {
        return this.service.sm.forkId as string;
    }

    public async getParticipants(): Promise<string[]> {
        return (
            await this.service.sm.diamondStateMachine.getParticipants()
        ).map((a) => String(a));
    }

    public async getOnChainParticipantUnion(): Promise<string[]> {
        return (
            await this.service.sm.membershipService.getOnChainParticipantUnion()
        ).map(String);
    }

    /** Pending inbound message blocks the next authored block would consume. */
    public getPendingInboundMessageBlockCount(forkId: ForkId): number {
        const sm = this.service.sm;
        const previous =
            sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow({
                forkId,
                height: sm.storage.blocks.getNextBlockHeight(forkId)
            });
        return sm.blockProductionService["getPendingInboundMessageBlocks"](
            previous
        ).length;
    }

    public async getOnChainThresholdSet(): Promise<string[]> {
        return (
            await this.service.sm.membershipService.getOnChainThresholdSet()
        ).map(String);
    }

    /** Participants slashed on-chain for this channel. */
    public async getOnChainSlashedParticipants(): Promise<string[]> {
        const sm = this.service.sm;
        return await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
            sm.channelId
        );
    }

    public async getNextToWrite(): Promise<string> {
        return String(
            await this.service.sm.diamondStateMachine.getNextToWrite()
        );
    }

    public async isMyTurn(): Promise<boolean> {
        return await this.service.sm.blockProductionService["isMyTurn"]();
    }

    // ===== Block / snapshot storage (projections only) =====

    public getLatestBlockHash(forkId: ForkId): Hash | null {
        return this.service.storage.blocks.getLatestBlock(forkId)?.hash ?? null;
    }

    public getLatestBlockHeight(forkId: ForkId): BlockHeight | null {
        return (
            this.service.storage.blocks.getLatestBlock(forkId)?.height ?? null
        );
    }

    public getNextBlockHeight(forkId: ForkId): BlockHeight {
        return this.service.storage.blocks.getNextBlockHeight(forkId);
    }

    /** Latest block's confirmation for `forkId`, encoded (`Type.BlockConfirmation`), or null. */
    public getLatestBlockConfirmation(
        forkId: ForkId
    ): { encodedBlockConfirmation: string } | null {
        const struct =
            this.service.storage.blocks.getLatestBlock(
                forkId
            )?.blockConfirmationStruct;
        return struct
            ? {
                  encodedBlockConfirmation: Codec.encode(
                      struct,
                      Type.BlockConfirmation
                  ) as string
              }
            : null;
    }

    /** Serializable info about the head block of `forkId` (for forged builds). */
    /**
     * Latest-block sync state for `forkId`: tip hash/height, whether every
     * participant signed it, and signature/union counts (for sync diagnostics).
     */
    public getSyncTip(forkId: ForkId): {
        hash: string;
        height: number;
        finalized: boolean;
        signatures: number;
        union: number;
    } | null {
        const block = this.service.storage.blocks.getLatestBlock(forkId);
        if (!block) return null;
        const finalized =
            this.service.sm.agreementManager.didEveryoneSignBlock(block);
        const union = this.service.storage.getParticipantsUnion(
            block.coordinates,
            block.stateSnapshotHash
        ).length;
        return {
            hash: String(block.hash),
            height: Number(block.height),
            finalized,
            signatures: block.allSignatures.size,
            union
        };
    }

    /** Hash of the block at `forkId:height`, or null if not stored. */
    public getBlockHashAt(forkId: ForkId, height: BlockHeight): string | null {
        const block = this.service.storage.blocks.getBlock(forkId, height);
        return block ? String(block.hash) : null;
    }

    public getLatestBlockInfo(forkId: ForkId): {
        encodedBlock: string;
        hash: string;
        author: string;
        stateSnapshotHash: string;
    } | null {
        const block = this.service.storage.blocks.getLatestBlock(forkId);
        if (!block) return null;
        return {
            encodedBlock: Codec.encode(block.blockStruct, Type.Block) as string,
            hash: String(block.hash),
            author: String(block.author),
            stateSnapshotHash: String(block.stateSnapshotHash)
        };
    }

    /** Full serializable projection of the block at `forkId:height`, or null. */
    public getBlockByHeight(
        forkId: ForkId,
        height: BlockHeight
    ): BlockBundle | null {
        const block = this.service.storage.blocks.getBlock(forkId, height);
        return block ? this.service.toBlockBundle(block) : null;
    }

    /** Full serializable projection of the block with `blockHash`, or null. */
    public getBlockByHash(blockHash: Hash): BlockBundle | null {
        const block = this.service.storage.blocks.getBlock(blockHash);
        return block ? this.service.toBlockBundle(block) : null;
    }

    /** Latest block of `forkId` as a full serializable projection, or null. */
    public getLatestBlockBundle(forkId: ForkId): BlockBundle | null {
        const block = this.service.storage.blocks.getLatestBlock(forkId);
        return block ? this.service.toBlockBundle(block) : null;
    }

    // ===== AgreementManager queries =====

    public async getStateProofVerification(
        forkId: ForkId,
        blockHeight?: BlockHeight
    ): Promise<StateProofVerification | null> {
        return this.service.buildStateProofVerification(forkId, blockHeight);
    }

    public getLatestSignedBlockByParticipant(
        forkId: ForkId,
        participant: Address
    ): { height: number; signatureRecoversToParticipant: boolean } | null {
        const result =
            this.service.sm.agreementManager.getLatestSignedBlockByParticipant(
                forkId,
                participant
            );
        if (!result) return null;
        return {
            height: Number(result.block.height),
            signatureRecoversToParticipant:
                result.block.signatureToAddress(result.signature) ===
                getChecksumAddress(participant)
        };
    }
    public didEveryoneSignBlockAt(
        forkId: ForkId,
        height: BlockHeight
    ): boolean | null {
        const block = this.service.storage.blocks.getBlock(forkId, height);
        return block
            ? this.service.sm.agreementManager.didEveryoneSignBlock(block)
            : null;
    }
    public getParticipantChangeHeights(forkId: ForkId): BlockHeight[] {
        return this.service.getParticipantChangeHeights(forkId);
    }

    /** Whether this peer has blacklisted `evmAddress`. */
    public isBlacklisted(evmAddress: Address): boolean {
        return this.p2pManager.isBlacklisted(evmAddress);
    }

    /** Whether the block confirmation queue holds an entry for `blockHash`. */
    public isBlockQueued(blockHash: Hash): boolean {
        return (
            this.service.storage.queues.getQueuedEntry(blockHash) !== undefined
        );
    }

    /**
     * Decode the top block of a dispute state proof on-chain: whether it has a
     * block and that block's height (`transactionCnt`).
     */
    public async getStateProofTopBlockHeight(
        encodedStateProof: string
    ): Promise<{ hasBlock: boolean; height: number | null }> {
        const [hasBlock, block] =
            await this.service.sm.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                Codec.decode(encodedStateProof, Type.StateProof)
            );
        return {
            hasBlock,
            height: hasBlock
                ? Number(block.transaction.header.transactionCnt)
                : null
        };
    }

    /** On-chain dispute commitment hashes in `forkId`'s dispute window. */
    public async getDisputeWindowCommitments(
        forkId: ForkId
    ): Promise<string[]> {
        const windows =
            await this.service.sm.diamondStateMachine.localDiamondContract.getDisputeWindows(
                this.service.sm.channelId,
                [forkId]
            );
        const window = windows[0];
        if (!window) return [];
        return window.evidence.disputeCommitments.map(String);
    }

    /** Encoded (`Type.StateSnapshot`) snapshot with `snapshotHash`, or null. */
    public getStateSnapshotStructByHash(
        snapshotHash: Hash
    ): { encodedSnapshot: string } | null {
        const struct = this.service.storage.stateSnapshots
            .getStateSnapshotByHash(snapshotHash)
            ?.toStruct();
        return struct
            ? {
                  encodedSnapshot: Codec.encode(
                      struct,
                      Type.StateSnapshot
                  ) as string
              }
            : null;
    }

    /** Encoded (`Type.MessageBlock`) inbound message block, or null. */
    public getInboundMessageBlock(
        messageBlockHash: Hash
    ): { encodedMessageBlock: string } | null {
        const block =
            this.service.storage.inboundMessages.getMessageBlock(
                messageBlockHash
            );
        return block
            ? {
                  encodedMessageBlock: Codec.encode(
                      block,
                      Type.MessageBlock
                  ) as string
              }
            : null;
    }

    /** Encoded (`Type.MessageBlock`) outbound message block, or null. */
    public getOutboundMessageBlock(
        messageBlockHash: Hash
    ): { encodedMessageBlock: string } | null {
        const block =
            this.service.storage.outboundMessages.getMessageBlock(
                messageBlockHash
            );
        return block
            ? {
                  encodedMessageBlock: Codec.encode(
                      block,
                      Type.MessageBlock
                  ) as string
              }
            : null;
    }

    /** Encoded (`Type.MessageBlock`) outbound message blocks in range. */
    public getOutboundMessageBlocksInRange(options: {
        upperBlockHash: string;
        lowerBlockHash: string;
    }): { encodedMessageBlocks: string[] } {
        return {
            encodedMessageBlocks: this.service.storage.outboundMessages
                .getMessageBlocksInRange(options)
                .map((b) => Codec.encode(b, Type.MessageBlock) as string)
        };
    }

    /** Encoded (`Type.StateSnapshot`) snapshot at `forkId:height`, or null. */
    public getStateSnapshotStructAt(
        forkId: ForkId,
        height: BlockHeight
    ): { encodedSnapshot: string } | null {
        const struct = this.service.storage
            .getStateSnapshot({ forkId, height })
            ?.toStruct();
        return struct
            ? {
                  encodedSnapshot: Codec.encode(
                      struct,
                      Type.StateSnapshot
                  ) as string
              }
            : null;
    }

    /** Encoded state-machine state for `stateHash`, or null. */
    public getStateMachineState(stateHash: Hash): string | null {
        return (
            (this.service.storage.stateMachineStates.getStateMachineState(
                stateHash
            ) as string | undefined) ?? null
        );
    }

    public getInboundLatestHeight(): number | null {
        const height =
            this.service.storage.inboundMessages.getLatestBlockHeight();
        return height === undefined ? null : Number(height);
    }

    /** Number of distinct state snapshots stored. */
    public getSnapshotCount(): number {
        // Reads the storage's private index (no public count accessor).
        const store = this.service.storage.stateSnapshots as unknown as {
            snapshotsByHash: Map<string, unknown>;
        };
        return store.snapshotsByHash.size;
    }

    /**
     * All host-side inputs a (Byzantine) block builder needs: head height, head
     * hash, head snapshot hash, head timestamp, pending inbound coordinates, and
     * the host clock. Lets the harness assemble arbitrary blocks client-side and
     * only round-trip to the host for signing/broadcast.
     */
    public getBlockBuildingContext(forkId: ForkId): BlockBuildingContext {
        const nextBlockHeight =
            this.service.storage.blocks.getNextBlockHeight(forkId);
        const latestBlock = this.service.storage.blocks.getLatestBlock(forkId);
        const prevSnapshot = this.service.storage.getPreviousStateSnapshot({
            forkId,
            height: nextBlockHeight
        });
        return {
            nextBlockHeight,
            previousBlockHash: String(
                this.getPreviousBlockHash(forkId, nextBlockHeight)
            ),
            stateSnapshotHash: String(this.getStateSnapshotHash(forkId)),
            latestBlockTimestamp: latestBlock
                ? Number(latestBlock.timestamp)
                : null,
            latestInboundMessageBlockHash: String(
                prevSnapshot?.snapshotData.latestInboundMessageBlockHash ??
                    ethers.ZeroHash
            ),
            latestInboundMessageBlockHeight: String(
                prevSnapshot?.snapshotData.latestInboundMessageBlockHeight ?? 0n
            ),
            currentTimestamp: Clock.getTimeInSeconds()
        };
    }

    /** On-chain timestamp of the stored calldata for a block, or null. */
    public getBlockCalldataTimestamp(
        forkId: ForkId,
        height: BlockHeight,
        blockAuthor: Address
    ): number | null {
        return (
            this.service.storage.blockCalldata.getBlockCalldata(
                forkId,
                height,
                blockAuthor
            )?.onChainTimestamp ?? null
        );
    }

    /** The peer's protocol clock in seconds (chain-adjusted, not wall clock). */
    public getClockTimeInSeconds(): number {
        return Clock.getTimeInSeconds();
    }

    /** The peer's local-diamond state snapshot, encoded (`Type.StateSnapshot`). */
    public async getLocalStateSnapshotStruct(): Promise<{
        encodedSnapshot: string;
    }> {
        const snapshot =
            await this.service.sm.diamondStateMachine.localDiamondContract.getStateSnapshot(
                this.service.sm.channelId
            );
        return {
            encodedSnapshot: Codec.encode(
                StateSnapshot.from(snapshot).toStruct(),
                Type.StateSnapshot
            ) as string
        };
    }

    public getGenesisSnapshotHash(forkId: ForkId): Hash | null {
        return (
            this.service.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            )?.hash ?? null
        );
    }

    public getGenesisSnapshotTimestamp(forkId: ForkId): number | null {
        return (
            this.service.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            )?.timestamp ?? null
        );
    }

    public getCompletedReductionForkId(forkId: ForkId): ForkId | null {
        return (
            this.service.sm.reductionManager["getCompletedReduction"](forkId)
                ?.reducedForkId ?? null
        );
    }

    /**
     * Hash of the previous block (or genesis snapshot) at the head of `forkId`,
     * or at `height` when provided.
     */
    public getPreviousBlockHash(forkId: ForkId, height?: BlockHeight): Hash {
        if (height !== undefined) {
            const prev = this.service.storage.getPreviousBlockOrSnapshot({
                forkId,
                height
            });
            return (
                prev.block ? prev.block.hash : prev.stateSnapshot!.hash
            ) as Hash;
        }
        const prevBlock = this.service.storage.blocks.getLatestBlock(forkId);
        return (prevBlock?.hash ??
            this.service.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            )?.hash ??
            ethers.ZeroHash) as Hash;
    }

    /**
     * State-snapshot hash to build the next block on top of: the head block's
     * snapshot hash, else the fork's genesis snapshot hash.
     */
    public getStateSnapshotHash(forkId: ForkId): Hash {
        const prevBlock = this.service.storage.blocks.getLatestBlock(forkId);
        return (prevBlock?.stateSnapshotHash ??
            this.service.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            )?.hash ??
            ethers.ZeroHash) as Hash;
    }

    /**
     * Hash of the latest persisted state-machine state for `forkId`, or null if
     * the latest-block → snapshot → state chain is not fully present.
     */
    public getLatestStateMachineStateHash(forkId: ForkId): Hash | null {
        const latestBlock = this.service.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) return null;
        const snapshot =
            this.service.storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.stateSnapshotHash
            );
        if (!snapshot) return null;
        const state =
            this.service.storage.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            );
        if (!state) return null;
        return snapshot.stateMachineStateHash as Hash;
    }

    // ===== Network queries =====

    public getOpenConnectionCount(): number {
        return this.p2pManager.openConnections.length;
    }

    /** EVM addresses of the peers this peer currently has open connections to. */
    public getConnectedPeerAddresses(): string[] {
        const addresses: string[] = [];
        for (const transport of this.p2pManager.openConnections) {
            const profile =
                this.p2pManager.profileManager.getProfileByTransport(transport);
            if (profile?.evmAddress) addresses.push(String(profile.evmAddress));
        }
        return addresses;
    }

    public isConnectedTo(evmAddress: Address): boolean {
        const target = String(evmAddress).toLowerCase();
        return this.getConnectedPeerAddresses().some(
            (a) => a.toLowerCase() === target
        );
    }

    // ===== Storage assertion reads (test harness) =====

    /** Solidity proof-type (as string) of the fraud proof stored against a peer. */
    public getFraudProofType(participantAddress: Address): string | null {
        const fp = this.service.storage.fraudProofs.getFraudProofForParticipant(
            String(participantAddress)
        );
        return fp ? String(fp.proofType) : null;
    }

    /** Solidity proof-types (as strings) of all stored dispute fraud proofs. */
    public getDisputeFraudProofTypes(): string[] {
        return this.service.storage.disputeFraudProofs
            .getDisputeFraudProofs()
            .map((p) => String(p.proofType));
    }

    public getTimeout(
        forkId: ForkId
    ): { isForced: boolean; participant: string } | null {
        const t = this.service.storage.timeout.getTimeout(forkId);
        return t
            ? { isForced: t.isForced, participant: String(t.participant) }
            : null;
    }

    public hasDisputeConfirmation(disputeHash: Hash): boolean {
        return !!this.service.storage.disputes.getDisputeConfirmation(
            disputeHash
        );
    }

    public getDisputeConfirmationHashes(): string[] {
        // Reads the storage's private map (no public hash-listing accessor).
        const disputes = this.service.storage.disputes as unknown as {
            disputes: Map<string, unknown>;
        };
        return Array.from(disputes.disputes.keys());
    }

    public getLatestInboundMessageHash(): string | null {
        const hash = this.service.storage.inboundMessages.getLatestBlockHash();
        return hash === undefined ? null : String(hash);
    }

    /**
     * Verify the full stored block→snapshot→state→message-block chain at
     * `forkId:height` exists; returns the block hash or a reason it is missing.
     */
    public assertStoredBlockChain(
        forkId: ForkId,
        height: BlockHeight
    ): { ok: true; blockHash: string } | { ok: false; reason: string } {
        const storage = this.service.storage;
        const block = storage.blocks.getBlock(forkId, height);
        if (!block) {
            return { ok: false, reason: `no persisted block` };
        }
        const snapshot = storage.stateSnapshots.getStateSnapshotByHash(
            block.stateSnapshotHash
        );
        if (!snapshot) {
            return {
                ok: false,
                reason: `missing state snapshot ${block.stateSnapshotHash}`
            };
        }
        if (
            !storage.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            )
        ) {
            return {
                ok: false,
                reason: `missing state machine state ${snapshot.stateMachineStateHash}`
            };
        }
        for (const messageBlock of block.messageBlocks) {
            const messageBlockHash = hash(
                Codec.encode(messageBlock, Type.MessageBlock)
            ) as Hash;
            if (!storage.inboundMessages.getMessageBlock(messageBlockHash)) {
                return {
                    ok: false,
                    reason: `missing inbound message block ${messageBlockHash}`
                };
            }
        }
        if (
            snapshot.latestInboundMessageBlockHash !== ethers.ZeroHash &&
            !storage.inboundMessages.getMessageBlock(
                snapshot.latestInboundMessageBlockHash
            )
        ) {
            return {
                ok: false,
                reason: `missing inbound message block ${snapshot.latestInboundMessageBlockHash}`
            };
        }
        if (
            snapshot.latestOutboundMessageBlockHash !== ethers.ZeroHash &&
            !storage.outboundMessages.getMessageBlock(
                snapshot.latestOutboundMessageBlockHash
            )
        ) {
            return {
                ok: false,
                reason: `missing outbound message block ${snapshot.latestOutboundMessageBlockHash}`
            };
        }
        return { ok: true, blockHash: String(block.hash) };
    }

    /**
     * True if there is no live transport toward `otherAddress`, or it is closed.
     * Replaces harness-side `transport.isClosed` checks.
     */
    public isTransportClosed(otherAddress: Address): boolean {
        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(
                otherAddress
            );
        return !transport || transport.isClosed;
    }
}

export default QueryRpcMethods;
