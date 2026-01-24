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
import { Address, Hash, ChannelId, ForkId } from "@/types/types";
import { ethers } from "ethers";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { Logger } from "@/utils";
import { TransportType } from "@/transport/TransportType";
import ATransport from "@/transport/ATransport";

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

    static enumToString<T extends Record<string, string | number>>(
        enumObj: T,
        value: number | bigint | T[keyof T]
    ): string {
        // If already a string (enum name), return it
        if (typeof value === "string") {
            return value;
        }

        const numValue =
            typeof value === "bigint" ? Number(value) : Number(value);

        // Look up enum name by numeric value
        const result = (enumObj as unknown as Record<number, string | number>)[
            numValue
        ];
        const enumName = typeof result === "string" ? result : undefined;

        return enumName ?? `UNKNOWN(${numValue})`;
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
            proofType: this.formatProofType(
                typeof fp.proofType === "string"
                    ? Number(fp.proofType)
                    : fp.proofType
            )
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

    /**
     * Convenience helper for logging transport disconnects.
     * Extracts common metadata (peerAddress, channelId, forkId, transportType, logger) from transport.
     * This is a thin wrapper around logPeerDisconnected() to reduce call-site boilerplate.
     */
    static logTransportDisconnect(
        transport: ATransport,
        details: {
            reason: string;
            connectionState?: string;
            socketState?: string | number;
            iceState?: string;
            error?: Error | unknown;
        }
    ): void {
        const profile =
            transport.p2pManager.profileManager.getProfileByTransport(
                transport
            );
        const peerAddress =
            transport.peerAddress ||
            profile?.getEvmAddress()?.toString() ||
            "unknown";
        const stateManager = transport.p2pManager.stateManager;
        const logger = transport.p2pManager.logger;

        // Normalize socketState to string if it's a number
        const socketStateStr =
            details.socketState !== undefined
                ? typeof details.socketState === "string"
                    ? details.socketState
                    : String(details.socketState)
                : undefined;

        this.logPeerDisconnected(logger, {
            transportType: transport.transportType,
            reason: details.reason,
            peerAddress,
            channelId: stateManager.getChannelId(),
            forkId: stateManager.forkId,
            connectionState: details.connectionState,
            socketState: socketStateStr,
            iceState: details.iceState,
            error: details.error
        });
    }

    static logPeerDisconnected(
        logger: Logger,
        options: {
            transportType: TransportType;
            reason: string;
            peerAddress?: string;
            channelId?: ChannelId;
            forkId?: ForkId;
            connectionState?: string;
            error?: Error | unknown;
            socketState?: string;
            iceState?: string;
        }
    ): void {
        const {
            transportType,
            reason,
            peerAddress,
            channelId,
            forkId,
            connectionState,
            error,
            socketState,
            iceState
        } = options;

        const transportTypeName = TransportType[transportType] || "UNKNOWN";
        const peerFormatted = peerAddress
            ? this.formatHash(peerAddress)
            : "unknown";

        logger.group("🔌 Peer disconnected");

        logger.warn("Connection disconnected", {
            transportType: transportTypeName,
            reason,
            peer: peerFormatted,
            channelId: channelId || undefined,
            forkId: forkId || undefined,
            connectionState: connectionState || undefined
        });

        const debugDetails: Record<string, any> = {
            peerFull: peerAddress || undefined,
            transportType: transportTypeName,
            reason,
            channelId: channelId || undefined,
            forkId: forkId || undefined,
            connectionState: connectionState || undefined,
            timestamp: Date.now()
        };

        if (socketState) {
            debugDetails.socketState = socketState;
        }

        if (iceState) {
            debugDetails.iceState = iceState;
        }

        if (error) {
            debugDetails.error =
                error instanceof Error ? error.message : String(error);
            debugDetails.errorStack =
                error instanceof Error ? error.stack : undefined;
        }

        logger.debug("Disconnect details", debugDetails);

        console.trace("Disconnect stack trace");

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
            : this.enumToString(DisputeFraudProofType, killReason);
    }

    private static formatProofType(proofType: number | bigint): string {
        const numValue =
            typeof proofType === "bigint" ? Number(proofType) : proofType;

        for (const key in FraudProofType) {
            const enumValue =
                FraudProofType[key as keyof typeof FraudProofType];
            if (
                typeof enumValue === "number" &&
                toSolidityFraudProofType(enumValue) === numValue
            ) {
                return key;
            }
        }

        for (const key in DisputeFraudProofType) {
            const enumValue =
                DisputeFraudProofType[
                    key as keyof typeof DisputeFraudProofType
                ];
            if (
                typeof enumValue === "number" &&
                toSolidityDisputeFraudProofType(enumValue) === numValue
            ) {
                return key;
            }
        }

        // Fallback
        return `UNKNOWN(${numValue})`;
    }
}
