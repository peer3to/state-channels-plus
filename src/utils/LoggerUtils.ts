import {
    DisputeStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    DisputeFraudProofStruct,
    FraudProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, Type } from "./Codec";
import { hash } from "@/utils";
import { Address, Hash } from "@/types/types";
import { ethers } from "ethers";
import { DisputeFraudProofType } from "@/types/sol-enums";
import type { Logger } from "@/utils";

export class LoggerUtils {
    // ====================================
    // SIMPLE FORMATTERS
    // ====================================

    static formatHash(
        hash: Hash | string | Address,
        prefixLength: number = 4,
        suffixLength: number = 5
    ): string {
        const hashStr = typeof hash === "string" ? hash : String(hash);
        if (hashStr.length <= prefixLength + suffixLength + 2) {
            return hashStr;
        }
        return `${hashStr.slice(0, 2 + prefixLength)}...${hashStr.slice(-suffixLength)}`;
    }

    // ====================================
    // LOGGING PATTERNS
    // ====================================

    static logDisputeInitiated(
        logger: Logger,
        dispute: DisputeStruct,
        fraudProofs: FraudProofStruct[]
    ): void {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        const formattedHash = this.formatHash(disputeHash);
        const fraudProofDetails = fraudProofs.map((fp) => ({
            participant: fp.participant,
            proofType: fp.proofType
        }));

        logger.group(`🚨 Dispute: ${formattedHash}`);
        logger.warn("Dispute initiated", {
            disputeHash: formattedHash,
            disputer: dispute.input.disputer,
            fraudProofsCount: fraudProofs.length,
            selfRemoval: dispute.input.selfRemoval || false
        });
        logger.debug("Fraud proofs included", {
            fraudProofs: fraudProofDetails
        });
        console.trace("Dispute initiated - validation failure detected");
        logger.groupEnd();
    }

    static logTimeoutDetected(
        logger: Logger,
        participant: Address,
        blockHeight: number,
        isForced: boolean,
        previousBlockProducer?: Address,
        previousBlockProducerPostedCalldata?: boolean
    ): void {
        logger.group(`⏱️ Timeout @ block ${blockHeight}`);
        logger.warn("Timeout detected", {
            participant: this.formatHash(String(participant)),
            isForced
        });
        logger.debug("Timeout details", {
            participantFull: String(participant),
            blockHeight,
            isForced,
            previousBlockProducer,
            previousBlockProducerPostedCalldata
        });
        console.trace("Timeout detected - creating timeout dispute");
        logger.groupEnd();
    }

    // ====================================
    // DISPUTE LOG DATA FUNCTIONS
    // ====================================

    static disputeAudited(
        dispute: DisputeStruct,
        success: boolean,
        timestamp?: number | bigint
    ): {
        message: string;
        meta: Record<string, any>;
    } {
        const disputeMeta = this.getDisputeMetadata(dispute);
        const timeoutInfo = this.getTimeoutInfo(dispute);

        let meta: Record<string, any> = {
            disputeHash: disputeMeta.formattedHash,
            disputer: disputeMeta.disputer,
            onChainSlashes:
                disputeMeta.onChainSlashes.length > 0
                    ? disputeMeta.onChainSlashes
                    : undefined,
            selfRemoval: disputeMeta.selfRemoval,
            auditingSuccessful: success
        };

        if (timestamp !== undefined) {
            meta.evidenceSubmissionTimestamp = String(timestamp);
        }

        if (timeoutInfo.isTimeout && timeoutInfo.timeoutInfo) {
            const { participant, blockHeight } = timeoutInfo.timeoutInfo;
            const participantFormatted = this.formatHash(String(participant));
            const messagePrefix = success
                ? "✅ TIMEOUT DISPUTE AUDITING SUCCESSFUL"
                : "❌ TIMEOUT DISPUTE AUDITING FAILED";
            const message = `${messagePrefix} - Participant ${participantFormatted} timed out at block ${String(blockHeight)}`;
            meta = {
                ...meta,
                ...this.getTimeoutMetadata(timeoutInfo.timeoutInfo)
            };
            return { message, meta };
        }

        const messagePrefix = success
            ? "✅ DISPUTE AUDITING SUCCESSFUL"
            : "❌ DISPUTE AUDITING FAILED";
        const message = `${messagePrefix} - Hash: ${disputeMeta.formattedHash}`;
        meta.reason = "Fraud detection";
        return { message, meta };
    }

