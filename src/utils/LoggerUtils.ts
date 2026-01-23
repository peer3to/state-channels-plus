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
    // DATA FORMATTERS (for EventHandler)
    // ====================================

    static getDisputeMessage(
        dispute: DisputeStruct,
        options?: {
            auditingResult?: boolean;
            killReason?: DisputeFraudProofType | string;
            isEvidenceSubmission?: boolean;
            evidenceSubmissionTimestamp?: number | bigint;
            isFinal?: boolean;
        }
    ): {
        message: string;
        meta: Record<string, any>;
    } {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        const formattedHash = this.formatHash(disputeHash);
        const timeoutInfo = this.getTimeoutInfo(dispute);
        const onChainSlashes = dispute.input.onChainSlashes || [];

        let message: string;
        const meta: Record<string, any> = {
            disputeHash: formattedHash,
            disputer: dispute.input.disputer,
            onChainSlashes:
                onChainSlashes.length > 0 ? onChainSlashes : undefined,
            selfRemoval: dispute.input.selfRemoval || false
        };

        // Add stage-specific metadata
        if (options?.auditingResult !== undefined) {
            meta.auditingSuccessful = options.auditingResult;
        }
        if (options?.killReason !== undefined) {
            meta.killReason = this.formatKillReason(options.killReason);
        }
        if (
            options?.isEvidenceSubmission &&
            options.evidenceSubmissionTimestamp !== undefined
        ) {
            meta.evidenceSubmissionTimestamp = String(
                options.evidenceSubmissionTimestamp
            );
        }
        if (options?.isFinal !== undefined) {
            meta.isFinal = options.isFinal;
        }

        // Build message based on type
        if (timeoutInfo.isTimeout && timeoutInfo.timeoutInfo) {
            const { participant, blockHeight, isForced } =
                timeoutInfo.timeoutInfo;
            const participantFormatted = this.formatHash(String(participant));
            message = this.buildTimeoutMessage(
                participantFormatted,
                String(blockHeight),
                options
            );
            meta.reason = "Timeout";
            meta.timeoutParticipant = String(participant);
            meta.timeoutBlockHeight = String(blockHeight);
            meta.isForced = isForced;
        } else {
            message = this.buildDisputeMessage(formattedHash, options);
            meta.reason = options?.killReason
                ? this.formatKillReason(options.killReason)
                : "Fraud detection";
        }

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

    static getDisputeAuditingLogData(
        dispute: DisputeStruct,
        isValid: boolean,
        disputeCreationTimestamp: number | bigint,
        isFinal: boolean
    ): {
        message: string;
        meta: Record<string, any>;
    } {
        return this.getDisputeMessage(dispute, {
            auditingResult: isValid,
            isEvidenceSubmission: true,
            evidenceSubmissionTimestamp: disputeCreationTimestamp,
            isFinal: isFinal
        });
    }

    static getDisputeKillLogData(
        dispute: DisputeStruct,
        disputeFraudProof: DisputeFraudProofStruct | undefined,
        disputeCreationTimestamp: number | bigint,
        isFinal: boolean
    ): {
        message: string;
        meta: Record<string, any>;
    } {
        const killReason = this.getKillReasonFromFraudProof(disputeFraudProof);

        return this.getDisputeMessage(dispute, {
            auditingResult: false,
            killReason: killReason,
            isEvidenceSubmission: true,
            evidenceSubmissionTimestamp: disputeCreationTimestamp,
            isFinal: isFinal
        });
    }

    // ====================================
    // PRIVATE HELPERS
    // ====================================

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
            previousBlockProducer?: Address;
        };
    } {
        if (!this.isTimeoutDispute(dispute)) {
            return { isTimeout: false };
        }

        const timeout = dispute.input.timeout as TimeoutStruct;
        const previousBlockProducer = timeout.previousBlockProducer;
        const isNonZeroProducer =
            previousBlockProducer &&
            previousBlockProducer !== ethers.ZeroAddress;

        return {
            isTimeout: true,
            timeoutInfo: {
                participant: timeout.participant,
                blockHeight: timeout.blockHeight,
                isForced: timeout.isForced,
                previousBlockProducer: isNonZeroProducer
                    ? previousBlockProducer
                    : undefined
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

    private static buildTimeoutMessage(
        participantFormatted: string,
        blockHeightStr: string,
        options?: {
            killReason?: DisputeFraudProofType | string;
            isEvidenceSubmission?: boolean;
            auditingResult?: boolean;
        }
    ): string {
        let messagePrefix = "⏱️ TIMEOUT DISPUTE";
        if (options?.killReason !== undefined) {
            messagePrefix = "💀 TIMEOUT DISPUTE KILLED";
        } else if (options?.isEvidenceSubmission) {
            messagePrefix = "📝 TIMEOUT DISPUTE EVIDENCE SUBMITTED";
        } else if (options?.auditingResult === false) {
            messagePrefix = "❌ TIMEOUT DISPUTE AUDITING FAILED";
        } else if (options?.auditingResult === true) {
            messagePrefix = "✅ TIMEOUT DISPUTE AUDITING SUCCESSFUL";
        }
        return `${messagePrefix} - Participant ${participantFormatted} timed out at block ${blockHeightStr}`;
    }

    private static buildDisputeMessage(
        formattedHash: string,
        options?: {
            killReason?: DisputeFraudProofType | string;
            isEvidenceSubmission?: boolean;
            auditingResult?: boolean;
        }
    ): string {
        let messagePrefix = "🚨 DISPUTE COMMITTED";
        if (options?.killReason !== undefined) {
            messagePrefix = "💀 DISPUTE KILLED";
            const killReasonStr = this.formatKillReason(options.killReason);
            return `${messagePrefix} - Hash: ${formattedHash} | Reason: ${killReasonStr}`;
        } else if (options?.isEvidenceSubmission) {
            messagePrefix = "📝 DISPUTE EVIDENCE SUBMITTED";
            return `${messagePrefix} - Hash: ${formattedHash}`;
        } else if (options?.auditingResult === false) {
            messagePrefix = "❌ DISPUTE AUDITING FAILED";
            return `${messagePrefix} - Hash: ${formattedHash}`;
        } else if (options?.auditingResult === true) {
            messagePrefix = "✅ DISPUTE AUDITING SUCCESSFUL";
            return `${messagePrefix} - Hash: ${formattedHash}`;
        }
        return `${messagePrefix} - Hash: ${formattedHash}`;
    }
}
