// PeerHandle interface and sub-handle shapes shared by InlinePeer and WorkerPeer.

import type { Signer } from "ethers";
import type {
    Address,
    BlockHeight,
    ChannelId,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";
import type { Bytes, Status } from "@/types";
import type {
    BlockConfirmationStruct,
    BlockStruct,
    MessageBlockStruct,
    SignedBlockStruct,
    StateSnapshotStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeWindowStructOutput,
    StateProofStruct
} from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct,
    MilestoneProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type { EventSpies } from "./types";

import type { ByzantineInterface } from "./interfaces/ByzantineInterface";
import type { RpcStubInterface } from "./interfaces/RpcStubInterface";
import type { P2pInternalsInterface } from "./interfaces/P2pInternalsInterface";
import type { StubInterface } from "./interfaces/StubInterface";
import type { NetworkInterface } from "./interfaces/NetworkInterface";
import type { LifecycleInterface } from "./interfaces/LifecycleInterface";
import type { TransitionInterface } from "./interfaces/TransitionInterface";

// Re-exports so existing imports from this file continue to work.
export type { RestoreToken, ConnectionId } from "./interfaces/common";
export type { ByzantineInterface } from "./interfaces/ByzantineInterface";
export type {
    RpcStubHandlerFn,
    RpcStubInterface
} from "./interfaces/RpcStubInterface";
export type {
    ProfileSummary,
    TransportSummary,
    P2pInternalsInterface
} from "./interfaces/P2pInternalsInterface";
export type { StubMethodFn, StubInterface } from "./interfaces/StubInterface";
export type {
    DisconnectFilterFn,
    NetworkInterface
} from "./interfaces/NetworkInterface";
export type { LifecycleInterface } from "./interfaces/LifecycleInterface";
export type {
    NamedOpRequest,
    TransitionInterface
} from "./interfaces/TransitionInterface";

export interface LocalDiamondView {
    getLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Promise<{ hasBlock: boolean; latestBlock: BlockStruct }>;
    getDisputeWindows(
        channelId: ChannelId,
        forkIds: ForkId[]
    ): Promise<DisputeWindowStructOutput[]>;
}

export interface PeerHandle {
    // Set on WorkerPeer; undefined on InlinePeer.
    readonly __workerBackend?: true;

    readonly index: number;
    readonly address: string;
    readonly signer: Signer;
    readonly logger: Logger;

    readonly eventSpies: EventSpies;
    readonly turnBarrier: EventBarrier;

    readonly forkId: ForkId | undefined;

    queryStatus(): Promise<Status>;
    queryLatestBlock(
        forkId: ForkId
    ): Promise<{ hash: Hash; height: BlockHeight } | undefined>;
    queryBlockAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        { hash: Hash; height: BlockHeight; author: Address } | undefined
    >;
    queryNextToWrite(): Promise<Address>;
    queryParticipants(): Promise<Address[]>;
    queryDidEveryoneSignBlock(blockHash: Hash): Promise<boolean>;
    queryLatestStateMachineStateHash(forkId: ForkId): Promise<Hash | null>;
    queryNextBlockHeight(forkId: ForkId): Promise<BlockHeight>;
    queryStateSnapshotAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<{
        hash: Hash;
        stateMachineStateHash: Hash;
        blockHeight: BlockHeight;
    } | null>;
    queryStateMachineState(hash: Hash): Promise<Bytes | null>;
    queryStateSnapshotCount(): Promise<number>;
    queryIsMyTurn(): Promise<boolean>;
    queryLatestBlockConfirmation(
        forkId: ForkId
    ): Promise<BlockConfirmationStruct | undefined>;
    queryBlockConfirmationAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
          }
        | undefined
    >;
    queryBlockByHash(hash: Hash): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
              confirmationSignatures: string[];
          }
        | undefined
    >;
    queueBlock(req: {
        blockConfirmation: BlockConfirmationStruct;
        onChainTimestamp?: Timestamp;
    }): Promise<void>;
    isBlacklisted(addr: Address): Promise<boolean>;
    postBlockCalldata(req: {
        signedBlock: SignedBlockStruct;
        maxTimestamp: Timestamp;
    }): Promise<void>;
    queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: BlockHeight;
    }): Promise<Hash>;
    queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: Hash;
    }): Promise<Hash>;
    queryFraudProofForParticipant(addr: Address): Promise<{
        proofType: number;
        participant: Address;
    } | null>;
    queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>>;
    queryInboundLatestBlockHash(): Promise<Hash | undefined>;
    queryInboundLatestBlockHeight(): Promise<BlockHeight | undefined>;
    storeTimeout(req: {
        forkId: ForkId;
        timeout: TimeoutStruct;
    }): Promise<void>;
    setForceExit(value: boolean): Promise<void>;
    queryTimeoutForFork(forkId: ForkId): Promise<TimeoutStruct | null>;
    queryDisputeConfirmation(
        disputeHash: Hash
    ): Promise<DisputeConfirmationStruct | null>;
    computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: Hash;
        lowerBlockHash?: Hash;
    }): Promise<{ amount: string; data: string }>;
    queryLastMilestoneSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined>;
    subtractBalance(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<{ amount: string; data: string }>;
    areBalancesEqual(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<boolean>;
    queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<StateSnapshotStruct | null>;
    constructDispute(forkId: ForkId): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
        auditingData: DisputeAuditingDataStruct;
        fraudProofsToApply: FraudProofStruct[];
    }>;
    queryGenesisSnapshot(forkId: ForkId): Promise<StateSnapshotStruct | null>;
    queryStateSnapshotByHash(hash: Hash): Promise<StateSnapshotStruct | null>;
    queryOutboundMessageBlock(hash: Hash): Promise<MessageBlockStruct | null>;
    queryDisputeAuditingData(req: {
        forkId: ForkId;
        args?: unknown[];
    }): Promise<DisputeAuditingDataStruct>;
    queryLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Promise<{ hasBlock: boolean; latestBlock: BlockStruct }>;
    queryDisputeWindows(req: {
        channelId: string;
        forkIds: ForkId[];
    }): Promise<DisputeWindowStructOutput[]>;
    queryLocalStateSnapshot(channelId: string): Promise<StateSnapshotStruct>;
    postStateSnapshot(forkId: ForkId): Promise<StateSnapshotStruct | undefined>;
    prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshotStruct;
              milestoneSnapshots: StateSnapshotStruct[];
              milestoneProofs: MilestoneProofStruct[];
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    >;
    applyTransaction(
        req: TransactionStruct
    ): Promise<{ success: boolean; encodedState: Bytes }>;
    ingestBlockConfirmation(req: {
        blockConfirmation: BlockConfirmationStruct;
        ingestOptions?: { onChainTimestamp?: Timestamp };
    }): Promise<boolean>;

    readonly byzantine: ByzantineInterface;
    readonly rpcStub: RpcStubInterface;
    readonly queryInternals: P2pInternalsInterface;
    readonly network: NetworkInterface;
    readonly stub: StubInterface;
    readonly transition: TransitionInterface;
    readonly lifecycle: LifecycleInterface;

    dispose(): Promise<void>;
}
