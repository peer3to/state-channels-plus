import { ethers } from "ethers";

import type StateManager from "../StateManager";

import Clock from "@/Clock";
import { Block } from "@/models";
import {
    Address,
    BlockHeight,
    ForkId,
    Hash,
    UpdatedBlockWithCalldata
} from "@/types/types";
import { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Bytes } from "@/types/types";

export default class TimeoutController {
    constructor(private readonly stateManager: StateManager) {}

    public getTimeoutWaitTimeSeconds(): number {
        const { timeConfig } = this.stateManager;
        return (
            timeConfig.p2pTime +
            timeConfig.agreementTime +
            timeConfig.chainFallbackTime
        );
    }

    public async tryTimeoutParticipant(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address
    ): Promise<void> {
        const stateManager = this.stateManager;
        if (participantAddress === stateManager.signerAddress) {
            return;
        }

        // if a block exists in storage (regardless of signature on it) -> it was accepted
        const block = stateManager.storage.blocks.getBlock(forkId, blockHeight);
        if (block) {
            return;
        }

        const previousBlockOrSnapshot =
            stateManager.storage.getPreviousBlockOrSnapshot({
                forkId,
                height: blockHeight
            });

        // check is good time to timeout
        const previousRelevantTimestamp = previousBlockOrSnapshot.block
            ? previousBlockOrSnapshot.block.getRelevantTimestamp(
                  participantAddress
              )
            : previousBlockOrSnapshot.stateSnapshot!.timestamp;
        let differenceToWait =
            previousRelevantTimestamp +
            this.getTimeoutWaitTimeSeconds() -
            Clock.getTimeInSeconds();
        if (differenceToWait > 0) {
            stateManager.timeoutManager.scheduleTask(
                async () => {
                    await this.tryTimeoutParticipant(
                        forkId,
                        blockHeight,
                        participantAddress
                    );
                },
                differenceToWait * 1000,
                "timeoutParticipantDelayed"
            );
            return;
        }

        // (race condition) check if previous block producer posted calldata on-chain, granting this one extra time
        if (
            previousBlockOrSnapshot.block &&
            !previousBlockOrSnapshot.block.onChainTimestamp
        ) {
            const updatedPreviousBlock = await this.fetchUpdatedOnChainBlock(
                previousBlockOrSnapshot.block.forkId,
                previousBlockOrSnapshot.block.height,
                previousBlockOrSnapshot.block.author
            );
            if (updatedPreviousBlock?.onChainTimestamp) {
                differenceToWait =
                    updatedPreviousBlock.onChainTimestamp +
                    this.getTimeoutWaitTimeSeconds() -
                    Clock.getTimeInSeconds();
                if (differenceToWait > 0) {
                    stateManager.timeoutManager.scheduleTask(
                        async () => {
                            await this.tryTimeoutParticipant(
                                forkId,
                                blockHeight,
                                participantAddress
                            );
                        },
                        differenceToWait * 1000,
                        "timeoutParticipantDelayed"
                    );
                    return;
                }
            }
        }
        // no race condition on previous block on-chain callldata

        // (local) check if current block calldata slot is occupied on-chain
        let commitment =
            await stateManager.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                stateManager.channelId,
                forkId,
                blockHeight,
                participantAddress
            );
        if (commitment.found) {
            // commitment found, but block not accepted by BlockConfirmation pipeline -> proceed to timeout force
            await this.createTimeOutDispute(
                forkId,
                blockHeight,
                participantAddress,
                true
            );
            return;
        }

        // (race condition) check if current block posted on-chain
        const updatedBlock = await this.fetchUpdatedOnChainBlock(
            forkId,
            blockHeight,
            participantAddress
        );
        if (updatedBlock?.onChainTimestamp) {
            return; // block found and accepted
        }

