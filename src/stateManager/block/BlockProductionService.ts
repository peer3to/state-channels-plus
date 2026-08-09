import { ethers } from "ethers";

import {
    BlockConfirmationStruct,
    BlockStruct,
    MessageBlockStruct,
    SignedBlockStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import Clock from "@/Clock";
import { Block, StateSnapshot } from "@/models";
import { firstBlockGrace } from "@/types";
import { Hash, Timestamp } from "@/types/types";
import { Codec, Type, hash, Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

import type StateManager from "../StateManager";

/**
 * Authors blocks: applies the transaction to the local state machine, assembles
 * the resulting snapshot and block, signs it and commits it.
 */
export default class BlockProductionService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "BlockProduction" });
    }

    // Used when authoring a block - Executes the transaction and returns a signed block
    public async playTransaction(
        tx: TransactionStruct
    ): Promise<BlockConfirmationStruct> {
        const sm = this.stateManager;
        await sm.mutex.lock({ taskName: "playTransaction" });
        const message = await this.logPlayTransaction(tx);
        try {
            if (!sm.validationService.isChannelOpen(sm.forkId)) {
                throw new Error("Channel not open");
            }
            if (!(await this.isMyTurn())) {
                throw new Error("NOT MY TURN: " + message);
            }
            this.adjustTimestampIfNeeded(tx);

            const coordinates = {
                forkId: sm.forkId,
                height: Number(tx.header.transactionCnt)
            };
            const previousStateSnapshot =
                sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                    coordinates
                );
            const inboundMessageBlocks = this.getPendingInboundMessageBlocks(
                previousStateSnapshot
            );

            const invalidPendingInboundBlock =
                sm.validationService.findBrokenInboundMessageChainBlock(
                    previousStateSnapshot,
                    inboundMessageBlocks
                );
            if (invalidPendingInboundBlock) {
                throw new Error(
                    "Pending inbound message blocks do not form a valid chain"
                );
            }

            const assembled =
                await sm.snapshotAssemblyService.assembleFromTransaction(
                    coordinates,
                    tx,
                    previousStateSnapshot,
                    inboundMessageBlocks,
                    Number(tx.header.timestamp)
                );

            if (!assembled.success) {
                throw new Error(
                    "CreateAndApplyTransaction - Internal error - Transaction not successful"
                );
            }

            const {
                stateSnapshot,
                stateAfterInbound,
                successCallback,
                participantChanges,
                outboundMessageBlock
            } = assembled;

            const blockStruct = await this.createBlock(
                tx,
                stateSnapshot.hash,
                inboundMessageBlocks
            );

            const encodedBlock = Codec.encode(blockStruct, Type.Block);
            const blockHash = hash(encodedBlock);
            const signedBlock: SignedBlockStruct = {
                encodedBlock: encodedBlock,
                signature: await sm.p2pManager.p2pSigner.signMessage(
                    ethers.getBytes(blockHash)
                )
            };

            const block = Block.fromSignedBlock(signedBlock);

            await sm.blockCommitService.success(
                block,
                stateSnapshot,
                stateAfterInbound,
                successCallback,
                participantChanges,
                {
                    outboundMessageBlock
                }
            );

            const blockMeta = LoggerUtils.getBlockMetadata(block, sm.storage);
            this.logger.info(
                `playTransaction - success - ${blockMeta.blockHeight}`,
                {
                    block: blockMeta
                }
            );
            return block.blockConfirmationStruct;
        } finally {
            sm.mutex.unlock();
        }
    }

    private async isMyTurn(): Promise<boolean> {
        const nextToWrite =
            await this.stateManager.diamondStateMachine.getNextToWrite();
        return this.stateManager.signerAddress === nextToWrite;
    }

    private getPendingInboundMessageBlocks(
        previousStateSnapshot: StateSnapshot
    ): MessageBlockStruct[] {
        const previousHash =
            previousStateSnapshot.latestInboundMessageBlockHash;

        // a store still behind the snapshot has nothing pending - walking from
        // its head would run past previousHash and return the whole chain
        const head = this.stateManager.storage.inboundMessages.headNotBehind(
            previousHash,
            previousStateSnapshot.latestInboundMessageBlockHeight
        );
        if (head.hash === previousHash) {
            return [];
        }

        return this.stateManager.storage.inboundMessages.getMessageBlocksInRange(
            {
                upperBlockHash: head.hash,
                lowerBlockHash: previousHash ?? ethers.ZeroHash
            }
        );
    }

    private async logPlayTransaction(tx: TransactionStruct): Promise<string> {
        const sm = this.stateManager;
        const forkId = sm.forkId;
        const txHeight = Number(tx.header.transactionCnt);
        const nextToWrite = await sm.diamondStateMachine.getNextToWrite();
        const latestBlock = sm.storage.blocks.getLatestBlock(forkId);
        const latestStoredHeight = latestBlock?.height ?? null;
        const nextStoredHeight = sm.storage.blocks.getNextBlockHeight(forkId);
        const message =
            `playTransaction start: ` +
            ` - myAddress: ${String(sm.signerAddress)}` +
            ` - nextToWrite: ${String(nextToWrite)}` +
            ` - txHeight: #${txHeight}` +
            ` - latestStoredHeight: ${String(latestStoredHeight)}` +
            ` - nextStoredHeight: ${nextStoredHeight}` +
            ` - forkId: ${forkId}` +
            ` - Block timestamp: ${Number(tx.header.timestamp)}` +
            ` - Current timestamp: ${Clock.getTimeInSeconds()}`;
        this.logger.info(message);
        return message;
    }

    private adjustTimestampIfNeeded(tx: TransactionStruct): void {
        const sm = this.stateManager;
        const forkId = tx.header.forkId;
        const latestBlock = sm.storage.blocks.getLatestBlock(forkId);

        let previousTimestamp: Timestamp;
        let previousRelativeTimestamp: Timestamp;
        if (!latestBlock) {
            // No blocks yet - check against genesis snapshot timestamp
            const genesisSnapshot =
                sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
            if (!genesisSnapshot) {
                return; // No genesis snapshot yet, nothing to adjust against
            }
            previousTimestamp = genesisSnapshot.timestamp;
            previousRelativeTimestamp = genesisSnapshot.timestamp;
        } else {
            previousTimestamp = latestBlock.timestamp;
            previousRelativeTimestamp = latestBlock.getRelevantTimestamp(
                tx.header.participant
            );
        }

        const latestLocalTimestamp = Clock.getTimeInSeconds() + 1; // allow 1s of execution time

        if (latestLocalTimestamp > Number(tx.header.timestamp)) {
            this.logger.verbose(
                "Adjusting timestamp - reassigning to latest local time",
                {
                    forkId,
                    txTimestamp: Number(tx.header.timestamp),
                    latestLocalTimestamp,
                    diff: latestLocalTimestamp - Number(tx.header.timestamp),
                    newTimestamp: latestLocalTimestamp
                }
            );
            tx.header.timestamp = BigInt(latestLocalTimestamp);
        }

        if (Number(tx.header.timestamp) < previousTimestamp) {
            this.logger.verbose("Adjusting timestamp - was in the past", {
                forkId,
                txTimestamp: Number(tx.header.timestamp),
                previousTimestamp,
                diff: previousTimestamp - Number(tx.header.timestamp),
                newTimestamp: previousTimestamp
            });
            tx.header.timestamp = BigInt(previousTimestamp);
        }

        const graceSeconds = firstBlockGrace(
            sm.timeConfig,
            Number(tx.header.transactionCnt)
        );
        const maxTimestamp =
            previousRelativeTimestamp + graceSeconds + sm.timeConfig.p2pTime;

        if (Number(tx.header.timestamp) > maxTimestamp) {
            this.logger.verbose("Adjusting timestamp - was in the future", {
                forkId,
                txTimestamp: Number(tx.header.timestamp),
                previousRelativeTimestamp,
                firstBlockGrace: graceSeconds,
                p2pTime: sm.timeConfig.p2pTime,
                diff: Number(tx.header.timestamp) - maxTimestamp,
                newTimestamp: maxTimestamp
            });
            tx.header.timestamp = BigInt(maxTimestamp);
        }
    }

    private async createBlock(
        tx: TransactionStruct,
        stateSnapshotHash: Hash,
        messageBlocks: MessageBlockStruct[]
    ): Promise<BlockStruct> {
        const forkId = this.stateManager.forkId;
        const blockHeight = Number(tx.header.transactionCnt);

        let previousHash: Hash;

        const previousBlockOrSnapshot =
            this.stateManager.storage.getPreviousBlockOrSnapshot({
                forkId,
                height: blockHeight
            });

        if (previousBlockOrSnapshot.block) {
            previousHash = previousBlockOrSnapshot.block.hash;
        } else {
            previousHash = previousBlockOrSnapshot.stateSnapshot!.hash;
        }

        const blockStruct = {
            transaction: tx,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousHash,
            messageBlocks
        } as BlockStruct;

        return blockStruct;
    }
}
