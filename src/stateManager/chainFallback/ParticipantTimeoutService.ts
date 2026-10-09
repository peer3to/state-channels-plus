import type StateManager from "../StateManager";
import Clock from "@/Clock";

import { timeoutWaitTime as timeoutWaitTimeSeconds } from "@/types";
import { Address, BlockHeight, Bytes, ForkId, Timestamp } from "@/types/types";
import { Logger } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { StateChannelManagerInterface } from "@typechain-types";
import type { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ethers } from "ethers";

export const TIMEOUT_RECHECK_DELAY_MS = 1000;
// scheduleCheck reasons for a check re-armed after a refused timeout upload
export const EARLY_TIMEOUT_RECHECK_REASON =
    "timeoutParticipantAfterEarlySubmission";
export const MISMATCH_TIMEOUT_RECHECK_REASON =
    "timeoutParticipantAfterPreviousProducerMismatch";
// scheduleCheck reason when the predecessor posted during timeout construction
export const PREDECESSOR_POSTED_RECHECK_REASON =
    "timeoutParticipantAfterPredecessorPosted";
// scheduleCheck reason when the predecessor commitment read failed
export const CHAIN_READ_FAILED_RECHECK_REASON =
    "timeoutParticipantAfterChainReadFailure";

/**
 * Owns the participant-timeout check: schedules it, decides whether the
 * deadline really passed (including the on-chain calldata races that grant the
 * writer extra time), and turns a genuine timeout into a dispute.
 */