    static disputeKilled(
        dispute: DisputeStruct,
        killReason: DisputeFraudProofType | string | undefined,
        timestamp?: number | bigint
    ): {
        message: string;
        meta: Record<string, any>;
    } {
        const disputeMeta = this.getDisputeMetadata(dispute);
        const timeoutInfo = this.getTimeoutInfo(dispute);
        const killReasonStr = killReason
            ? this.formatKillReason(killReason)
            : undefined;

        let meta: Record<string, any> = {
            disputeHash: disputeMeta.formattedHash,
            disputer: disputeMeta.disputer,
            onChainSlashes:
                disputeMeta.onChainSlashes.length > 0
                    ? disputeMeta.onChainSlashes
                    : undefined,
            selfRemoval: disputeMeta.selfRemoval,
            auditingSuccessful: false,
            killReason: killReasonStr
        };

        if (timestamp !== undefined) {
            meta.evidenceSubmissionTimestamp = String(timestamp);
        }

        if (timeoutInfo.isTimeout && timeoutInfo.timeoutInfo) {
            const { participant, blockHeight } = timeoutInfo.timeoutInfo;
            const participantFormatted = this.formatHash(String(participant));
            const message = `💀 TIMEOUT DISPUTE KILLED - Participant ${participantFormatted} timed out at block ${String(blockHeight)}`;
            meta = {
                ...meta,
                ...this.getTimeoutMetadata(timeoutInfo.timeoutInfo)
            };
            return { message, meta };
        }

        const message = killReasonStr
            ? `💀 DISPUTE KILLED - Hash: ${disputeMeta.formattedHash} | Reason: ${killReasonStr}`
            : `💀 DISPUTE KILLED - Hash: ${disputeMeta.formattedHash}`;
        meta.reason = killReasonStr || "Fraud detection";
        return { message, meta };
    }

    static disputeEvidenceSubmitted(
        dispute: DisputeStruct,
        timestamp: number | bigint
    ): {
        message: string;
        meta: Record<string, any>;
    } {
        const disputeMeta = this.getDisputeMetadata(dispute);
        const timeoutInfo = this.getTimeoutInfo(dispute);

        let meta: Record<string, any> = {
            disputeHash: disputeMeta.formattedHash,
            disputer: disputeMeta.disputer,
            onChainSlashes:
                disputeMeta.onChainSlashes.length > 0
                    ? disputeMeta.onChainSlashes
                    : undefined,
            selfRemoval: disputeMeta.selfRemoval,
            evidenceSubmissionTimestamp: String(timestamp)
        };

        if (timeoutInfo.isTimeout && timeoutInfo.timeoutInfo) {
            const { participant, blockHeight } = timeoutInfo.timeoutInfo;
            const participantFormatted = this.formatHash(String(participant));
            const message = `📝 TIMEOUT DISPUTE EVIDENCE SUBMITTED - Participant ${participantFormatted} timed out at block ${String(blockHeight)}`;
            meta = {
                ...meta,
                ...this.getTimeoutMetadata(timeoutInfo.timeoutInfo)
            };
            return { message, meta };
        }

        const message = `📝 DISPUTE EVIDENCE SUBMITTED - Hash: ${disputeMeta.formattedHash}`;
        meta.reason = "Fraud detection";
        return { message, meta };
    }

    static getKillReasonFromFraudProof(
        disputeFraudProof: DisputeFraudProofStruct | undefined
    ): DisputeFraudProofType | undefined {
        if (!disputeFraudProof) {
            return undefined;
        }

        const proofType = disputeFraudProof.proofType;
        if (typeof proofType === "bigint") {
            return Number(proofType) as DisputeFraudProofType;
        } else if (typeof proofType === "number") {
            return proofType as DisputeFraudProofType;
        } else {
            return Number(proofType) as DisputeFraudProofType;
        }
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

    private static getDisputeMetadata(dispute: DisputeStruct): {
        formattedHash: string;
        disputer: Address;
        onChainSlashes: Address[];
        selfRemoval: boolean;
    } {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        const formattedHash = this.formatHash(disputeHash);
        const onChainSlashes = dispute.input.onChainSlashes || [];
        return {
            formattedHash,
            disputer: dispute.input.disputer,
            onChainSlashes,
            selfRemoval: dispute.input.selfRemoval || false
        };
    }

    private static getTimeoutMetadata(timeoutInfo: {
        participant: Address;
        blockHeight: string | bigint | number;
        isForced: boolean;
    }): Record<string, any> {
        return {
            reason: "Timeout",
            timeoutParticipant: String(timeoutInfo.participant),
            timeoutBlockHeight: String(timeoutInfo.blockHeight),
            isForced: timeoutInfo.isForced
        };
    }

    private static isTimeoutDispute(dispute: DisputeStruct): boolean {
        const timeout = dispute.input.timeout;
        if (!timeout) return false;
        return timeout.participant !== ethers.ZeroAddress;
    }

    private static getTimeoutInfo(dispute: DisputeStruct): {
        isTimeout: boolean;
        timeoutInfo?: {
            participant: Address;
            blockHeight: string | bigint | number;
            isForced: boolean;
        };
    } {
        if (!this.isTimeoutDispute(dispute)) {
            return { isTimeout: false };
        }

        const timeout = dispute.input.timeout as TimeoutStruct;

        return {
            isTimeout: true,
            timeoutInfo: {
                participant: timeout.participant,
                blockHeight: timeout.blockHeight,
                isForced: timeout.isForced
            }
        };
    }

    private static formatKillReason(
        killReason: DisputeFraudProofType | string
    ): string {
        return typeof killReason === "string"
            ? killReason
            : DisputeFraudProofType[killReason] || String(killReason);
    }
}
