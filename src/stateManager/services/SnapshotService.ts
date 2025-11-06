import type StateManager from "../StateManager";

import { StateSnapshot } from "@/models";
import { Codec, Type, isCustomEvmError } from "@/utils";
import { ForkId } from "@/types/types";
import { ExitChannelBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export interface SameForkSnapshotData {
    milestoneProofs: MilestoneProofStruct[];
    milestoneSnapshots: StateSnapshot[];
    exitChannelBlocks: ExitChannelBlockStruct[];
}

export interface SnapshotForkData {
    genesisSnapshot: StateSnapshot;
    exitBlocks: ExitChannelBlockStruct[];
}

export default class SnapshotService {
    constructor(private readonly stateManager: StateManager) {}

    public async postStateSnapshot(forkId: ForkId): Promise<void> {
        const stateManager = this.stateManager;
        const stateChannelManager = stateManager.stateChannelManagerContract;

        const currentOnChainSnapshot = StateSnapshot.from(
            await stateChannelManager.getStateSnapshot(stateManager.channelId)
        );

        if (currentOnChainSnapshot.forkId === forkId) {
            const sameForkData =
                await this.prepareUpdateSnapshotSameFork(forkId);
            if (sameForkData) {
                try {
                    const txResponse =
                        await stateChannelManager.updateStateSnapshotSameFork(
                            stateManager.channelId,
                            sameForkData.milestoneProofs,
                            sameForkData.milestoneSnapshots.map((snapshot) =>
                                snapshot.toStruct()
                            ),
                            sameForkData.exitChannelBlocks
                        );
                    await txResponse.wait();
                } catch (error) {
                    this.handleSnapshotError(
                        error,
                        "Error posting state snapshot"
                    );
                    throw error;
                }
            } else {
                stateManager.logger.debug("No state snapshot updates needed");
            }
            return;
        }

        const forkData = await this.prepareUpdateStateSnapshotFork();
        const sameForkData = await this.prepareUpdateSnapshotSameFork(forkId);

        const callData: string[] = [];
        if (forkData) {
            if (forkData.genesisSnapshot.forkId === forkId) {
                const forkCalldata =
                    stateChannelManager.interface.encodeFunctionData(
                        "updateStateSnapshotFork",
                        [
                            stateManager.channelId,
                            forkData.genesisSnapshot.toStruct(),
                            forkData.exitBlocks
                        ]
                    );
                callData.push(forkCalldata);
            } else {
                throw new Error(
                    `Fork mismatch: update will result in fork ${forkData.genesisSnapshot.forkId}, but target fork is ${forkId}.`
                );
            }
        }
        if (sameForkData) {
            const sameForkCalldata =
                stateChannelManager.interface.encodeFunctionData(
                    "updateStateSnapshotSameFork",
                    [
                        stateManager.channelId,
                        sameForkData.milestoneProofs,
                        sameForkData.milestoneSnapshots.map((snapshot) =>
                            snapshot.toStruct()
                        ),
                        sameForkData.exitChannelBlocks
                    ]
                );
            callData.push(sameForkCalldata);
        }

        if (callData.length > 0) {
            try {
                const txResponse =
                    await stateChannelManager.multicall(callData);
                await txResponse.wait();
            } catch (error) {
                this.handleSnapshotError(error, "Error posting state snapshot");
                throw error;
            }
        } else {
            stateManager.logger.debug("No state snapshot updates needed");
        }
    }

    public async prepareUpdateSnapshotSameFork(
        forkId: ForkId
    ): Promise<SameForkSnapshotData | undefined> {
        const stateManager = this.stateManager;
        try {
            const stateChannelManager =
                stateManager.stateChannelManagerContract;
            const currentOnChainSnapshot = StateSnapshot.from(
                await stateChannelManager.getStateSnapshot(
                    stateManager.channelId
                )
            );

            const latestBlockHeight =
                stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

            const stateProof =
                await stateManager.agreementManager.getStateProof(
                    forkId,
                    latestBlockHeight
                );

            const milestoneProofs: MilestoneProofStruct[] = [];
            const milestoneSnapshots: StateSnapshot[] = [];

            for (const milestoneProof of stateProof.milestones) {
                if (milestoneProof.blockConfirmations.length === 0) {
                    throw new Error("Empty milestone proof found");
                }

                const snapshot =
                    stateManager.agreementManager.getSnapshotFromMilestone(
                        milestoneProof
                    );
                if (!snapshot)
                    throw new Error(
                        "Milestone built but corresponding snapshot not found"
                    );

                // Only include milestones that are newer than the current on-chain block height
                if (snapshot.blockHeight > currentOnChainSnapshot.blockHeight) {
                    milestoneProofs.push(milestoneProof);
                    milestoneSnapshots.push(snapshot);
                }
            }

            if (milestoneSnapshots.length === 0) {
                return undefined;
            }

            const latestSnapshot =
                milestoneSnapshots[milestoneSnapshots.length - 1];

            if (
                latestSnapshot.blockHeight ===
                currentOnChainSnapshot.blockHeight
            ) {
                return undefined;
            }

            if (currentOnChainSnapshot.forkId !== latestSnapshot.forkId) {
                throw new Error(
                    `Fork mismatch: current fork ${currentOnChainSnapshot.forkId}, new fork ${latestSnapshot.forkId}`
                );
            }

            const currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData.latestExitChannelBlockHash;
            const latestLocalExitBlockHash =
                latestSnapshot.snapshotData.latestExitChannelBlockHash;
            const exitChannelBlocks =
                stateManager.storage.exitChannelBlocks.getBlocksInRange(
                    latestLocalExitBlockHash,
                    currentOnChainExitBlockHash
                );

            return {
                milestoneProofs,
                milestoneSnapshots,
                exitChannelBlocks
            };
        } catch (error) {
            stateManager.logger.error(
                "Error preparing update snapshot for the same fork",
                {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            throw error;
        }
    }

    public async prepareUpdateStateSnapshotFork(): Promise<
        SnapshotForkData | undefined
    > {
        const stateManager = this.stateManager;
        try {
            const stateChannelManager =
                stateManager.stateChannelManagerContract;
            const currentOnChainSnapshot = StateSnapshot.from(
                await stateChannelManager.getStateSnapshot(
                    stateManager.channelId
                )
            );

            let currentForkId = currentOnChainSnapshot.forkId;
            let isDisputed = await stateChannelManager.isForkDisputed(
                stateManager.channelId,
                currentForkId
            );

            if (!isDisputed) {
                return undefined;
            }

            const genesisSnapshot =
                stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    currentForkId
                );
            if (!genesisSnapshot) {
                throw new Error(
                    `No genesis snapshot found for fork ${currentForkId}`
                );
            }

            while (isDisputed) {
                // If reduced result exists on-chain, traverse to it
                const existingReducedResult =
                    await stateChannelManager.getReducedResult(
                        stateManager.channelId,
                        currentForkId
                    );
                // If reduceResult exists and is final
                if (existingReducedResult[0]) {
                    currentForkId = existingReducedResult[0];
                    isDisputed = await stateChannelManager.isForkDisputed(
                        stateManager.channelId,
                        currentForkId
                    );
                    continue;
                }

                // Fetch dispute commitments for this window
                const disputeCommitments =
                    await stateChannelManager.getWindowCommitments(
                        stateManager.channelId,
                        currentForkId
                    );
                if (!disputeCommitments || disputeCommitments.length === 0) {
                    // Nothing to reduce; wait for more data
                    break;
                }

                // Build disputes from local storage confirmations
                const disputes: DisputeStruct[] = [];
                for (const commitment of disputeCommitments) {
                    const confirmation =
                        stateManager.storage.disputes.getDisputeConfirmation(
                            commitment
                        );
                    if (!confirmation) {
                        throw new Error(
                            `Missing Data Availability for dispute commitment ${commitment}`
                        );
                    }
                    const dispute = Codec.decode(
                        confirmation.signedDispute.encodedDispute,
                        Type.Dispute
                    ) as DisputeStruct;
                    disputes.push(dispute);
                }

                const reducedOutput =
                    await stateChannelManager.reduce.staticCall(disputes);

                const reduceData =
                    await stateManager.agreementManager.getReduceData(
                        currentForkId,
                        reducedOutput
                    );

                // Reduce and finalize on-chain to obtain the reduced forkId
                try {
                    const txResponse =
                        await stateChannelManager.reduceAndFinalize(
                            disputes,
                            reduceData.latestStateSnapshot,
                            reduceData.encodedStateMachineState,
                            reduceData.joinChannelBlocks
                        );
                    await txResponse.wait();
                } catch (error) {
                    if (
                        isCustomEvmError(error) &&
                        error.errorDescription.name !==
                            "ErrorDisputeAlreadyReduced"
                    ) {
                        throw error;
                    }
                }

                // Read canonical reduced result from chain and traverse
                const reducedResult =
                    await stateChannelManager.getReducedResult(
                        stateManager.channelId,
                        currentForkId
                    );

                // Traverse to the reduced fork
                currentForkId = reducedResult[0];
                isDisputed = await stateChannelManager.isForkDisputed(
                    stateManager.channelId,
                    currentForkId
                );
            }

            let latestExitBlockHash =
                genesisSnapshot.snapshotData.latestExitChannelBlockHash;
            const currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData.latestExitChannelBlockHash;
            const exitBlocks =
                stateManager.storage.exitChannelBlocks.getBlocksInRange(
                    latestExitBlockHash,
                    currentOnChainExitBlockHash
                );

            return {
                genesisSnapshot,
                exitBlocks
            };
        } catch (error) {
            stateManager.logger.error(
                "Error preparing update state snapshot fork",
                {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            throw error;
        }
    }

    private handleSnapshotError(error: unknown, message: string) {
        const stateManager = this.stateManager;
        if (isCustomEvmError(error)) {
            stateManager.logger.error(message, {
                errorDescription: error.errorDescription
            });
        } else {
            stateManager.logger.error(message, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}
