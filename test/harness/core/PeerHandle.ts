// PeerHandle interface and sub-handle shapes shared by InlinePeer and WorkerPeer.

import type { Signer } from "ethers";
import type {
    Address,
    BlockHeight,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";
import type { Bytes, Status } from "@/types";
import type {
    BlockConfirmationStruct,
    MessageBlockStruct,
    SignedBlockStruct,
    StateSnapshotStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct,
    MilestoneProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type { EventSpies } from "./types";

import type { ByzantineHandle } from "./handles/ByzantineHandle";
import type { RpcStubHandle } from "./handles/RpcStubHandle";
import type { P2pInternalsHandle } from "./handles/P2pInternalsHandle";
import type { StubHandle } from "./handles/StubHandle";
import type { NetworkHandle } from "./handles/NetworkHandle";
import type { LifecycleHandle } from "./handles/LifecycleHandle";
import type { TransitionHandle } from "./handles/TransitionHandle";

// Re-exports so existing imports from this file continue to work.
export type { RestoreToken, ConnectionId } from "./handles/common";
export type {
    ByzantineHandle,
    SubmitDoubleSignReq
} from "./handles/ByzantineHandle";
export type { RpcStubHandlerFn, RpcStubHandle } from "./handles/RpcStubHandle";
export type {
    ProfileSummary,
    TransportSummary,
    P2pInternalsHandle
} from "./handles/P2pInternalsHandle";
export type { StubMethodFn, StubHandle } from "./handles/StubHandle";
export type {
    DisconnectFilterFn,
    NetworkHandle
} from "./handles/NetworkHandle";
export type { LifecycleHandle } from "./handles/LifecycleHandle";
export type {
    NamedOpRequest,
    TransitionHandle
} from "./handles/TransitionHandle";

export interface PeerHandle {
    // Set on WorkerPeer; undefined on InlinePeer.
    readonly __workerBackend?: true;

    readonly index: number;
    readonly address: Address;
    readonly signer: Signer;
    readonly logger: Logger;

    readonly eventSpies: EventSpies;
    readonly turnBarrier: EventBarrier;

    readonly forkId: ForkId | undefined;

    queryStatus(): Promise<Status>;
    queryLatestBlock(
        forkId: ForkId
    ): Promise<
        | {
              hash: Hash;
              height: BlockHeight;
              author: Address;
              stateSnapshotHash: Hash;
          }
        | undefined
    >;
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
    queryTimeoutsForFork(forkId: ForkId): Promise<TimeoutStruct[]>;
    queryTimeoutForFork(forkId: ForkId): Promise<TimeoutStruct | null>;
    queryDisputeConfirmation(
        disputeHash: Hash
    ): Promise<DisputeConfirmationStruct | null>;
    queryOpenDisputeForkIds(): Promise<ForkId[]>;
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
    queryLatestBlockFromStateProof(stateProof: unknown): Promise<{
        hasBlock: boolean;
        latestBlock: {
            transaction: {
                header: { transactionCnt: bigint | number | string };
            };
        } & Record<string, unknown>;
    }>;
    queryDisputeWindows(req: {
        channelId: string;
        forkIds: ForkId[];
    }): Promise<unknown[]>;
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

    readonly byzantine: ByzantineHandle;
    readonly rpcStub: RpcStubHandle;
    readonly queryInternals: P2pInternalsHandle;
    readonly network: NetworkHandle;
    readonly stub: StubHandle;
    readonly transition: TransitionHandle;
    readonly lifecycle: LifecycleHandle;

    dispose(): Promise<void>;

    resetSpies(): Promise<void>;
}
