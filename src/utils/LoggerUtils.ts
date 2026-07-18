import {
    DisputeStruct,
    TimeoutStruct,
    DisputeInputStruct,
    DisputeAuditingDataStruct,
    ReduceOutputStruct,
    BlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    DisputeFraudProofStruct,
    FraudProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, Type } from "./Codec";
import { hash } from "./hash";
import { difference } from "./set";
import { Address, BlockOrSnapshot, Bytes, Hash } from "@/types/types";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { Logger, LogLevel } from "./logging/Logger";
import { TransportType } from "@/transport/TransportType";
import type ATransport from "@/transport/ATransport";
import { Block, StateSnapshot, StateProof } from "@/models";
import Storage from "@/storage";
import {
    MessageStruct,
    MessageBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { TimeConfig } from "@/types";
import type Rpc from "@/rpc/Rpc";
import { ethers } from "ethers";

export type InitHandshakeMessage =
    | "request"
    | "response"
    | "ack"
    | "response-timeout"
    | "ack-timeout"
    | "rejected"
    | "finalize-check"
    | "completed";

export type InitHandshakeDirection = "send" | "receive" | "local";

export type InitHandshakeLogArgs = {
    direction: InitHandshakeDirection;
    message: InitHandshakeMessage;
    challengeHash?: Hash;
    challengeInitTime?: number;
    messageTime?: number;
    responseTime?: number;
    rttSeconds?: number;
    timeDifferenceSeconds?: number;
    absoluteTimeDifferenceSeconds?: number;
    agreementTimeSeconds?: number;
    signerAddress?: string;
    preferredTransport?: TransportType;
    verifiedPeerAddress?: string;
    didReceiveAck?: boolean;
    remotePreferred?: TransportType;
    reason?: string;
};

export class LoggerUtils {
    private static readonly MESSAGE_TYPE_LABELS: Record<string, string> = {
        "0x9ce4e6bf06971600d59f74bebec9880ea91b2f4bdbfcc850572617eeaad2edc8":
            "JOIN_CHANNEL_MESSAGE",
        "0x7fc958f6d896a018ea54afc012524ea8e277a718198f19cfe9d7795f10efadae":
            "EXIT_CHANNEL_MESSAGE"
    };

    private static readonly TRANSPORT_DEBUG_IDS: WeakMap<ATransport, number> =
        new WeakMap();
    private static nextTransportDebugId = 1;

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

    static getRpcLogMetadata(rpc: Rpc): Rpc {
        return {
            service: rpc.service,
            method: rpc.method,
            params: rpc.params.map((param) => this.redactRpcParam(param))
        };
    }

    static getContractCallMetadata(data: Bytes, contractAddress?: Address) {
        const encodedData = ethers.hexlify(data);
        return {
            ...(contractAddress
                ? { contractAddress: contractAddress.toString() }
                : {}),
            functionSelector: encodedData.slice(0, 10),
            calldataBytes: ethers.dataLength(encodedData)
        };
    }

    private static redactRpcParam(param: any): any {
        if (!param || typeof param !== "object") return param;

        if ("encodedBlock" in param) {
            return {
                ...param,
                encodedBlock: this.getEncodedBlockLogMetadata(
                    param.encodedBlock
                )
            };
        }

        if (
            "signedBlock" in param &&
            param.signedBlock &&
            typeof param.signedBlock === "object" &&
            "encodedBlock" in param.signedBlock
        ) {
            return {
                ...param,
                signedBlock: {
                    ...param.signedBlock,
                    encodedBlock: this.getEncodedBlockLogMetadata(
                        param.signedBlock.encodedBlock
                    )
                }
            };
        }

        return param;
    }

    private static getEncodedBlockLogMetadata(encodedBlock: unknown) {
        return {
            redacted: true,
            byteLength:
                typeof encodedBlock === "string"
                    ? this.getHexByteLength(encodedBlock)
                    : undefined
        };
    }

    private static getHexByteLength(value: string): number | undefined {
        if (!/^0x[0-9a-fA-F]*$/.test(value)) return undefined;
        return (value.length - 2) / 2;
    }

    private static getTransportDebugId(transport: ATransport): string {
        const existing = this.TRANSPORT_DEBUG_IDS.get(transport);
        if (existing !== undefined) return `transport-${existing}`;

        const next = this.nextTransportDebugId++;
        this.TRANSPORT_DEBUG_IDS.set(transport, next);
        return `transport-${next}`;
    }

    static logDisputeInitiated(
        logger: Logger,
        dispute: DisputeStruct,
        fraudProofs: FraudProofStruct[]
    ): void {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        const formattedHash = this.formatHash(disputeHash);
        const fraudProofDetails = this.getFraudProofMetadata(fraudProofs);

        logger.warn(`🚨 Dispute: ${formattedHash}`, {
            dispute: this.getDisputeMetadata(dispute),
            fraudProofs: fraudProofDetails
        });
    }

    static logTimeoutDetected(
        logger: Logger,
        blockHeight: number,
        previousBlockOrSnapshot: BlockOrSnapshot,
        timeoutStruct: TimeoutStruct
    ): void {
        const block = previousBlockOrSnapshot.block
            ? this.getBlockMetadata(previousBlockOrSnapshot.block)
            : undefined;
        const snapshot = previousBlockOrSnapshot.stateSnapshot
            ? this.getSnapshotMetadata(previousBlockOrSnapshot.stateSnapshot)
            : undefined;
        logger.warn(`⏱️ Timeout @ block ${blockHeight}`, {
            timeoutStruct: this.getTimeoutStructMetadata(timeoutStruct),
            previousBlockOrSnapshot: block || snapshot
        });
    }

    static logSubjectiveTimeValidationSucceeded(
        logger: Logger,
        args: {
            block: Block;
            strategyName: string;
            validationPath: string;
            nowSeconds: number;
            agreementTimeSeconds: number;
        }
    ): void {
        const differenceSeconds = Math.abs(
            args.nowSeconds - args.block.timestamp
        );

        logger.info("Time validation succeeded - subjective", {
            checkType: "subjective",
            validationPath: args.validationPath,
            validatedRule: "abs(now - blockTimestamp) <= agreementTime",
            strategy: args.strategyName,
            forkId: args.block.forkId,
            blockHeight: args.block.height,
            author: args.block.author,
            nowSeconds: args.nowSeconds,
            blockTimestamp: args.block.timestamp,
            onChainTimestamp: args.block.onChainTimestamp,
            differenceSeconds,
            allowedSkewSeconds: args.agreementTimeSeconds,
            remainingSeconds: Math.max(
                0,
                args.agreementTimeSeconds - differenceSeconds
            )
        });
    }

    static logInitHandshakeMessage(
        logger: Logger,
        transport: ATransport,
        args: InitHandshakeLogArgs
    ): void {
        const localPeerAddress =
            transport.p2pManager.p2pSigner.signerAddress.toString();
        const knownRemotePeerAddress =
            args.signerAddress ||
            args.verifiedPeerAddress ||
            transport.peerAddress ||
            "unknown";
        const level: LogLevel =
            args.message === "ack-timeout" ||
            args.message === "response-timeout" ||
            args.message === "rejected"
                ? "warn"
                : "debug";

        logger[level]("Init handshake message", {
            ...this.getTransportMetadata(transport),
            direction: args.direction,
            message: args.message,
            localPeerAddress,
            knownRemotePeerAddress,
            transportDebugId: this.getTransportDebugId(transport),
            localTimeSeconds: Clock.getTimeInSeconds(),
            challengeHash: args.challengeHash
                ? this.formatHash(args.challengeHash, 8, 8)
                : undefined,
            challengeInitTime: args.challengeInitTime,
            messageTime: args.messageTime,
            responseTime: args.responseTime,
            rttSeconds: args.rttSeconds,
            timeDifferenceSeconds: args.timeDifferenceSeconds,
            absoluteTimeDifferenceSeconds: args.absoluteTimeDifferenceSeconds,
            agreementTimeSeconds: args.agreementTimeSeconds,
            signerAddress: args.signerAddress,
            preferredTransport:
                args.preferredTransport !== undefined
                    ? TransportType[args.preferredTransport]
                    : undefined,
            verifiedPeerAddress: args.verifiedPeerAddress,
            didReceiveAck: args.didReceiveAck,
            remotePreferred:
                args.remotePreferred !== undefined
                    ? TransportType[args.remotePreferred]
                    : undefined,
            reason: args.reason
        });
    }

    static async logTimestamp(
        logger: Logger,
        level: LogLevel = "info",
        timeConfig?: TimeConfig
    ): Promise<void> {
        const virtualClockBefore = Clock.getTimeInSeconds();
        const localClockBefore = Math.floor(new Date().getTime() / 1000);
        const { timestamp, blockNumber } = await Clock.getBlockchainTime();
        const virtualClockAfter = Clock.getTimeInSeconds();
        const localClockAfter = Math.floor(new Date().getTime() / 1000);
        const network = await Clock.getBlockchainNetwork();
        logger[level](`⏰ CLOCK:`, {
            virtualClockBefore,
            localClockBefore,
            blockchainTime: timestamp,
            blockNumber,
            virtualClockAfter,
            localClockAfter,
            network,
            timeConfig
        });
    }

    /**
     * Convenience helper for logging transport disconnects.
     * Extracts common metadata (peerAddress, channelId, forkId, transportType, logger) from transport.
     * This is a thin wrapper around logPeerDisconnected() to reduce call-site boilerplate.
     */
    static logTransportDisconnect(
        transport: ATransport,
        isInfoLevel = false
    ): void {
        const meta = this.getTransportMetadata(transport);
        const logger = transport.p2pManager.logger;

        logger[isInfoLevel ? "info" : "warn"]("🔌 Peer disconnected", {
            ...meta
        });
    }

    static logTransportReplacement(
        logger: Logger,
        oldTransport: ATransport,
        newTransport: ATransport,
        peerAddress: string
    ): void {
        logger.info("🔄 Transport upgrade", {
            oldTransport: this.getTransportMetadata(oldTransport),
            newTransport: this.getTransportMetadata(newTransport),
            peerAddress: this.formatHash(peerAddress)
        });
    }

    static getTransportMetadata(transport: ATransport) {
        const peerAddress = transport.peerAddress || "unknown";
        const stateManager = transport.p2pManager.stateManager;
        const transportType = TransportType[transport.transportType];

        return {
            peerAddress,
            transportType,
            channelId: stateManager.getChannelId(),
            forkId: stateManager.forkId.toString()
        };
    }
    static getBlockMetadata(block: Block, storage?: Storage) {
        const thresholdAddresses = new Set<Address>(
            storage?.getParticipantsUnion(block.coordinates) || []
        );
        const allSigners = block.allSignerAddresses;
        const allSignersSet =
            allSigners instanceof Set ? allSigners : new Set(allSigners || []);
        const didntSign = difference(thresholdAddresses, allSignersSet);
        return {
            author: String(block.author),
            blockHash: String(block.hash),
            stateSnapshotHash: String(block.stateSnapshotHash),
            blockHeight: block.height,
            timestamp: block.timestamp,
            onChainTimestamp: block.onChainTimestamp,
            allSigners: Array.from(allSignersSet),
            didntSign: Array.from(didntSign),
            numberOfInboundMessageBlocks: block.messageBlocks?.length ?? 0,
            forkId: String(block.forkId),
            channelId: String(block.channelId)
        };
    }

    static getBlockStructMetadata(blockStruct: BlockStruct) {
        const header = blockStruct.transaction.header;
        return {
            author: String(header.participant),
            blockHash: String(hash(Codec.encode(blockStruct, Type.Block))),
            blockHeight: Number(header.transactionCnt),
            timestamp: Number(header.timestamp),
            forkId: String(header.forkId),
            channelId: String(header.channelId),
            stateSnapshotHash: String(blockStruct.stateSnapshotHash),
            previousBlockHash: String(blockStruct.previousBlockHash),
            messageBlocks: blockStruct.messageBlocks.map((messageBlock) =>
                this.getMessageBlockMetadata(messageBlock)
            )
        };
    }

    static getBlockConfirmationStructMetadata(
        blockConfirmation: BlockConfirmationStruct
    ) {
        const blockStruct = Codec.decode(
            blockConfirmation.signedBlock.encodedBlock,
            Type.Block
        );

        return {
            blockConfirmationHash: String(
                hash(Codec.encode(blockConfirmation, Type.BlockConfirmation))
            ),
            ...this.getBlockStructMetadata(blockStruct),
            originalSignature: String(blockConfirmation.signedBlock.signature),
            confirmationSignatures: blockConfirmation.signatures.map(
                (signature) => String(signature)
            ),
            confirmationsCount: blockConfirmation.signatures.length
        };
    }

    static getSnapshotMetadata(stateSnapshot: StateSnapshot) {
        return {
            blockHeight: stateSnapshot.blockHeight,
            timestamp: stateSnapshot.timestamp,
            isGenesis: stateSnapshot.isGenesis,
            forkId: String(stateSnapshot.forkID),
            stateSnapshotHash: String(stateSnapshot.hash),
            snapshotData: this.getSnapshotDataMetadata(
                stateSnapshot.snapshotData
            )
        };
    }

    static getSnapshotDataMetadata(snapshotData: SnapshotDataStruct) {
        return {
            originForkId: String(snapshotData.originForkId),
            stateMachineStateHash: String(snapshotData.stateMachineStateHash),
            participants: snapshotData.participants.map((p) => String(p)),
            latestInboundMessageBlockHash: String(
                snapshotData.latestInboundMessageBlockHash
            ),
            latestInboundMessageBlockHeight: Number(
                snapshotData.latestInboundMessageBlockHeight ?? 0n
            ),
            latestOutboundMessageBlockHash: String(
                snapshotData.latestOutboundMessageBlockHash
            ),
            latestOutboundMessageBlockHeight: Number(
                snapshotData.latestOutboundMessageBlockHeight ?? 0n
            ),
            totalDeposits: {
                amount: Number(snapshotData.totalDeposits.amount),
                data: String(snapshotData.totalDeposits.data)
            },
            totalWithdrawals: {
                amount: Number(snapshotData.totalWithdrawals.amount),
                data: String(snapshotData.totalWithdrawals.data)
            }
        };
    }

    static getMessageBlockMetadata(messageBlock: MessageBlockStruct) {
        return {
            blockHash: String(
                hash(Codec.encode(messageBlock, Type.MessageBlock))
            ),
            blockHeight: Number(messageBlock.blockHeight),
            timestamp: Number(messageBlock.timestamp),
            messagesCount: messageBlock.messages.length,
            totalBalance: {
                amount: Number(messageBlock.totalBalance.amount),
                data: String(messageBlock.totalBalance.data)
            }
        };
    }

    static getMessageStructMeta(message: MessageStruct) {
        const messageType = String(message.messageType);
        const decodedMessageType = this.decodeMessageType(messageType);

        return {
            messageType,
            decodedMessageType,
            participant: String(message.participant),
            balance: {
                amount: Number(message.balance.amount),
                data: String(message.balance.data)
            },
            dataHash: String(hash(message.data)),
            dataLength: String(message.data).length
        };
    }

    static decodeMessageType(messageType: string): string {
        const normalized = messageType.toLowerCase();
        return (
            this.MESSAGE_TYPE_LABELS[normalized] ??
            this.MESSAGE_TYPE_LABELS[messageType] ??
            "UNKNOWN_MESSAGE_TYPE"
        );
    }

    static getReducedOutputMetadata(reducedOutput: ReduceOutputStruct) {
        return {
            latestBlock: this.getBlockStructMetadata(reducedOutput.latestBlock),
            slashedParticipants: reducedOutput.slashedParticipants.map((addr) =>
                String(addr)
            ),
            latestInboundMessageBlockHash: String(
                reducedOutput.latestInboundMessageBlockHash
            ),
            latestInboundMessageBlockHeight: Number(
                reducedOutput.latestInboundMessageBlockHeight
            ),
            timeout: this.getTimeoutStructMetadata(reducedOutput.timeout),
            selfRemovals: reducedOutput.selfRemovals.map((addr) => String(addr))
        };
    }

    static getStateProofMetadata(stateProof: StateProof) {
        const milestones = stateProof.milestones.map(
            (milestone, milestoneIndex) => ({
                milestoneIndex,
                confirmationsCount: milestone.blocks.length,
                confirmations: milestone.blocks.map((block) =>
                    this.getBlockMetadata(block)
                )
            })
        );
        const signedBlocks = stateProof.signedBlocks.map((block) =>
            this.getBlockMetadata(block)
        );
        const milestonesCount = milestones.length;
        const signedBlocksCount = signedBlocks.length;
        const latestBlockHeight =
            milestones.at(-1)?.confirmations.at(-1)?.blockHeight ??
            signedBlocks.at(-1)?.blockHeight ??
            0;
        return {
            latestBlockHeight,
            milestonesCount,
            signedBlocksCount,
            milestones,
            signedBlocks
        };
    }

    static getDisputeMetadata(dispute: DisputeStruct) {
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        const postedAuditingData = dispute.postedAuditingData;
        return {
            disputeHash,
            input: this.getDisputeInputMetadata(dispute.input),
            outputSnapshotDataHash: String(dispute.outputSnapshotDataHash),
            postedAuditingData
        };
    }

    static getDisputeInputMetadata(disputeInput: DisputeInputStruct) {
        return {
            channelId: String(disputeInput.channelId),
            forkId: String(disputeInput.forkId),
            latestStateSnapshotHash: String(
                disputeInput.latestStateSnapshotHash
            ),
            latestInboundMessageBlockHash: String(
                disputeInput.latestInboundMessageBlockHash
            ),
            lastInboundMessageBlockHeight: Number(
                disputeInput.lastInboundMessageBlockHeight
            ),
            onChainSlashes: disputeInput.onChainSlashes.map((addr) =>
                String(addr)
            ),
            disputeAuditingDataHash: String(
                disputeInput.disputeAuditingDataHash
            ),
            disputer: String(disputeInput.disputer),
            selfRemoval: disputeInput.selfRemoval,
            timeout: this.getTimeoutStructMetadata(disputeInput.timeout),
            stateProof: (() => {
                const sp = StateProof.tryFrom(disputeInput.stateProof);
                if (sp) return this.getStateProofMetadata(sp);
                return {
                    undecodable: true,
                    milestonesCount: disputeInput.stateProof.milestones.length,
                    signedBlocksCount:
                        disputeInput.stateProof.signedBlocks.length
                };
            })()
        };
    }

    static getAuditingMetadata(
        auditingData: DisputeAuditingDataStruct
    ): Record<string, any> {
        return {
            genesisStateSnapshotData: this.getSnapshotDataMetadata(
                auditingData.genesisStateSnapshotData
            ),
            latestStateSnapshot: this.getSnapshotMetadata(
                StateSnapshot.from(auditingData.latestStateSnapshot)
            ),
            milestoneSnapshots: auditingData.milestoneSnapshots.map(
                (snapshot) =>
                    this.getSnapshotMetadata(StateSnapshot.from(snapshot))
            ),
            latestFinalizedStateStateMachineStateHash: String(
                hash(auditingData.latestFinalizedStateStateMachineState || "0x")
            ),
            inboundMessageBlocks: auditingData.inboundMessageBlocks.map(
                (messageBlock) => this.getMessageBlockMetadata(messageBlock)
            ),
            outboundMessageBlocks: auditingData.outboundMessageBlocks.map(
                (messageBlock) => this.getMessageBlockMetadata(messageBlock)
            )
        };
    }

    static getTimeoutStructMetadata(timeout: TimeoutStruct) {
        return {
            timeoutParticipant: String(timeout.participant),
            timeoutBlockHeight: Number(timeout.blockHeight),
            minTimeStamp: Number(timeout.minTimeStamp),
            isForced: timeout.isForced,
            previousBlockProducer: String(timeout.previousBlockProducer),
            previousBlockProducerPostedCalldata:
                timeout.previousBlockProducerPostedCalldata,
            participantSignatureOnPreviousBlock: String(
                timeout.participantSignatureOnPreviousBlock
            )
        };
    }

    static getDisputeFraudProofMeta(
        disputeFraudProof: DisputeFraudProofStruct
    ) {
        let resolvedKillReason: DisputeFraudProofType | string | undefined;
        const proofType = disputeFraudProof.proofType;
        if (typeof proofType === "bigint") {
            resolvedKillReason = Number(proofType) as DisputeFraudProofType;
        } else if (typeof proofType === "number") {
            resolvedKillReason = proofType as DisputeFraudProofType;
        } else {
            resolvedKillReason = Number(proofType) as DisputeFraudProofType;
        }

        const killReasonStr =
            resolvedKillReason === undefined
                ? undefined
                : typeof resolvedKillReason === "string"
                  ? resolvedKillReason
                  : this.enumToString(
                        DisputeFraudProofType,
                        resolvedKillReason
                    );

        return {
            killReason: killReasonStr,
            participant: String(disputeFraudProof.participant),
            dispute: this.getDisputeMetadata(disputeFraudProof.dispute)
        };
    }

    static getFraudProofMetadata(fraudProofs: FraudProofStruct[]) {
        return fraudProofs.map((fp) => ({
            participant: fp.participant,
            proofType: this.formatProofType(
                typeof fp.proofType === "string"
                    ? Number(fp.proofType)
                    : fp.proofType
            )
        }));
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
