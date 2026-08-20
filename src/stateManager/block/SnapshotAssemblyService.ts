import {
    BalanceStruct,
    MessageBlockStruct,
    MessageStruct,
    StateSnapshotStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import { BlockCoordinates, StateSnapshot } from "@/models";
import { Address, Bytes, Hash, Timestamp } from "@/types/types";
import { Codec, Type, difference, hash, Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

import type StateManager from "../StateManager";

// diff of the participant set across one block: who a transition removed and added
export type ParticipantChanges = {
    left: Set<Address>;
    joined: Set<Address>;
};

/**
 * Assembles the resulting snapshot for a block: consumes pending inbound
 * message blocks, applies them to the state machine, builds the outbound
 * message block, and diffs the participant set. Shared by the authoring path
 * (`BlockProductionService.playTransaction`) and the ingest path
 * (`BlockIngestService.onBlockConfirmation`).
 */
export default class SnapshotAssemblyService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "SnapshotAssembly" });
    }

    /**
     * The assembly sequence both pipelines share: apply the transaction, apply
     * the inbound blocks, diff the participant set and build the resulting
     * snapshot. The authoring and validating side must compute the snapshot
     * identically or every block fails its hash check - this method is the one
     * owner of that sequence. Happy path only: every guard and failure policy
     * stays with the caller.
     */
    public async assembleFromTransaction(
        coordinates: BlockCoordinates,
        tx: TransactionStruct,
        previousStateSnapshot: StateSnapshot,
        inboundMessageBlocks: MessageBlockStruct[],
        timestamp: Timestamp
    ): Promise<
        | { success: false }
        | {
              success: true;
              successCallback: () => void;
              stateAfterInbound: Bytes;
              participantChanges: ParticipantChanges;
              stateSnapshot: StateSnapshot;
              outboundMessageBlock?: MessageBlockStruct;
          }
    > {
        const {
            success,
            encodedState,
            successCallback,
            outboundMessages,
            participantsBefore
        } = await this.applyTransaction(tx);

        if (!success) {
            return { success: false };
        }

        const { encodedState: stateAfterInbound } =
            await this.applyInboundMessageBlocksToState(
                inboundMessageBlocks,
                previousStateSnapshot.snapshotData.totalDeposits,
                encodedState
            );

        const finalParticipants =
            await this.stateManager.diamondStateMachine.getParticipants();
        const participantChanges = this.computeParticipantChanges(
            participantsBefore,
            finalParticipants
        );

        const { stateSnapshot, outboundMessageBlock } =
            await this.createStateSnapshot(
                hash(stateAfterInbound),
                coordinates,
                timestamp,
                outboundMessages,
                inboundMessageBlocks,
                finalParticipants
            );

        return {
            success: true,
            successCallback,
            stateAfterInbound,
            participantChanges,
            stateSnapshot,
            outboundMessageBlock
        };
    }

    public getPreviousStateSnapshotOrThrow(
        coordinates: BlockCoordinates
    ): StateSnapshot {
        const previousStateSnapshot =
            this.stateManager.storage.getPreviousStateSnapshot(coordinates);
        if (!previousStateSnapshot)
            throw new Error(
                "createStateSnapshot for block - previousStateSnapshot undefined"
            );
        return previousStateSnapshot;
    }

    //Applies a transaction to the state machine and returns the encoded state with a success callback
    private async applyTransaction(transaction: TransactionStruct): Promise<{
        success: boolean;
        encodedState: Bytes;
        successCallback: () => void;
        outboundMessages: MessageStruct[];
        participantsBefore: Address[];
    }> {
        const participantsBefore =
            await this.stateManager.diamondStateMachine.getParticipants();
        const { success, successCallback, outboundMessages } =
            await this.stateManager.diamondStateMachine.stateTransition(
                transaction
            );
        const encodedState =
            await this.stateManager.diamondStateMachine.getState();

        return {
            success,
            encodedState,
            successCallback,
            outboundMessages,
            participantsBefore
        };
    }

    private async createStateSnapshot(
        stateMachineStateHash: Hash,
        coordinates: BlockCoordinates,
        timestamp: Timestamp,
        outboundMessages: MessageStruct[],
        inboundMessageBlocks: MessageBlockStruct[],
        participants: Address[]
    ): Promise<{
        stateSnapshot: StateSnapshot;
        outboundMessageBlock?: MessageBlockStruct;
    }> {
        const previousStateSnapshot =
            this.getPreviousStateSnapshotOrThrow(coordinates);
        const previousSnapshotData = previousStateSnapshot.snapshotData;
        let latestInboundMessageBlockHash =
            previousSnapshotData.latestInboundMessageBlockHash;
        let totalDeposits = previousSnapshotData.totalDeposits;
        const originForkId = previousSnapshotData.originForkId;

        let { latestOutboundMessageBlockHash, totalWithdrawals } =
            previousSnapshotData;
        let latestOutboundMessageBlockHeight = BigInt(
            previousSnapshotData.latestOutboundMessageBlockHeight ?? 0n
        );
        let latestInboundMessageBlockHeight = BigInt(
            previousSnapshotData.latestInboundMessageBlockHeight ?? 0n
        );
        if (inboundMessageBlocks.length > 0) {
            const lastInboundBlock =
                inboundMessageBlocks[inboundMessageBlocks.length - 1];
            latestInboundMessageBlockHash = hash(
                Codec.encode(lastInboundBlock, Type.MessageBlock)
            );
            latestInboundMessageBlockHeight = BigInt(
                lastInboundBlock.blockHeight ?? latestInboundMessageBlockHeight
            );
            totalDeposits = lastInboundBlock.totalBalance;
        }

        let outboundMessageBlock: MessageBlockStruct | undefined;

        if (outboundMessages.length > 0) {
            totalWithdrawals = await this.calculateTotalBalance(
                outboundMessages,
                totalWithdrawals
            );

            latestOutboundMessageBlockHeight =
                latestOutboundMessageBlockHeight + 1n;

            outboundMessageBlock = {
                previousBlockHash: latestOutboundMessageBlockHash,
                blockHeight: latestOutboundMessageBlockHeight,
                messages: outboundMessages,
                totalBalance: totalWithdrawals,
                timestamp: BigInt(timestamp)
            };

            latestOutboundMessageBlockHash = hash(
                Codec.encode(outboundMessageBlock, Type.MessageBlock)
            );
        }

        const stateSnapshot: StateSnapshotStruct = {
            forkId: coordinates.forkId,
            blockHeight: BigInt(coordinates.height),
            timestamp: timestamp,
            snapshotData: {
                originForkId,
                stateMachineStateHash: stateMachineStateHash,
                participants,
                latestInboundMessageBlockHash,
                latestInboundMessageBlockHeight,
                latestOutboundMessageBlockHash,
                latestOutboundMessageBlockHeight,
                totalDeposits,
                totalWithdrawals
            }
        };
        this.logger.debug(`Creating state snapshot #${coordinates.height}`, {
            args: {
                stateMachineStateHash,
                coordinates,
                timestamp,
                outboundMessagesLength: outboundMessages.length,
                outboundMessages: outboundMessages.map((message) =>
                    LoggerUtils.getMessageStructMeta(message)
                ),
                inboundMessageBlocksLength: inboundMessageBlocks.length,
                participants
            },
            previousSnapshotHash: previousStateSnapshot.hash,
            latestInboundMessageBlockHash,
            latestInboundMessageBlockHeight:
                latestInboundMessageBlockHeight.toString(),
            latestOutboundMessageBlockHash,
            latestOutboundMessageBlockHeight:
                latestOutboundMessageBlockHeight.toString(),
            totalDeposits: totalDeposits.toString(),
            totalWithdrawals: totalWithdrawals.toString(),
            stateSnapshot: LoggerUtils.getSnapshotMetadata(
                StateSnapshot.from(stateSnapshot)
            ),
            outboundMessageBlock: outboundMessageBlock
                ? LoggerUtils.getMessageBlockMetadata(outboundMessageBlock)
                : "",
            previousSnapshot: LoggerUtils.getSnapshotMetadata(
                previousStateSnapshot
            )
        });
        return {
            stateSnapshot: StateSnapshot.from(stateSnapshot),
            outboundMessageBlock
        };
    }

    private async applyInboundMessageBlocksToState(
        inboundMessageBlocks: MessageBlockStruct[],
        totalDeposits: BalanceStruct,
        encodedState: Bytes
    ): Promise<{ encodedState: Bytes; totalDeposits: BalanceStruct }> {
        let updatedTotalDeposits = totalDeposits;

        if (inboundMessageBlocks.length === 0) {
            return {
                encodedState,
                totalDeposits: updatedTotalDeposits
            };
        }

        for (const messageBlock of inboundMessageBlocks) {
            this.logger.debug(
                `Applying inbound message block at height ${messageBlock.blockHeight} to state machine`
            );
            for (const message of messageBlock.messages) {
                this.logger.debug(
                    `Processing inbound message of type ${LoggerUtils.decodeMessageType(String(message.messageType))}`
                );
                const processed =
                    await this.stateManager.diamondStateMachine.processInboundMessage(
                        message
                    );
                if (!processed) {
                    throw new Error("Failed to process inbound message");
                }
                updatedTotalDeposits =
                    await this.stateManager.diamondStateMachine.addBalance(
                        updatedTotalDeposits,
                        message.balance
                    );
            }
        }

        const updatedEncodedState =
            await this.stateManager.diamondStateMachine.getState();

        return {
            encodedState: updatedEncodedState,
            totalDeposits: updatedTotalDeposits
        };
    }

    private computeParticipantChanges(
        previousParticipants: Address[],
        finalParticipants: Address[]
    ): ParticipantChanges {
        const previousSet = new Set(previousParticipants);
        const finalSet = new Set(finalParticipants);

        return {
            left: difference(previousSet, finalSet),
            joined: difference(finalSet, previousSet)
        };
    }

    private async calculateTotalBalance(
        balances: { balance: BalanceStruct }[],
        initialTotal?: BalanceStruct
    ): Promise<BalanceStruct> {
        let total =
            initialTotal ??
            (await this.stateManager.diamondStateMachine.getZeroBalance());

        for (const balance of balances) {
            total = await this.stateManager.diamondStateMachine.addBalance(
                total,
                balance.balance
            );
        }

        return total;
    }
}