export default class ParticipantTimeoutService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "ParticipantTimeout" });
    }

    /**
     * Single owner for scheduling a timeout check. `reason` prefixes the task
     * label so the scheduled work stays identifiable in the logs. `isForced`
     * is set only by the pipeline rejecting the participant's posted block.
     */
    public scheduleCheck(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        delayMs: number,
        reason: string,
        isForced = false
    ): void {
        if (!this.stateManager.isActiveFork(forkId)) return;
        this.stateManager.timeoutManager.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    forkId,
                    blockHeight,
                    participantAddress,
                    isForced
                ),
            delayMs,
            `${reason} - fork ${forkId} - block ${blockHeight} - participant ${participantAddress}`
        );
    }

    // Tries to timeout a participant by checking did the participant fail to transition the state within time - if successful -> creates a dispute
    private async tryTimeoutParticipant(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        isForced = false
    ): Promise<void> {
        const sm = this.stateManager;
        if (!sm.isActiveFork(forkId)) return;
        if (participantAddress === sm.signerAddress) {
            return;
        }

        const participants = await sm.diamondStateMachine.getParticipants();
        if (
            !sm.isActiveFork(forkId) ||
            !participants.includes(sm.signerAddress)
        ) {
            return;
        }

        // if a block exist in storage (regardless of own signature on it) -> it was accepted
        const block = sm.storage.blocks.getBlock(forkId, blockHeight);
        if (block) {
            return;
        }

        const previousBlockOrSnapshot = sm.storage.getPreviousBlockOrSnapshot({
            forkId,
            height: blockHeight
        });
        // previous height not stored yet -> the check armed at that turn judges this one
        if (
            !previousBlockOrSnapshot.block &&
            !previousBlockOrSnapshot.stateSnapshot
        )
            return;
        // check is good time to timeout
        const previousRelevantTimestamp = previousBlockOrSnapshot.block
            ? previousBlockOrSnapshot.block.getRelevantTimestamp(
                  participantAddress
              )
            : previousBlockOrSnapshot.stateSnapshot!.timestamp;
        const timeoutWaitTime = timeoutWaitTimeSeconds(
            sm.timeConfig,
            blockHeight
        );
        const timeoutMinTimestamp = previousRelevantTimestamp + timeoutWaitTime;
        let difference = timeoutMinTimestamp - Clock.getTimeInSeconds();
        if (difference > 0) {
            this.logger.info(
                `tryTimeoutParticipant - rescheduling in (${difference}s)`,
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    difference,
                    previousRelevantTimestamp,
                    previousBlockOrSnapshot,
                    timeoutWaitTime
                }
            );
            this.scheduleCheck(
                forkId,
                blockHeight,
                participantAddress,
                difference * 1000,
                "timeoutParticipantDelayed",
                isForced
            );
            return;
        }

        // A timeout added to an existing dispute window is judged against the
        // window's original creation time, not the new transaction timestamp.
        // Do not submit if that window opened before this timeout became valid;
        // the on-chain race-condition guard repeats this check authoritatively.
        if (
            await this.doesWindowPredateTimeout(
                sm.diamondStateMachine.localDiamondContract,
                forkId,
                timeoutMinTimestamp
            )
        ) {
            this.logger.info(
                "tryTimeoutParticipant - existing dispute window predates timeout deadline; not submitting",
                { forkId, blockHeight, participantAddress, timeoutMinTimestamp }
            );
            return;
        }

        // (race condition) check did previous participant post on-chain granting this one extra time
        if (
            previousBlockOrSnapshot.block &&
            !previousBlockOrSnapshot.block.onChainTimestamp
        ) {
            const recovery =
                await sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    previousBlockOrSnapshot.block.forkId,
                    previousBlockOrSnapshot.block.height,
                    previousBlockOrSnapshot.block.author
                );

            if (recovery.validationScheduled) {
                this.logger.info(
                    "tryTimeoutParticipant - waiting for previous on-chain block validation",
                    {
                        forkId,
                        blockHeight,
                        participantAddress,
                        previousBlock: LoggerUtils.getBlockMetadata(
                            previousBlockOrSnapshot.block,
                            sm.storage
                        ),
                        validationScheduled: recovery.validationScheduled
                    }
                );
                this.scheduleTimeoutParticipantRetry(
                    forkId,
                    blockHeight,
                    participantAddress,
                    "previousOnChainBlockValidation",
                    isForced
                );
                return;
            }

            const matchingPreviousCalldata =
                sm.storage.blockCalldata.getMatchingBlockCalldata(
                    previousBlockOrSnapshot.block
                );
            // a writer that signed the predecessor gains no time from its post
            if (
                matchingPreviousCalldata &&
                !previousBlockOrSnapshot.block.findSignature(participantAddress)
            ) {
                difference =
                    matchingPreviousCalldata.onChainTimestamp +
                    timeoutWaitTime -
                    Clock.getTimeInSeconds();
                if (difference > 0) {
                    // There's a chance that the on-chain timestamp will not persist if the BlockConfirmation pipeline didn't decide to persist the block since most likely the calldata is junk
                    // This is not a problem since on the next run difference < 0 -> force timeout
                    // Only inefficiency is we'd querry the RPC node for calldata for this 2 times in the case of a force timeout like this
                    this.logger.info(
                        `tryTimeoutParticipant - after fetching, rescheduling in (${difference}s)`,
                        {
                            forkId,
                            blockHeight,
                            participantAddress,
                            difference,
                            previousBlock: previousBlockOrSnapshot.block,
                            timeoutWaitTime
                        }
                    );
                    this.scheduleCheck(
                        forkId,
                        blockHeight,
                        participantAddress,
                        difference * 1000,
                        "timeoutParticipantDelayed",
                        isForced
                    );
                    return;
                }
            }
        }
        // No race condition on previous block on-chain calldata

        // (local) check if current block calldata slot is occupied on-chain
        let commitment =
            await sm.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                sm.channelId,
                forkId,
                blockHeight,
                participantAddress
            );
        if (commitment.found) {
            // Commitment found, but block not accepted by BlockConfirmation pipeline
            return await this.onPostedCommitment(
                forkId,
                blockHeight,
                participantAddress,
                timeoutMinTimestamp,
                isForced
            );
        }

        // (race condition) check if current block posted on-chain
        const recovery =
            await sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                forkId,
                blockHeight,
                participantAddress
            );
        // calldata in hand without a query means the pipeline is already in
        // flight -> re-check, never time out a participant who did post
        if (recovery.validationScheduled || recovery.blockCalldata) {
            this.logger.info(
                "tryTimeoutParticipant - waiting for current on-chain block validation",
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    validationScheduled: recovery.validationScheduled
                }
            );
            this.scheduleTimeoutParticipantRetry(
                forkId,
                blockHeight,
                participantAddress,
                "currentOnChainBlockValidation",
                isForced
            );
            return;
        }

        const updatedBlock = sm.storage.blocks.getBlock(forkId, blockHeight);
        if (updatedBlock?.onChainTimestamp) {
            return; // block found and accepted
        }
        // Check locally again - if scheduled on-chain validation found a block -> local evm is synced
        commitment =
            await sm.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                sm.channelId,
                forkId,
                blockHeight,
                participantAddress
            );
        if (commitment.found) {
            // commitment exists on-chain, but block confirmation pipeline didn't accept it
            return await this.onPostedCommitment(
                forkId,
                blockHeight,
                participantAddress,
                timeoutMinTimestamp,
                isForced
            );
        }
        // block not found on-chain -> normal timeout
        return await this.createTimeOutDispute(
            forkId,
            blockHeight,
            participantAddress,
            timeoutMinTimestamp,
            false
        );
    }

    private scheduleTimeoutParticipantRetry(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        reason: string,
        isForced: boolean
    ): void {
        this.scheduleCheck(
            forkId,
            blockHeight,
            participantAddress,
            TIMEOUT_RECHECK_DELAY_MS,
            `timeoutParticipantAfterOnChainValidation - ${reason}`,
            isForced
        );
    }

    /**
     * A plain check hands the posted block back so the pipeline judges it; a
     * rejection requests the forced check. A forced timeout is slashable
     * unless it names the writer at the next height.
     */
    private async onPostedCommitment(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        timeoutMinTimestamp: Timestamp,
        isForced: boolean
    ): Promise<void> {
        const sm = this.stateManager;
        if (!isForced) {
            this.logger.info(
                "tryTimeoutParticipant - posted block handed to the pipeline",
                { forkId, blockHeight, participantAddress }
            );
            const posted = sm.storage.blockCalldata.getBlockCalldata(
                forkId,
                blockHeight,
                participantAddress
            );
            if (posted) await sm.blockQueueManager.ingestPostedBlock(posted);
            return;
        }
        const isWritersTurn = await sm.withMutex(
            async () =>
                sm.storage.blocks.getNextBlockHeight(forkId) === blockHeight &&
                (await sm.diamondStateMachine.getNextToWrite()) ===
                    participantAddress,
            { taskName: "forced timeout writer check" }
        );
        if (!isWritersTurn) return;
        await this.createTimeOutDispute(
            forkId,
            blockHeight,
            participantAddress,
            timeoutMinTimestamp,
            true
        );
    }

    private async createTimeOutDispute(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        timeoutMinTimestamp: Timestamp,
        isForced: boolean = false
    ): Promise<void> {
        const sm = this.stateManager;
        const previousBlockOrSnapshot = sm.storage.getPreviousBlockOrSnapshot({
            forkId,
            height: blockHeight
        });

        const previousBlock = previousBlockOrSnapshot.block;
        let previousBlockProducerPostedCalldata = false;
        let postedMinimum: Timestamp | undefined;
        try {
            // the chain judges the claim, so read the predecessor's post there
            if (previousBlock)
                previousBlockProducerPostedCalldata = (
                    await sm.stateChannelManagerContract.getBlockCallDataCommitment(
                        sm.channelId,
                        forkId,
                        previousBlock.height,
                        previousBlock.author
                    )
                ).found;
            // a post not applied here moves the deadline unless the writer signed it
            if (
                previousBlock &&
                previousBlockProducerPostedCalldata &&
                !previousBlock.onChainTimestamp &&
                !previousBlock.findSignature(participantAddress)
            ) {
                const post = sm.storage.blockCalldata.getBlockCalldata(
                    forkId,
                    previousBlock.height,
                    previousBlock.author
                );
                postedMinimum =
                    post &&
                    post.onChainTimestamp +
                        timeoutWaitTimeSeconds(sm.timeConfig, blockHeight);
                const remainingMs = postedMinimum
                    ? (postedMinimum - Clock.getTimeInSeconds()) * 1000
                    : 0;
                // post not recovered yet or its deadline still ahead -> check again
                if (!postedMinimum || remainingMs > 0) {
                    this.scheduleCheck(
                        forkId,
                        blockHeight,
                        participantAddress,
                        Math.max(TIMEOUT_RECHECK_DELAY_MS, remainingMs),
                        PREDECESSOR_POSTED_RECHECK_REASON,
                        isForced
                    );
                    return;
                }
                // the mirror may not have the window yet, so ask the chain
                if (
                    await this.doesWindowPredateTimeout(
                        sm.stateChannelManagerContract,
                        forkId,
                        Math.max(timeoutMinTimestamp, postedMinimum)
                    )
                ) {
                    this.logger.info(
                        "createTimeOutDispute - existing dispute window predates the moved deadline; not submitting",
                        {
                            forkId,
                            blockHeight,
                            participantAddress,
                            postedMinimum
                        }
                    );
                    return;
                }
            }
        } catch (error) {
            this.logger.warn(
                "createTimeOutDispute - chain read failed; rechecking",
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    error: errorMessage(error)
                }
            );
            this.scheduleCheck(
                forkId,
                blockHeight,
                participantAddress,
                TIMEOUT_RECHECK_DELAY_MS,
                CHAIN_READ_FAILED_RECHECK_REASON,
                isForced
            );
            return;
        }

        const timeout: TimeoutStruct = {
            participant: participantAddress.toString(),
            blockHeight: BigInt(blockHeight),
            minTimeStamp: Math.max(timeoutMinTimestamp, postedMinimum ?? 0),
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

        LoggerUtils.logTimeoutDetected(
            this.logger,
            blockHeight,
            previousBlockOrSnapshot,
            timeout
        );

        if (
            !sm.isActiveFork(forkId) ||
            sm.storage.blocks.getBlock(forkId, blockHeight)
        )
            return;

        // persist timeout locally
        sm.storage.timeout.storeTimeout(forkId, timeout);

        // Time has fully elapsed - create dispute immediately
        await sm.disputeManager.dispute(forkId);
    }

    // whether a dispute window on the fork opened before the timeout became valid
    private async doesWindowPredateTimeout(
        contract: StateChannelManagerInterface,
        forkId: ForkId,
        timeoutMinTimestamp: Timestamp
    ): Promise<boolean> {
        const disputeWindowCreationTimestamp = Number(
            await contract.getDisputeWindowCreationTimestamp(
                this.stateManager.channelId,
                forkId
            )
        );
        return (
            disputeWindowCreationTimestamp !== 0 &&
            disputeWindowCreationTimestamp < timeoutMinTimestamp
        );
    }
}
