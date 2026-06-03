import type { Address, ChannelId, ForkId, Hash } from "@/types/types";
import type { DisputeWindowStructOutput } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    BlockStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { StateProofStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type { DisputeInterface } from "../interfaces/DisputeInterface";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import { ROUTES } from "../../threaded/worker/routeNames";

export class WorkerDisputeHandle implements DisputeInterface {
    constructor(private readonly rpc: PeerCaller) {}

    queryTimeoutForFork(forkId: ForkId): Promise<TimeoutStruct | undefined> {
        return this.rpc.call(ROUTES.query.timeoutForFork, {
            forkId
        }) as Promise<TimeoutStruct | undefined>;
    }

    queryDisputeConfirmation(
        disputeHash: Hash
    ): Promise<DisputeConfirmationStruct | undefined> {
        return this.rpc.call(ROUTES.query.disputeConfirmation, {
            disputeHash
        }) as Promise<DisputeConfirmationStruct | undefined>;
    }

    queryFraudProofForParticipant(
        addr: Address
    ): Promise<{ proofType: number; participant: Address } | undefined> {
        return this.rpc.call(ROUTES.query.fraudProofForParticipant, {
            addr
        }) as Promise<{ proofType: number; participant: Address } | undefined>;
    }

    queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>> {
        return this.rpc.call(ROUTES.query.disputeFraudProofs, {}) as Promise<
            Array<{ proofType: number }>
        >;
    }

    queryDisputeAuditingData(req: {
        forkId: ForkId;
        stateProof: StateProofStruct;
        options?: { disputeLatestInboundMessageBlockHash?: Hash };
    }): Promise<DisputeAuditingDataStruct> {
        return this.rpc.call(
            ROUTES.dispute.getAuditingData,
            req
        ) as Promise<DisputeAuditingDataStruct>;
    }

    queryLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Promise<{ hasBlock: boolean; latestBlock: BlockStruct }> {
        return this.rpc.call(ROUTES.dispute.latestBlockFromStateProof, {
            stateProof
        }) as Promise<{ hasBlock: boolean; latestBlock: BlockStruct }>;
    }

    queryDisputeWindows(req: {
        channelId: ChannelId;
        forkIds: ForkId[];
    }): Promise<DisputeWindowStructOutput[]> {
        return this.rpc.call(ROUTES.dispute.disputeWindows, req) as Promise<
            DisputeWindowStructOutput[]
        >;
    }

    queryOutboundMessageBlock(
        hash: Hash
    ): Promise<MessageBlockStruct | undefined> {
        return this.rpc.call(ROUTES.query.outboundMessageBlock, {
            hash
        }) as Promise<MessageBlockStruct | undefined>;
    }

    constructDispute(forkId: ForkId): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
        auditingData: DisputeAuditingDataStruct;
        fraudProofsToApply: FraudProofStruct[];
    }> {
        return this.rpc.call(ROUTES.dispute.construct, { forkId }) as Promise<{
            dispute: DisputeStruct;
            disputeConfirmation: DisputeConfirmationStruct;
            auditingData: DisputeAuditingDataStruct;
            fraudProofsToApply: FraudProofStruct[];
        }>;
    }

    storeTimeout(req: {
        forkId: ForkId;
        timeout: TimeoutStruct;
    }): Promise<void> {
        return this.rpc.call(ROUTES.timeout.store, req) as Promise<void>;
    }

    setForceExit(value: boolean): Promise<void> {
        return this.rpc.call(ROUTES.forceExit.set, { value }) as Promise<void>;
    }
}
