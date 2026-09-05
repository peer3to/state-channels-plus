import { ethers } from "ethers";

import type { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import Clock from "@/Clock";
import { timeoutWaitTime as timeoutWaitTimeSeconds } from "@/types";
import { Address, BlockHeight, Bytes, ForkId, Timestamp } from "@/types/types";
import { Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

import type StateManager from "../StateManager";

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
     * label so the scheduled work stays identifiable in the logs.
     */
    public scheduleCheck(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        delayMs: number,
        reason: string
    ): void {
        if (this.stateManager.isDisposed || this.stateManager.forkId !== forkId)
            return;
        this.stateManager.timeoutManager.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    forkId,
                    blockHeight,
                    participantAddress
                ),
            delayMs,
            `${reason} - fork ${forkId} - block ${blockHeight} - participant ${participantAddress}`
        );
    }

    // Tries to timeout a participant by checking did the participant fail to transition the state within time - if successful -> creates a dispute
    private async tryTimeoutParticipant(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address
    ): Promise<void> {
        const sm = this.stateManager;
        if (sm.isDisposed || sm.forkId !== forkId) return;
        if (participantAddress === sm.signerAddress) {
            return;
        }

        const participants = await sm.diamondStateMachine.getParticipants();
        if (
            sm.isDisposed ||
            sm.forkId !== forkId ||
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
                "timeoutParticipantDelayed"
            );
            return;
        }

        // A timeout added to an existing dispute window is judged against the
        // window's original creation time, not the new transaction timestamp.
        // Do not submit if that window opened before this timeout became valid;
        // the on-chain race-condition guard repeats this check authoritatively.
        const disputeWindowCreationTimestamp = Number(
            await sm.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                sm.channelId,
                forkId
            )
        );
        if (
            disputeWindowCreationTimestamp !== 0 &&
            disputeWindowCreationTimestamp < timeoutMinTimestamp
        ) {
            this.logger.info(
                "tryTimeoutParticipant - existing dispute window predates timeout deadline; not submitting",
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    disputeWindowCreationTimestamp,
                    timeoutMinTimestamp
                }
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
                    "previousOnChainBlockValidation"
                );
                return;
            }

            const matchingPreviousCalldata =
                sm.storage.blockCalldata.getMatchingBlockCalldata(
                    previousBlockOrSnapshot.block
                );
            if (matchingPreviousCalldata) {
                difference =
                    matchingPreviousCalldata.onChainTimestamp +
                    timeoutWaitTimeSeconds(sm.timeConfig, blockHeight) -
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
                        "timeoutParticipantDelayed"
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
            // Commitment found, but block not accepted by BlockConfirmation pipeline -> proceed no timeout force
            return await this.createTimeOutDispute(
                forkId,
                blockHeight,
                participantAddress,
                timeoutMinTimestamp,
                true
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
                "currentOnChainBlockValidation"
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
            // commitment exists on-chain, but block confirmation pipeline didn't accept it -> proceed no timeout force
            return await this.createTimeOutDispute(
                forkId,
                blockHeight,
                participantAddress,
                timeoutMinTimestamp,
                true
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
        reason: string
    ): void {
        this.scheduleCheck(
            forkId,
            blockHeight,
            participantAddress,
            1000,
            `timeoutParticipantAfterOnChainValidation - ${reason}`
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
        if (previousBlock) {
            if (previousBlock.onChainTimestamp) {
                previousBlockProducerPostedCalldata = true;
            } else {
                previousBlockProducerPostedCalldata = (
                    await sm.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                        sm.channelId,
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
            minTimeStamp: timeoutMinTimestamp,
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
            sm.isDisposed ||
            sm.forkId !== forkId ||
            sm.storage.blocks.getBlock(forkId, blockHeight)
        )
            return;

        // persist timeout locally
        sm.storage.timeout.storeTimeout(forkId, timeout);

        // Time has fully elapsed - create dispute immediately
        await sm.disputeManager.dispute(forkId);
    }
}
