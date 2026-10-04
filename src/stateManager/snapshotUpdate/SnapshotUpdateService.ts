import type StateManager from "../StateManager";
import { StateSnapshot } from "@/models";

import type { ForkId } from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import {
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { ethers, TransactionResponse } from "ethers";

/**
 * Why a snapshot post cannot go out now: the fork's reduction has not landed,
 * its challenge period runs, the chain holds an inbound message the latest
 * snapshot has not consumed, or the fork itself is not the chain's yet.
 */
type SnapshotPostBlockReason =
    | "reduction"
    | "challenge-period"
    | "inbound"
    | "fork-not-posted";

/** No update is needed, or one is blocked. */
type SnapshotPostIdle =
    | { kind: "nothing" }
    | { kind: "blocked"; reason: SnapshotPostBlockReason };

export type SnapshotSubmission =
    | {
          kind: "posted";
          expectedSnapshot: StateSnapshot;
          completion: Promise<boolean>;
      }
    | SnapshotPostIdle;

/** One update call; `expectedSnapshot` is the chain's snapshot once it lands. */
type SnapshotUpdateCall = {
    kind: "ready";
    callData: string;
    expectedSnapshot: StateSnapshot;
    outboundMessageBlocks: MessageBlockStruct[];
};

type ForkSnapshotUpdatePreparation = SnapshotUpdateCall | SnapshotPostIdle;

export type SameForkSnapshotUpdatePreparation =
    | (SnapshotUpdateCall & { milestoneSnapshots: StateSnapshot[] })
    | SnapshotPostIdle;

export default class SnapshotUpdateService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "SnapshotUpdateService" });
    }

    public async postStateSnapshot(
        forkId: ForkId,
        options?: { forkAdoptionOnly?: boolean }
    ): Promise<StateSnapshot | undefined> {
        const submission = await this.submitStateSnapshot(forkId, options);
        switch (submission.kind) {
            case "posted":
                DetachedPromises.collect(submission.completion);
                return submission.expectedSnapshot;
            case "nothing":
            case "blocked":
                return undefined;
        }
    }

    /**
     * Resolves false when the chain refused the post on a disputed fork, and
     * when the same-fork update cannot be posted because the chain holds an
     * inbound message the latest snapshot has not consumed: only a dispute,
     * whose replay applies that message, can move such a fork on.
     */
    public async postStateSnapshotWait(
        forkId: ForkId,
        options?: { forkAdoptionOnly?: boolean }
    ): Promise<boolean> {
        const submission = await this.submitStateSnapshot(forkId, options);
        switch (submission.kind) {
            case "posted":
                return submission.completion;
            case "nothing":
                return true;
            case "blocked":
                return submission.reason !== "inbound";
        }
    }

    private async submitStateSnapshot(
        forkId: ForkId,
        options?: { forkAdoptionOnly?: boolean }
    ): Promise<SnapshotSubmission> {
        const forkData = await this.prepareUpdateStateSnapshotFork();
        if (forkData.kind === "blocked") return forkData;
        const sameForkData: SameForkSnapshotUpdatePreparation =
            options?.forkAdoptionOnly
                ? { kind: "nothing" }
                : await this.prepareUpdateSnapshotSameFork(
                      forkId,
                      forkData.kind === "ready"
                          ? forkData.expectedSnapshot
                          : undefined
                  );
        if (sameForkData.kind === "blocked") return sameForkData;

        // the fork update lands first; the same-fork update chains onto it
        const calls = [forkData, sameForkData].filter(
            (data) => data.kind === "ready"
        );
        const expectedSnapshot = calls.at(-1)?.expectedSnapshot;
        if (!expectedSnapshot) {
            this.logger.debug("No state snapshot updates needed");
            return { kind: "nothing" };
        }
        const callData = calls.map((call) => call.callData);

        this.logger.info(
            `Posting state snapshot on-chain for fork ${LoggerUtils.formatHash(forkId)}`,
            {
                expectedSnapshot:
                    LoggerUtils.getSnapshotMetadata(expectedSnapshot),
                updates: calls.map((call) => ({
                    snapshot: LoggerUtils.getSnapshotMetadata(
                        call.expectedSnapshot
                    ),
                    outboundMessageBlocks: call.outboundMessageBlocks.map(
                        LoggerUtils.getMessageBlockMetadata
                    )
                }))
            }
        );

        let transactionResponse: TransactionResponse;
        const completion = this.stateManager.stateChannelManagerContract
            .multicall(callData)
            .then(async (response) => {
                transactionResponse = response;
                await response.wait();
                return true;
            })
            .catch(async (error) => {
                let refused = false;
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
                        RaceConditionSnapshotUpdateNotLatestFork: () => {
                            this.logger.warn(
                                "postStateSnapshot: a later reduction landed first; the next post adopts it",
                                { forkId }
                            );
                        },
                        RaceConditionSnapshotUpdateDisputedFork: () => {
                            this.logger.warn(
                                "postStateSnapshot: adoption refused on a disputed fork",
                                { forkId }
                            );
                            refused = true;
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
                if (success) return !refused;
                const custom = tryDecodeCustomError(error);
                this.logger.error("Error posting state snapshot", {
                    custom,
                    error: errorMessage(error)
                });
                throw error;
            });
        return { kind: "posted", expectedSnapshot, completion };
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
                return { kind: "nothing" };
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
                    return { kind: "blocked", reason: "reduction" };
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
                    return { kind: "blocked", reason: "challenge-period" };
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
                kind: "ready",
                callData: forkCalldata,
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
            const preparationBaseSnapshot =
                baseSnapshot ??
                StateSnapshot.from(
                    await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                        this.stateManager.channelId
                    )
                );

            // A locally reduced fork can have finalized milestones before its
            // fork snapshot reaches the chain. Without preceding fork-update
            // calldata this same-fork update cannot be submitted.
            if (preparationBaseSnapshot.forkID !== forkId) {
                this.logger.debug(
                    "Same-fork snapshot update is waiting for its fork snapshot",
                    {
                        requestedForkId: forkId,
                        resolvedBaseForkId: preparationBaseSnapshot.forkID
                    }
                );
                return { kind: "blocked", reason: "fork-not-posted" };
            }

            const latestBlockHeight =
                this.stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;
            if (latestBlockHeight < 0) return { kind: "nothing" };
            // final state only (no unfinal tail); the run holding the
            // on-chain start maps to a snapshot at or below it, never newer
            const { stateProof, milestoneSnapshots: proofSnapshots } =
                await this.stateManager.agreementManager.buildStateProof(
                    forkId,
                    latestBlockHeight,
                    { stopAtThresholdCompletion: true }
                );
            const milestoneProofs: MilestoneProofStruct[] = [];
            const milestoneSnapshots: StateSnapshot[] = [];

            for (const [i, milestoneProof] of stateProof.milestones.entries()) {
                // the builder throws without a threshold milestone's snapshot
                const snapshot = proofSnapshots[i]!;
                // the chain's recency rule, run on the local diamond
                if (
                    await this.stateManager.diamondStateMachine.localDiamondContract.isSnapshotNewer.staticCall(
                        snapshot.toStruct(),
                        preparationBaseSnapshot.toStruct()
                    )
                ) {
                    milestoneProofs.push(milestoneProof);
                    milestoneSnapshots.push(snapshot);
                }
            }

            const latestSnapshot = milestoneSnapshots.at(-1);
            if (!latestSnapshot) return { kind: "nothing" };

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
                return { kind: "blocked", reason: "inbound" };
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
                kind: "ready",
                callData: sameForkCalldata,
                expectedSnapshot: latestSnapshot,
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
