import { ethers } from "ethers";

import type StateManager from "../StateManager";

import Clock from "@/Clock";
import { Codec, Type } from "@/utils";
import { ForkId } from "@/types/types";
import {
    DisputeStruct,
    ReduceOutputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { SnapshotDataStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export default class ReductionController {
    constructor(private readonly stateManager: StateManager) {}

    public setReductionTimeout(forkId: ForkId, triggerTimestamp: number) {
        const {
            reductionTriggerMap,
            timeoutManager,
            forkId: currentForkId
        } = this.stateManager;
        const reductionHandle = reductionTriggerMap.get(forkId);
        if (
            currentForkId === forkId &&
            (!reductionHandle ||
                reductionHandle.triggerTimestamp < triggerTimestamp)
        ) {
            if (reductionHandle) clearTimeout(reductionHandle.handle);
            const delayInMilliseconds =
                (triggerTimestamp - Clock.getTimeInSeconds()) * 1000;
            const newHandle = setTimeout(async () => {
                await this.tryReduce(forkId, triggerTimestamp);
            }, delayInMilliseconds);
            reductionTriggerMap.set(forkId, {
                handle: newHandle,
                triggerTimestamp: triggerTimestamp
            });
        }
    }

    public async tryReduce(
        forkId: ForkId,
        genesisTimestamp: number
    ): Promise<void> {
        const stateManager = this.stateManager;
        if (stateManager.forkId !== forkId) return; // we're not on this fork anymore

        const localDiamond =
            stateManager.diamondStateMachine.localDiamondContract;
        const channelId = stateManager.channelId;
        const stateChannelManager = stateManager.stateChannelManagerContract;

        // check locally can we reduce
        let [canReduce, _timeRemaining] =
            await localDiamond.isKillPeriodExpired(channelId, forkId);
        let timeRemaining = Number(_timeRemaining);
        let checkedOnRpcNode = false;

        if (!canReduce) {
            // come back later - new evidence was submitted
            if (timeRemaining > 0) {
                this.setReductionTimeout(
                    forkId,
                    Clock.getTimeInSeconds() + timeRemaining
                );
                return;
            }

            // timeRemaining is 0, but not expired -> means window locally is not opened (not synced) -> check on-chain
            [canReduce, _timeRemaining] =
                await stateChannelManager.isKillPeriodExpired(
                    channelId,
                    forkId
                );
            checkedOnRpcNode = true;
            timeRemaining = Number(_timeRemaining);

            // now check with updated data
            if (!canReduce) {
                if (timeRemaining > 0) {
                    this.setReductionTimeout(
                        forkId,
                        Clock.getTimeInSeconds() + timeRemaining
                    );
                    return;
                }
                // on-chain timeRemaining is 0, but not expired -> not opened -> we shouldn't be here
                throw new Error(
                    "StateManager - setReductionTimeout - time to reduce, but window not opened on-chain"
                );
            }
        }
        // ^ the above code is an optimization to try to save compute on the RPC node

        // double check on-chain can we reduce
        if (!checkedOnRpcNode) {
            [canReduce, _timeRemaining] =
                await stateChannelManager.isKillPeriodExpired(
                    channelId,
                    forkId
                );
            checkedOnRpcNode = true;
            timeRemaining = Number(_timeRemaining);
            if (!canReduce) {
                if (timeRemaining > 0) {
                    this.setReductionTimeout(
                        forkId,
                        Clock.getTimeInSeconds() + timeRemaining
                    );
                    return;
                }
                // on-chain timeRemaining is 0, but not expired -> not opened -> we shouldn't be here
                throw new Error(
                    "StateManager - setReductionTimeout - time to reduce, but window not opened on-chain"
                );
            }
        }
        // reduce on-chain
        const disputeConfirmations =
            await stateManager.agreementManager.getForkDisputeConfirmations(
                channelId,
                forkId,
                stateChannelManager
            );
        const disputes = disputeConfirmations.map(
            (dc) =>
                Codec.decode(
                    dc.signedDispute.encodedDispute,
                    Type.Dispute
                ) as DisputeStruct
        );
        let reducedOutput: ReduceOutputStruct;
        try {
            reducedOutput =
                await stateChannelManager.reduce.staticCall(disputes);
        } catch (error) {
            // this should never be the case since:
            // 1) disputeWindow is expired - double checked on-chain
            // 2) dispute commitments collected on-chain - we for sure have the correct data
            // 3) even if someone else reduces on-chain -> they would have to reduce to the same output, so race condition is not a problem
            stateManager.logger.error("tryReduce failed", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }

        const reduceData = await stateManager.agreementManager.getReduceData(
            forkId,
            reducedOutput
        );

        stateChannelManager
            .reduceAndFinalize(
                disputes,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.joinChannelBlocks
            )
            .then((tx) => tx.wait())
            .catch((error) => {
                // This has to run async so everyone starts building imediately after successful simulation -> so they don't waste time
                // if this errors here - in the honest case it should never - even under race condition it should succeed gracefully
                // TODO - interpret the error and panic
                throw new Error("reduceAndFinalize error " + error);
            });
        // if we're here the fork SHOULD BECOME successfully finalized on-chain and we can start building on top of it

        // locally compute what will be finalized on-chain
        const [snapshotData, encodedStateMachineState, exitChannelBlock] =
            await localDiamond.reduceOutputToSnapshotData.staticCall(
                forkId,
                reducedOutput,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.joinChannelBlocks
            );
        const reducedForkId = ethers.keccak256(
            Codec.encode(snapshotData, Type.SnapshotData)
        );

        stateManager.setGenesisState(
            snapshotData as SnapshotDataStruct,
            encodedStateMachineState,
            reducedForkId,
            genesisTimestamp,
            exitChannelBlock
        );
    }
}
