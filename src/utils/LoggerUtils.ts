import {
    DisputeStruct,
    TimeoutStruct,
    StateProofStruct,
    DisputeInputStruct,
    DisputeAuditingDataStruct,
    ReduceOutputStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    DisputeFraudProofStruct,
    FraudProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, Type } from "./Codec";
import { difference, hash } from "@/utils";
import { Address, BlockOrSnapshot, Hash } from "@/types/types";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { Logger } from "@/utils";
import { TransportType } from "@/transport/TransportType";
import ATransport from "@/transport/ATransport";
import { Block, StateSnapshot } from "@/models";
import Storage from "@/storage";
import {
    MessageStruct,
    MessageBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { LogLevel } from "./logging/Logger";
export class LoggerUtils {
    private static readonly MESSAGE_TYPE_LABELS: Record<string, string> = {
        "0x9ce4e6bf06971600d59f74bebec9880ea91b2f4bdbfcc850572617eeaad2edc8":
            "JOIN_CHANNEL_MESSAGE",
        "0x7fc958f6d896a018ea54afc012524ea8e277a718198f19cfe9d7795f10efadae":
            "EXIT_CHANNEL_MESSAGE"
    };

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

    static async logTimestamp(
        logger: Logger,
        level: LogLevel = "info"
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
            network
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
            storage?.getParticipants(block.coordinates) || []
        );
        const allSigners = block.allSignerAddresses;
        const allSignersSet =
            allSigners instanceof Set ? allSigners : new Set(allSigners || []);
        const didntSign = difference(thresholdAddresses, allSignersSet);
        return {
            author: String(block.author),
            blockHash: String(block.hash),
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

    static getStateProofMetadata(stateProof: StateProofStruct) {
        const milestones = stateProof.milestones.map(
            (milestone, milestoneIndex) => ({
                milestoneIndex,
                confirmationsCount: milestone.blockConfirmations.length,
                confirmations: milestone.blockConfirmations.map(
                    (confirmation) =>
                        this.getBlockMetadata(
                            Block.fromBlockConfirmation(confirmation)
                        )
                )
            })
        );

        const signedBlocks = stateProof.signedBlocks.map((signedBlock) =>
            this.getBlockMetadata(Block.fromSignedBlock(signedBlock))
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
        return {
            disputeHash,
            input: this.getDisputeInputMetadata(dispute.input),
            outputSnapshotDataHash: String(dispute.outputSnapshotDataHash)
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
            stateProof: this.getStateProofMetadata(disputeInput.stateProof)
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
            latestStateStateMachineStateHash: String(
                hash(auditingData.latestStateStateMachineState)
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
