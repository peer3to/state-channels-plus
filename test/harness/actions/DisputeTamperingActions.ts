import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, SignatureUtils, Codec, Type, hash } from "@/utils";
import { ForkId } from "@/types/types";
import { BytesLike, Signer } from "ethers";
import {
    DisputeStruct,
    DisputeConfirmationStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import DisputeManager, {
    ConstructDisputeResult
} from "@/disputeManager/DisputeManager";

export type DisputeTamper = (
    dispute: DisputeStruct,
    disputeConfirmation: DisputeConfirmationStruct
) => void | Promise<void>;

export class DisputeTampering {
    static tamperAuditingDataHash(dispute: DisputeStruct): void {
        dispute.input.disputeAuditingDataHash = hash("0x42");
    }

    static createTamperTimeoutParticipant(
        wrongParticipantAddress: string,
        blockHeight: number
    ) {
        return (dispute: DisputeStruct): void => {
            dispute.input.timeout.participant = wrongParticipantAddress;
            dispute.input.timeout.blockHeight = blockHeight;
        };
    }

    static tamperDoubleFault(dispute: DisputeStruct): void {
        dispute.input.disputeAuditingDataHash = hash("0x42");
        dispute.input.latestStateSnapshotHash = hash("0x43");
    }

    static tamperInvalidStateProof(dispute: DisputeStruct): void {
        dispute.input.latestStateSnapshotHash = hash("0x42");
    }

    static tamperInvalidStateProofWithCalldata(dispute: DisputeStruct): void {
        DisputeTampering.tamperInvalidStateProof(dispute);
        dispute.postedAuditingData = true;
    }

    static tamperPartialAuditing(dispute: DisputeStruct): void {
        const tamperedStateProof = dispute.input.stateProof;
        if (
            tamperedStateProof.milestones.length === 0 ||
            tamperedStateProof.milestones[0].blockConfirmations.length === 0
        ) {
            throw new Error("No milestones to tamper");
        }

        const firstBc = tamperedStateProof.milestones[0].blockConfirmations[0];
        const block = Codec.decode(
            firstBc.signedBlock.encodedBlock,
            Type.Block
        );

        block.stateSnapshotHash = hash("0xDEADBEEF");
        firstBc.signedBlock.encodedBlock = Codec.encode(block, Type.Block);
    }
}

export class DisputeTamperingActions {
    private restoreByPeerIndex = new Map<number, () => void>();

    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    async postTamperedDispute(
        authorPeerIndex: number,
        tamper: DisputeTamper,
        forkId?: ForkId
    ): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
    }> {
        const peer = this.harness.getPeer(authorPeerIndex);
        const targetForkId = forkId || this.harness.activeForkId!;

        const { dispute, disputeConfirmation, auditingData } =
            await peer.stateManager.disputeManager.constructDispute(
                targetForkId
            );

        await tamper(dispute, disputeConfirmation);
        await this.resignDispute(peer.signer, dispute, disputeConfirmation);

        this.logger.debug(
            `Peer ${authorPeerIndex} submitting tampered dispute for fork ${targetForkId}`
        );

        const channelManager = this.harness.channelManager.connect(peer.signer);
        const txResp = dispute.postedAuditingData
            ? await channelManager.uploadDisputeWithCalldata(
                  disputeConfirmation,
                  auditingData
              )
            : await channelManager.uploadDispute(disputeConfirmation);
        await txResp.wait();

        this.harness.context.tamperedDisputes.push(dispute);

        return { dispute, disputeConfirmation };
    }

    stubConstructDispute(
        peerIndex: number,
        tamper: DisputeTamper,
        options?: { autoRestore?: boolean }
    ): void {
        const peer = this.harness.getPeer(peerIndex);
        const disputeManager: DisputeManager = peer.stateManager.disputeManager;

        this.restoreConstructDispute(peerIndex);

        const originalConstructDispute =
            disputeManager.constructDispute.bind(disputeManager);

        disputeManager.constructDispute = async (
            targetForkId: ForkId
        ): Promise<ConstructDisputeResult> => {
            const result = await originalConstructDispute(targetForkId);

            await tamper(result.dispute, result.disputeConfirmation);
            await this.resignDispute(
                peer.signer,
                result.dispute,
                result.disputeConfirmation
            );

            this.harness.context.tamperedDisputes.push(result.dispute);

            if (options?.autoRestore) {
                this.restoreConstructDispute(peerIndex);
            }

            return result;
        };

        this.restoreByPeerIndex.set(peerIndex, () => {
            disputeManager.constructDispute = originalConstructDispute;
        });

        this.logger.debug(`Stubbed constructDispute for peer ${peerIndex}`);
    }

    restoreConstructDispute(peerIndex: number): void {
        const restore = this.restoreByPeerIndex.get(peerIndex);
        if (!restore) {
            return;
        }

        restore();
        this.restoreByPeerIndex.delete(peerIndex);
        this.logger.debug(`Restored constructDispute for peer ${peerIndex}`);
    }

    private async resignDispute(
        signer: Signer,
        dispute: DisputeStruct,
        disputeConfirmation: DisputeConfirmationStruct
    ): Promise<void> {
        const tamperedSig = await SignatureUtils.signDispute(dispute, signer);
        disputeConfirmation.signedDispute = {
            encodedDispute: tamperedSig.encoded,
            signature: tamperedSig.signature as BytesLike
        };
        disputeConfirmation.signatures = [];
    }
}
