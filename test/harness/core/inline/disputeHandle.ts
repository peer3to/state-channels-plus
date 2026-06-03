import type { Address, ChannelId, ForkId, Hash } from "@/types/types";
import type {
    BlockStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeWindowStructOutput,
    StateProofStruct
} from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import type { DisputeInterface } from "../interfaces/DisputeInterface";
import type { TestPeer } from "../types";

export class InlineDisputeHandle implements DisputeInterface {
    constructor(private readonly peer: TestPeer) {}

    private get stateManager() {
        return this.peer.stateManager;
    }

    async queryTimeoutForFork(
        forkId: ForkId
    ): Promise<TimeoutStruct | undefined> {
        return this.stateManager.storage.timeout.getTimeout(forkId);
    }

    async queryDisputeConfirmation(
        disputeHash: Hash
    ): Promise<DisputeConfirmationStruct | undefined> {
        return this.stateManager.storage.disputes.getDisputeConfirmation(
            disputeHash
        );
    }

    async queryFraudProofForParticipant(
        addr: Address
    ): Promise<{ proofType: number; participant: Address } | undefined> {
        const fp =
            this.stateManager.storage.fraudProofs.getFraudProofForParticipant(
                addr
            );
        if (!fp) return undefined;
        return { proofType: Number(fp.proofType), participant: fp.participant };
    }

    async queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>> {
        return this.stateManager.storage.disputeFraudProofs
            .getDisputeFraudProofs()
            .map((p) => ({ proofType: Number(p.proofType) }));
    }

    queryDisputeAuditingData(req: {
        forkId: ForkId;
        stateProof: StateProofStruct;
        options?: { disputeLatestInboundMessageBlockHash?: Hash };
    }): Promise<DisputeAuditingDataStruct> {
        const { auditingData } =
            this.stateManager.disputeManager.getAuditingData(
                req.forkId,
                req.stateProof,
                req.options
            );
        return Promise.resolve(auditingData);
    }

    async queryLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Promise<{ hasBlock: boolean; latestBlock: BlockStruct }> {
        const [hasBlock, latestBlock] =
            await this.stateManager.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                stateProof
            );
        return { hasBlock: Boolean(hasBlock), latestBlock };
    }

    async queryDisputeWindows(req: {
        channelId: ChannelId;
        forkIds: ForkId[];
    }): Promise<DisputeWindowStructOutput[]> {
        return this.stateManager.diamondStateMachine.localDiamondContract.getDisputeWindows(
            req.channelId,
            req.forkIds
        );
    }

    async queryOutboundMessageBlock(
        hash: Hash
    ): Promise<MessageBlockStruct | undefined> {
        return this.stateManager.storage.outboundMessages.getMessageBlock(hash);
    }

    async constructDispute(forkId: ForkId): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
        auditingData: DisputeAuditingDataStruct;
        fraudProofsToApply: FraudProofStruct[];
    }> {
        return await this.stateManager.disputeManager.constructDispute(forkId);
    }

    async storeTimeout(req: {
        forkId: ForkId;
        timeout: TimeoutStruct;
    }): Promise<void> {
        this.stateManager.storage.timeout.storeTimeout(req.forkId, req.timeout);
    }

    async setForceExit(value: boolean): Promise<void> {
        this.stateManager.storage.forceExit.setForceExit(value);
    }
}