        // Check locally again if fetchUpdatedOnChainBlock found a block -> local evm is synced
        commitment =
            await stateManager.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                stateManager.channelId,
                forkId,
                blockHeight,
                participantAddress
            );
        if (commitment.found) {
            // commitment exists on-chain, but block confirmation pipeline didn't accept it -> proceed to timeout force
            await this.createTimeOutDispute(
                forkId,
                blockHeight,
                participantAddress,
                true
            );
            return;
        }

        // block not found on-chain -> proceed to normal timeout
        await this.createTimeOutDispute(
            forkId,
            blockHeight,
            participantAddress,
            false
        );
    }

    private async createTimeOutDispute(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        isForced: boolean
    ): Promise<void> {
        const stateManager = this.stateManager;
        const previousBlockOrSnapshot =
            stateManager.storage.getPreviousBlockOrSnapshot({
                forkId,
                height: blockHeight
            });

        const previousBlock = previousBlockOrSnapshot.block;

        let previousBlockProducerPostedCalldata = false;
        if (previousBlock) {
            if (previousBlock.onChainTimestamp) {
                previousBlockProducerPostedCalldata = true;
            } else {
                previousBlockProducerPostedCalldata = (
                    await stateManager.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                        stateManager.channelId,
                        forkId,
                        previousBlock.height,
                        previousBlock.author
                    )
                ).found;
            }
        }

        const timeout: TimeoutStruct = {
            participant: participantAddress.toString(),
            blockHeight: BigInt(blockHeight),
            minTimeStamp: Clock.getTimeInSeconds(),
            isForced: isForced,
            previousBlockProducer: previousBlock
                ? previousBlock.author.toString()
                : ethers.ZeroAddress,
            previousBlockProducerPostedCalldata:
                previousBlockProducerPostedCalldata,
            participantSignatureOnPreviousBlock:
                (previousBlock?.findSignature(participantAddress) as Bytes) ||
                "0x"
        };

        stateManager.storage.timeout.storeTimeout(forkId, timeout);
        await stateManager.disputeManager.dispute(forkId);
    }

    public async fetchBlockCommitmentCalldata(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address,
        blockCommitment: Hash
    ): Promise<UpdatedBlockWithCalldata | undefined> {
        const stateManager = this.stateManager;
        try {
            const filter =
                stateManager.stateChannelManagerContract.filters.BlockCalldataPosted(
                    stateManager.channelId,
                    blockCommitment
                );

            const avgBlockTime = Clock.getAverageOnChainBlockTime();
            const maxTime = this.getTimeoutWaitTimeSeconds();
            const blocksToLookBack = Math.ceil(maxTime / avgBlockTime) * 2;

            const logs =
                await stateManager.stateChannelManagerContract.queryFilter(
                    filter,
                    -blocksToLookBack,
                    "latest"
                );

            if (logs.length === 0) {
                return undefined;
            }
            if (logs.length > 1) {
                throw new Error(
                    `Multiple logs found for commitment: ${blockCommitment} - logs: ${logs}`
                );
            }

            const signedBlock = {
                encodedBlock: logs[0].args.signedBlock.encodedBlock,
                signature: logs[0].args.signedBlock.signature
            };
            const timestamp = Number(logs[0].args.timestamp);

            await stateManager.eventHandler.onBlockCalldataPosted(
                stateManager.channelId,
                blockCommitment,
                blockAuthor,
                signedBlock,
                timestamp
            );

            const updatedBlock = stateManager.storage.blocks.getBlock(
                forkId,
                blockHeight
            );

            return {
                signedBlock,
                timestamp,
                updatedBlock: updatedBlock
            };
        } catch (error) {
            console.error(`StateManager-fetchBlockCommitmentCalldata:`, error);
            return undefined;
        }
    }

    public async fetchUpdatedOnChainBlock(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): Promise<Block | undefined> {
        const stateManager = this.stateManager;
        try {
            const commitmentResult =
                await stateManager.stateChannelManagerContract.getBlockCallDataCommitment(
                    stateManager.channelId,
                    forkId,
                    blockHeight,
                    blockAuthor
                );
            if (!commitmentResult.found) {
                return undefined;
            }
            return (
                await this.fetchBlockCommitmentCalldata(
                    forkId,
                    blockHeight,
                    blockAuthor,
                    commitmentResult.blockCalldataCommitment
                )
            )?.updatedBlock;
        } catch (error) {
            console.error(`StateManager-fetchUpdatedOnChainBlock:`, error);
            return undefined;
        }
    }
}
