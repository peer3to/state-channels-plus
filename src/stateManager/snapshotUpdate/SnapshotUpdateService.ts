import { ethers, TransactionResponse } from "ethers";

import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

import { StateSnapshot } from "@/models";
import type { ForkId } from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";
import {
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type StateManager from "../StateManager";

type SnapshotSubmission = {
    expectedSnapshot: StateSnapshot;
    completion: Promise<void>;
};

type ForkSnapshotUpdatePreparation = {
    canPost: boolean;
    callData: string[];
    expectedSnapshot?: StateSnapshot;
    outboundMessageBlocks: MessageBlockStruct[];
};

export type SameForkSnapshotUpdatePreparation = {
    canPost: boolean;
    callData: string[];
    expectedSnapshot?: StateSnapshot;
    milestoneProofs: MilestoneProofStruct[];
    milestoneSnapshots: StateSnapshot[];
    outboundMessageBlocks: MessageBlockStruct[];
};

export default class SnapshotUpdateService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "SnapshotUpdateService" });
    }

    public async postStateSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        const submission = await this.submitStateSnapshot(forkId);
        if (!submission) return undefined;

        DetachedPromises.collect(submission.completion);
        return submission.expectedSnapshot;
    }

    public async postStateSnapshotWait(
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        const submission = await this.submitStateSnapshot(forkId);
        if (!submission) return undefined;

        await submission.completion;
        return submission.expectedSnapshot;
    }

    private async submitStateSnapshot(
        forkId: ForkId
    ): Promise<SnapshotSubmission | undefined> {
        const forkData = await this.prepareUpdateStateSnapshotFork();
        const sameForkData = await this.prepareUpdateSnapshotSameFork(
            forkId,
            forkData.expectedSnapshot
        );

        const callData = [...forkData.callData, ...sameForkData.callData];
        const expectedSnapshot =
            sameForkData.expectedSnapshot ?? forkData.expectedSnapshot;

        // Preparation always runs to completion. `canPost` only controls
        // whether the resulting calldata is currently eligible for submission.
        if (!forkData.canPost || !sameForkData.canPost) return undefined;

        if (callData.length === 0) {
            this.logger.debug("No state snapshot updates needed");
            return undefined;
        }
        if (!expectedSnapshot) {
            throw new Error(
                "State snapshot calldata was prepared without an expected snapshot"
            );
        }

        this.logger.info(
            `Posting state snapshot on-chain for fork ${LoggerUtils.formatHash(forkId)}`,
            {
                expectedSnapshot:
                    LoggerUtils.getSnapshotMetadata(expectedSnapshot),
                forkData: {
                    canPost: forkData.canPost,
                    snapshot: forkData.expectedSnapshot
                        ? LoggerUtils.getSnapshotMetadata(
                              forkData.expectedSnapshot
                          )
                        : "N/A",
                    outboundMessageBlocks: forkData.outboundMessageBlocks
                        ? forkData.outboundMessageBlocks.map(
                              LoggerUtils.getMessageBlockMetadata
                          )
                        : "N/A"
                },
                sameForkData: {
                    canPost: sameForkData.canPost,
                    snapshot: sameForkData.expectedSnapshot
                        ? LoggerUtils.getSnapshotMetadata(
                              sameForkData.expectedSnapshot
                          )
                        : "N/A",
                    outboundMessageBlocks: sameForkData.outboundMessageBlocks
                        ? sameForkData.outboundMessageBlocks.map(
                              LoggerUtils.getMessageBlockMetadata
                          )
                        : "N/A"
                }
            }
        );

        let transactionResponse: TransactionResponse;
        const completion = this.stateManager.stateChannelManagerContract
            .multicall(callData)
            .then(async (response) => {
                transactionResponse = response;
                await response.wait();
            })
            .catch(async (error) => {
                const success = await tryHandleEvmError(error, {
                    tx: transactionResponse,
                    logger: this.logger,
                    signer: this.stateManager.signer,
                    forkId,
                    handlers: {
                        RaceConditionSnapshotForkMismatch: () => {
                            this.logger.warn(
                                "postStateSnapshot: snapshot fork mismatch — another peer's snapshot landed first",
                                { forkId }
                            );
                        },
                        RaceConditionBlockHeightTooOld: () => {
                            this.logger.warn(
                                "postStateSnapshot: block height too old — newer snapshot already on-chain",
                                { forkId }
                            );
                        },
                        RaceConditionPendingInboundNotConsumed: () => {
                            this.logger.error(
                                "postStateSnapshot: pending inbound not consumed by our snapshot",
                                { forkId }
                            );
                            throw new Error(
                                `postStateSnapshot: pending inbound not consumed for forkId=${forkId}`
                            );
                        },
                        RaceConditionReductionExpectationDoesntMatch: () => {
                            this.logger.error(
                                "postStateSnapshot: reduction already finalized to a different forkId",
                                { forkId }
                            );
                            throw new Error(
                                `postStateSnapshot: reduction already finalized to a different forkId for forkId=${forkId}`
                            );
                        }
                    }
                });
                if (success) return;
                const custom = tryDecodeCustomError(error);
                this.logger.error("Error posting state snapshot", {
                    custom,
                    error:
                        error instanceof Error ? error.message : String(error)
                });
                throw error;
            });
        return { expectedSnapshot, completion };
    }

    /**
     * Prepares data for updateStateSnapshotFork
     */
    private async prepareUpdateStateSnapshotFork(): Promise<ForkSnapshotUpdatePreparation> {
        try {
            // Get the current on-chain snapshot first
            const currentOnChainSnapshot = StateSnapshot.from(
                await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                    this.stateManager.channelId
                )
            );

            this.logger.debug("prepareUpdateStateSnapshotFork - start", {
                channelId: this.stateManager.channelId,
                onChainForkId: currentOnChainSnapshot.forkID,
                onChainBlockHeight: currentOnChainSnapshot.blockHeight,
                onChainLatestOutboundMessageBlockHash:
                    currentOnChainSnapshot.snapshotData
                        .latestOutboundMessageBlockHash
            });

            let currentForkId = currentOnChainSnapshot.forkID;
            // Traverse through dispute windows until we reach a fork with no disputes
            let isDisputed =
                await this.stateManager.stateChannelManagerContract.isForkDisputed(
                    this.stateManager.channelId,
                    currentForkId
                );

            this.logger.verbose(
                "prepareUpdateStateSnapshotFork - dispute status",
                {
                    forkId: currentForkId,
                    isDisputed
                }
            );

            if (!isDisputed) {
                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - fork not disputed; no update needed",
                    {
                        forkId: currentForkId
                    }
                );
                return {
                    canPost: true,
                    callData: [],
                    outboundMessageBlocks: []
                };
            }

            while (isDisputed) {
                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - traversing disputed fork",
                    {
                        forkId: currentForkId
                    }
                );
                const existingReducedResult =
                    await this.stateManager.stateChannelManagerContract.getReducedResult(
                        this.stateManager.channelId,
                        currentForkId
                    );
                if (existingReducedResult.reducedForkId === ethers.ZeroHash) {
                    this.logger.warn(
                        "State snapshot fork update is waiting for reduction",
                        { forkId: currentForkId }
                    );
                    return {
                        canPost: false,
                        callData: [],
                        outboundMessageBlocks: []
                    };
                }

                const challengePeriodExpired =
                    await this.stateManager.stateChannelManagerContract.isReduceChallengePeriodExpired(
                        this.stateManager.channelId,
                        currentForkId
                    );
                if (!challengePeriodExpired) {
                    this.logger.warn(
                        "State snapshot fork update is waiting for the reduction challenge period",
                        {
                            forkId: currentForkId,
                            reducedForkId: existingReducedResult.reducedForkId
                        }
                    );
                    return {
                        canPost: false,
                        callData: [],
                        outboundMessageBlocks: []
                    };
                }

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - reduced result is final; traversing",
                    {
                        fromForkId: currentForkId,
                        toForkId: existingReducedResult.reducedForkId
                    }
                );
                currentForkId = existingReducedResult.reducedForkId;
                isDisputed =
                    await this.stateManager.stateChannelManagerContract.isForkDisputed(
                        this.stateManager.channelId,
                        currentForkId
                    );

                this.logger.debug(
                    "prepareUpdateStateSnapshotFork - dispute status after traverse",
                    {
                        forkId: currentForkId,
                        isDisputed
                    }
                );
            }

            this.logger.debug(
                "prepareUpdateStateSnapshotFork - traversal complete",
                {
                    resolvedForkId: currentForkId,
                    resolvedForkIsDisputed: isDisputed
                }
            );

            // Get the genesis snapshot for the final resolved fork
            const genesisSnapshot =
                this.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    currentForkId
                );
            if (!genesisSnapshot) {
                throw new Error(
                    `No genesis snapshot found for fork ${currentForkId}`
                );
            }

            if (genesisSnapshot.forkID !== this.stateManager.forkId) {
                throw new Error(
                    `Fork mismatch: update will result in fork ${genesisSnapshot.forkID}, but target fork is ${this.stateManager.forkId}.`
                );
            }

            const { calldata: forkCalldata, outboundMessageBlocks } =
                this.buildForkSnapshotCalldata(
                    genesisSnapshot,
                    currentOnChainSnapshot
                );

            this.logger.debug(
                "prepareUpdateStateSnapshotFork - outbound message block range",
                {
                    forkId: currentForkId,
                    blocksCount: outboundMessageBlocks.length
                }
            );

            return {
                canPost: true,
                callData: [forkCalldata],
                expectedSnapshot: genesisSnapshot,
                outboundMessageBlocks
            };
        } catch (error) {
            this.logger.error("Error preparing update state snapshot fork", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    public buildForkSnapshotCalldata(
        reducedGenesisSnapshot: StateSnapshot,
        currentOnChainSnapshot: StateSnapshot
    ): { calldata: string; outboundMessageBlocks: MessageBlockStruct[] } {
        // reducedGenesisSnapshot is  newer than currentOnChainSnapshot,
        const outboundMessageBlocks =
            this.stateManager.storage.outboundMessages.getMessageBlocksInRange({
                lowerBlockHash:
                    currentOnChainSnapshot.latestOutboundMessageBlockHash,
                upperBlockHash:
                    reducedGenesisSnapshot.latestOutboundMessageBlockHash
            });
        const calldata =
            this.stateManager.stateChannelManagerContract.interface.encodeFunctionData(
                "updateStateSnapshotFork",
                [
                    this.stateManager.channelId,
                    reducedGenesisSnapshot.toStruct(),
                    outboundMessageBlocks
                ]
            );
        return { calldata, outboundMessageBlocks };
    }

    /**
     * Prepares data for updating the state snapshot when the fork is the same.
     */
    private async prepareUpdateSnapshotSameFork(
        forkId: ForkId,
        baseSnapshot?: StateSnapshot
    ): Promise<SameForkSnapshotUpdatePreparation> {
        try {
            // `baseSnapshot` is the snapshot that will be on-chain when this
            // calldata executes - in a multicall the fork update lands first,
            // so the same-fork update chains onto its expected result rather
            // than the raw current on-chain snapshot.
            // The fallback supports callers that prepare raw same-fork calldata
            // without first running the combined snapshot-post preparation.
            let preparationBaseSnapshot =
                baseSnapshot ??
                StateSnapshot.from(
                    await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                        this.stateManager.channelId
                    )
                );
            let canPost = true;

            // A locally reduced fork can have finalized milestones before its
            // fork snapshot reaches the chain. Use that fork's genesis as the
            // prospective base so callers can inspect the prepared update, but
            // keep canPost false: without preceding fork-update calldata this
            // same-fork update cannot yet be submitted independently.
            if (preparationBaseSnapshot.forkID !== forkId) {
                const resolvedBaseForkId = preparationBaseSnapshot.forkID;
                canPost = false;
                const genesisSnapshot =
                    this.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        forkId
                    );
                if (!genesisSnapshot) {
                    throw new Error(
                        `Genesis snapshot unavailable for fork ${forkId}`
                    );
                }
                preparationBaseSnapshot = genesisSnapshot;
                this.logger.debug(
                    "Preparing same-fork snapshot update from the local fork genesis",
                    {
                        requestedForkId: forkId,
                        resolvedBaseForkId
                    }
                );
            }

            const latestBlockHeight =
                this.stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;
            if (latestBlockHeight < 0) {
                return {
                    canPost,
                    callData: [],
                    milestoneProofs: [],
                    milestoneSnapshots: [],
                    outboundMessageBlocks: []
                };
            }
            const stateProof =
                await this.stateManager.agreementManager.getStateProof(
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
                    this.stateManager.agreementManager.getSnapshotFromMilestone(
                        milestoneProof
                    );
                if (!snapshot) {
                    throw new Error(
                        "Milestone built but corresponding snapshot not found"
                    );
                }

                if (
                    await this.stateManager.stateChannelManagerContract.isSnapshotNewer(
                        snapshot.toStruct(),
                        preparationBaseSnapshot.toStruct()
                    )
                ) {
                    milestoneProofs.push(milestoneProof);
                    milestoneSnapshots.push(snapshot);
                }
            }

            if (milestoneSnapshots.length === 0) {
                return {
                    canPost,
                    callData: [],
                    milestoneProofs,
                    milestoneSnapshots,
                    outboundMessageBlocks: []
                };
            }

            const latestSnapshot = milestoneSnapshots.at(-1)!;
            if (latestSnapshot.hash === preparationBaseSnapshot.hash) {
                return {
                    canPost,
                    callData: [],
                    milestoneProofs,
                    milestoneSnapshots,
                    outboundMessageBlocks: []
                };
            }

            // A same-fork update only applies within one fork.
            if (preparationBaseSnapshot.forkID !== latestSnapshot.forkID) {
                this.logger.debug(
                    "prepareUpdateSnapshotSameFork - base and latest snapshot on different forks, skipping",
                    {
                        baseForkId: preparationBaseSnapshot.forkID,
                        latestForkId: latestSnapshot.forkID
                    }
                );
                return {
                    canPost: false,
                    callData: [],
                    milestoneProofs: [],
                    milestoneSnapshots: [],
                    outboundMessageBlocks: []
                };
            }

            const channelBalance =
                await this.stateManager.stateChannelManagerContract.getChannelBalance(
                    this.stateManager.channelId
                );
            if (
                String(channelBalance.latestInboundMessageBlockHash) !==
                String(latestSnapshot.latestInboundMessageBlockHash)
            ) {
                this.logger.warn(
                    "Same-fork snapshot update is waiting for the latest inbound messages",
                    {
                        forkId,
                        onChainInboundMessageBlockHash:
                            channelBalance.latestInboundMessageBlockHash,
                        snapshotInboundMessageBlockHash:
                            latestSnapshot.latestInboundMessageBlockHash
                    }
                );
                return {
                    canPost: false,
                    callData: [],
                    milestoneProofs: [],
                    milestoneSnapshots: [],
                    outboundMessageBlocks: []
                };
            }

            const outboundMessageBlocks =
                this.stateManager.storage.outboundMessages.getMessageBlocksInRange(
                    {
                        lowerBlockHash:
                            preparationBaseSnapshot.snapshotData
                                .latestOutboundMessageBlockHash,
                        upperBlockHash:
                            latestSnapshot.snapshotData
                                .latestOutboundMessageBlockHash
                    }
                );
            const sameForkCalldata =
                this.stateManager.stateChannelManagerContract.interface.encodeFunctionData(
                    "updateStateSnapshotSameFork",
                    [
                        this.stateManager.channelId,
                        milestoneProofs,
                        milestoneSnapshots.map((snapshot) =>
                            snapshot.toStruct()
                        ),
                        outboundMessageBlocks
                    ]
                );

            return {
                canPost,
                callData: [sameForkCalldata],
                expectedSnapshot: latestSnapshot,
                milestoneProofs,
                milestoneSnapshots,
                outboundMessageBlocks
            };
        } catch (error) {
            this.logger.error(
                "Error preparing update snapshot for the same fork",
                {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            throw error;
        }
    }
}
