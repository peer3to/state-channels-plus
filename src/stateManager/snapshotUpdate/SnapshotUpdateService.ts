import type StateManager from "../StateManager";
import { StateSnapshot } from "@/models";

import type { ForkId } from "@/types/types";
import { Logger } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { ethers } from "ethers";

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

    /**
     * Posts the latest state snapshot of `forkId` and resolves with it once
     * the post is mined; undefined when nothing can be posted yet. A chain
     * revert rejects with its custom error; the caller reads it.
     */
    public async postStateSnapshotWait(
        forkId: ForkId,
        options?: { forkAdoptionOnly?: boolean }
    ): Promise<StateSnapshot | undefined> {
        const submission = await this.submitStateSnapshot(forkId, options);
        if (!submission) return undefined;
        await submission.completion;
        return submission.expectedSnapshot;
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

    private async submitStateSnapshot(
        forkId: ForkId,
        options?: { forkAdoptionOnly?: boolean }
    ): Promise<SnapshotSubmission | undefined> {
        const forkData = await this.prepareUpdateStateSnapshotFork();
        const sameForkData: Omit<
            SameForkSnapshotUpdatePreparation,
            "milestoneProofs" | "milestoneSnapshots"
        > = options?.forkAdoptionOnly
            ? { canPost: true, callData: [], outboundMessageBlocks: [] }
            : await this.prepareUpdateSnapshotSameFork(
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

        // A revert rejects with its custom error; each caller reads the races
        // it expects (ReductionExecutor's fork adoption, the leave's post).
        const completion = this.stateManager.stateChannelManagerContract
            .multicall(callData)
            .then(async (response) => {
                try {
                    await response.wait();
                } catch (error) {
                    throw await this.withRevertData(error, callData);
                }
            });
        return { expectedSnapshot, completion };
    }

    /**
     * A post that passed its estimate and then reverted in its block (a
     * concurrent post landed first) has a receipt but no revert data, so
     * `tryDecodeCustomError` finds nothing. Replaying the same call on the
     * state that block left returns the error with its custom error; any
     * other failure, or a replay that names no custom error, stays as it was.
     *
     * Not `tryHandleEvmError`: it reports a revert through handlers instead
     * of returning it, resends the transaction when its replay passes, and
     * would make this service hold every caller's refusal names. Callers
     * read the custom error from the rejection (the leave's exit post, the
     * fork adoption), so this service only puts the revert data back.
     */
    private async withRevertData(
        error: unknown,
        callData: string[]
    ): Promise<unknown> {
        if (!ethers.isError(error, "CALL_EXCEPTION") || !error.receipt)
            return error;
        try {
            await this.stateManager.stateChannelManagerContract.multicall.staticCall(
                callData,
                { blockTag: error.receipt.blockNumber }
            );
        } catch (replayed) {
            if (tryDecodeCustomError(replayed)) return replayed;
        }
        return error;
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

            // a fork the chain reduced to final that this node has not
            // installed yet: nothing is postable until it is installed
            const genesisSnapshot =
                this.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    currentForkId
                );
            if (!genesisSnapshot) {
                this.logger.warn(
                    "State snapshot fork update is waiting for the local reduction",
                    { forkId: currentForkId }
                );
                return {
                    canPost: false,
                    callData: [],
                    outboundMessageBlocks: []
                };
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
                error: errorMessage(error)
            });
            throw error;
        }
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

            // No open channel on chain (closed, its snapshot deleted): no
            // snapshot can land, and the local blocks may not reach the
            // fork genesis, so nothing is prepared.
            if (preparationBaseSnapshot.forkID === ethers.ZeroHash) {
                this.logger.debug(
                    "No same-fork snapshot update: the channel is not open on chain",
                    { requestedForkId: forkId }
                );
                return {
                    canPost: false,
                    callData: [],
                    milestoneProofs: [],
                    milestoneSnapshots: [],
                    outboundMessageBlocks: []
                };
            }

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
                this.stateManager.storage.blocks.getLatestBlockHeight(forkId);
            // nothing at or above the base: no newer final point to post
            if (
                latestBlockHeight < 0 ||
                (canPost &&
                    latestBlockHeight < preparationBaseSnapshot.blockHeight)
            ) {
                return {
                    canPost,
                    callData: [],
                    milestoneProofs: [],
                    milestoneSnapshots: [],
                    outboundMessageBlocks: []
                };
            }
            // The proof of the latest final point, built from the local
            // diamond's anchor (a lagging mirror only lengthens it). Its target
            // is the snapshot the last milestone's first block commits to;
            // the unfinalized tail is never the target.
            const built =
                await this.stateManager.agreementManager.buildStateProof(
                    forkId,
                    latestBlockHeight,
                    { finalizedOnly: true }
                );
            const latestSnapshot = built.finalizedSnapshot;
            const milestoneProofs = built.stateProof.milestones;
            const milestoneSnapshots = built.evidence.milestoneSnapshots.map(
                (snapshot) => StateSnapshot.from(snapshot)
            );
            // no newer finalized point than the base: nothing to post
            if (
                !(await this.stateManager.stateChannelManagerContract.isSnapshotNewer(
                    latestSnapshot.toStruct(),
                    preparationBaseSnapshot.toStruct()
                ))
            ) {
                return {
                    canPost,
                    callData: [],
                    milestoneProofs: [],
                    milestoneSnapshots: [],
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

            // No inbound pre-check: the chain refuses a snapshot that has not
            // consumed its inbound head (RaceConditionPendingInboundNotConsumed),
            // and the post rejects with that error for the caller to read.
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
                    error: errorMessage(error)
                }
            );
            throw error;
        }
    }
}
