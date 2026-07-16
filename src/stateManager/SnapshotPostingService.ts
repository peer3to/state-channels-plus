import { ethers, TransactionResponse } from "ethers";
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import { StateSnapshot } from "@/models";
import { Codec, Type, DetachedPromises, Logger } from "@/utils";
import {
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { ForkId } from "@/types/types";
import type StateManager from "./StateManager";

export default class SnapshotPostingService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "SnapshotPosting" });
    }

    public async postStateSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        const forkData = await this.prepareUpdateStateSnapshotFork();
        const sameForkData = await this.prepareUpdateSnapshotSameFork(
            forkId,
            forkData?.expectedSnapshot
        );

        const expectedSnapshot =
            sameForkData?.expectedSnapshot ??
            forkData?.expectedSnapshot ??
            undefined;

        const callData: string[] = [
            ...(forkData?.callData ?? []),
            ...(sameForkData?.callData ?? [])
        ];

        if (callData.length > 0) {
            this.logger.info(
                `Posting state snapshot on-chain for fork ${LoggerUtils.formatHash(forkId)}`,
                {
                    expectedSnapshot: expectedSnapshot
                        ? LoggerUtils.getSnapshotMetadata(expectedSnapshot)
                        : "ERROR N/A",
                    forkData: {
                        snapshot: forkData?.expectedSnapshot
                            ? LoggerUtils.getSnapshotMetadata(
                                  forkData.expectedSnapshot
                              )
                            : "N/A",
                        outboundMessageBlocks: forkData?.outboundMessageBlocks
                            ? forkData.outboundMessageBlocks.map(
                                  LoggerUtils.getMessageBlockMetadata
                              )
                            : "N/A"
                    },
                    sameForkData: {
                        snapshot: sameForkData?.expectedSnapshot
                            ? LoggerUtils.getSnapshotMetadata(
                                  sameForkData.expectedSnapshot
                              )
                            : "N/A",
                        outboundMessageBlocks:
                            sameForkData?.outboundMessageBlocks
                                ? sameForkData.outboundMessageBlocks.map(
                                      LoggerUtils.getMessageBlockMetadata
                                  )
                                : "N/A"
                    }
                }
            );
            let transactionResponse: TransactionResponse;
            const txResponsePromise =
                this.stateManager.stateChannelManagerContract
                    .multicall(callData)
                    .then((txResponse) => {
                        transactionResponse = txResponse;
                        const txReceiptPromise = txResponse.wait();
                        DetachedPromises.collect(txReceiptPromise);
                        return txReceiptPromise;
                    })
                    .catch(async (error) => {
                        const success = await tryHandleEvmError(error, {
                            tx: transactionResponse!,
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
                                RaceConditionReductionExpectationDoesntMatch:
                                    () => {
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
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        });
                        throw error;
                    });
            DetachedPromises.collect(txResponsePromise);
            return expectedSnapshot;
        } else {
            this.logger.debug("No state snapshot updates needed");
            return undefined;
        }
    }

    /**
     * Prepares data for updating the state snapshot when the fork is the same
     */
    public async prepareUpdateSnapshotSameFork(
        forkId: ForkId,
        baseSnapshot?: StateSnapshot
    ): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshot;
              milestoneProofs: MilestoneProofStruct[];
              milestoneSnapshots: StateSnapshot[];
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
        try {
            // `baseSnapshot` is the snapshot that will be on-chain when this
            // calldata executes - in a multicall the fork update lands first,
            // so the same-fork update chains onto its expected result rather
            // than the raw current on-chain snapshot.
            const currentOnChainSnapshot =
                baseSnapshot ??
                StateSnapshot.from(
                    await this.stateManager.diamondStateMachine.localDiamondContract.getStateSnapshot(
                        this.stateManager.channelId
                    )
                );

            if (!currentOnChainSnapshot) {
                return undefined;
            }
            // Get the latest block height for this fork from storage
            const latestBlockHeight =
                this.stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

            // Get the state proof from AgreementManager
            const stateProof =
                await this.stateManager.agreementManager.getStateProof(
                    forkId,
                    latestBlockHeight
                );

            // Filter milestone proofs to only include those relevant for the transition from current on-chain state
            const milestoneProofs: MilestoneProofStruct[] = [];
            const milestoneSnapshots: StateSnapshot[] = [];

            for (const milestoneProof of stateProof.milestones) {
                if (milestoneProof.blockConfirmations.length === 0) {
                    throw new Error("Empty milestone proof found");
                }

                // Get the state snapshot
                const snapshot =
                    this.stateManager.agreementManager.getSnapshotFromMilestone(
                        milestoneProof
                    );
                if (!snapshot)
                    throw new Error(
                        "Milestone built but corresponding snapshot not found"
                    );

                if (
                    await this.stateManager.diamondStateMachine.localDiamondContract.isSnapshotNewer(
                        snapshot.toStruct(),
                        currentOnChainSnapshot.toStruct()
                    )
                ) {
                    milestoneProofs.push(milestoneProof);
                    milestoneSnapshots.push(snapshot);
                }
            }

            // No relevant milestones found
            if (milestoneSnapshots.length === 0) {
                return undefined;
            }

            const latestSnapshot =
                milestoneSnapshots[milestoneSnapshots.length - 1];

            // Latest snapshot is the same as current on-chain
            if (latestSnapshot.hash === currentOnChainSnapshot.hash) {
                return undefined;
            }

            // A same-fork update only applies within one fork. Local state
            // being on a newer fork than the chain is the normal design (the
            // local reduction always lands before its on-chain commit) - not
            // applicable now, retried once the chain catches up.
            if (currentOnChainSnapshot.forkID !== latestSnapshot.forkID) {
                this.logger.debug(
                    "prepareUpdateSnapshotSameFork - base and latest snapshot on different forks, skipping",
                    {
                        baseForkId: currentOnChainSnapshot.forkID,
                        latestForkId: latestSnapshot.forkID
                    }
                );
                return undefined;
            }

            const currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData
                    .latestOutboundMessageBlockHash;
            const latestLocalExitBlockHash =
                latestSnapshot.snapshotData.latestOutboundMessageBlockHash;
            const outboundMessageBlocks =
                this.stateManager.storage.outboundMessages.getMessageBlocksInRange(
                    {
                        upperBlockHash: latestLocalExitBlockHash,
                        lowerBlockHash: currentOnChainExitBlockHash
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

    /**
     * Prepares data for updateStateSnapshotFork
     */
    public async prepareUpdateStateSnapshotFork(): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshot;
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
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
            const callData: string[] = [];

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
                return undefined; // No fork update needed
            }

            while (isDisputed) {
                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - traversing disputed fork",
                    {
                        forkId: currentForkId
                    }
                );
                // If reduced result already exists on-chain, traverse to it
                const existingReducedResult =
                    await this.stateManager.stateChannelManagerContract.getReducedResult(
                        this.stateManager.channelId,
                        currentForkId
                    );
                // if reduceResult exists and is final
                if (existingReducedResult?.reducedForkId != ethers.ZeroHash) {
                    this.logger.verbose(
                        "prepareUpdateStateSnapshotFork - reduced result exists; traversing",
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

                    this.logger.verbose(
                        "prepareUpdateStateSnapshotFork - dispute status after traverse",
                        {
                            forkId: currentForkId,
                            isDisputed
                        }
                    );
                    continue;
                }

                // Fetch dispute commitments for this window
                const disputeCommitments =
                    await this.stateManager.stateChannelManagerContract.getWindowCommitments(
                        this.stateManager.channelId,
                        currentForkId
                    );

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - window commitments",
                    {
                        forkId: currentForkId,
                        commitmentsCount: disputeCommitments?.length ?? 0
                    }
                );
                if (!disputeCommitments || disputeCommitments.length === 0) {
                    // Nothing to reduce; wait for more data
                    this.logger.verbose(
                        "prepareUpdateStateSnapshotFork - no commitments; stopping traversal",
                        {
                            forkId: currentForkId
                        }
                    );
                    break;
                }

                // Build disputes from local storage confirmations
                const disputes: DisputeStruct[] = disputeCommitments.map(
                    (commitment) => {
                        const dispute =
                            this.stateManager.storage.disputes.getDispute(
                                commitment
                            );
                        if (!dispute) {
                            throw new Error(
                                `Missing Dispute in storage for dispute commitment ${commitment}`
                            );
                        }
                        return dispute;
                    }
                );

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - disputes built from storage",
                    {
                        forkId: currentForkId,
                        disputesCount: disputes.length
                    }
                );

                // Use proxy view to compute reduced output cheaply (no tx)
                const reducedOutput =
                    await this.stateManager.stateChannelManagerContract.reduce.staticCall(
                        disputes
                    );
                const reduceData =
                    await this.stateManager.agreementManager.getReduceData(
                        currentForkId,
                        reducedOutput
                    );

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - reduce data prepared",
                    {
                        forkId: currentForkId,
                        latestStateSnapshotForkId:
                            reduceData.latestStateSnapshot.forkId
                    }
                );

                const [snapshotData] =
                    await this.stateManager.diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                        currentForkId,
                        reducedOutput,
                        reduceData.latestStateSnapshot,
                        reduceData.encodedStateMachineState,
                        reduceData.inboundMessageBlocks
                    );
                const reducedForkId = ethers.keccak256(
                    Codec.encode(snapshotData, Type.SnapshotData)
                );

                const reduceAndFinalizeCalldata =
                    this.stateManager.stateChannelManagerContract.interface.encodeFunctionData(
                        "reduceAndFinalize",
                        [
                            disputes,
                            reduceData.latestStateSnapshot,
                            reduceData.encodedStateMachineState,
                            reduceData.inboundMessageBlocks,
                            reducedForkId
                        ]
                    );
                callData.push(reduceAndFinalizeCalldata);

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - reduced fork prepared",
                    {
                        fromForkId: currentForkId,
                        reducedForkId
                    }
                );

                // Traverse to the reduced fork
                currentForkId = reducedForkId;
                isDisputed =
                    await this.stateManager.stateChannelManagerContract.isForkDisputed(
                        this.stateManager.channelId,
                        currentForkId
                    );

                this.logger.debug(
                    "prepareUpdateStateSnapshotFork - dispute status after reduction",
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
                this.stateManager.buildForkSnapshotCalldata(
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

            callData.push(forkCalldata);

            if (callData.length === 0) {
                return undefined;
            }

            return {
                callData,
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
}
