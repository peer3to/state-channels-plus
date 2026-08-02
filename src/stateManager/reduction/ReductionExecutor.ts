import { TransactionResponse } from "ethers";

import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import Clock from "@/Clock";
import { StateSnapshot } from "@/models";
import type { ForkId, Timestamp } from "@/types/types";
import { DetachedPromises, Logger, Mutex } from "@/utils";
import {
    type CustomEvmError,
    type RaceConditionErrorHandlers,
    type RaceConditionErrorName,
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";

import type ReductionComputationService from "./ReductionComputationService";
import type { ReductionComputation } from "./ReductionComputationService";
import type StateManager from "../StateManager";

type KillPeriodObservation = {
    windowExists: boolean;
    isExpired: boolean;
    killPeriodEnd: Timestamp;
};

type LocalReductionCandidate = ReductionComputation & {
    disputes: DisputeStruct[];
    reducedGenesisSnapshot: StateSnapshot;
    genesisTimestamp: Timestamp;
};

type ReductionCacheKey = string;
type ReductionSubmissionStatus = "submit" | "already-reduced" | "superseded";
// Which call site is reporting the failure. "simulation" has installed nothing
// yet; "detached" already installed the candidate before submitting.
type ReductionSubmissionPath = "simulation" | "detached";

const REDUCTION_RACE_ERRORS = [
    "RaceConditionDisputeAlreadyReduced",
    "RaceConditionBlockHeightTooOld",
    "RaceConditionReductionExpectationDoesntMatch"
] as const satisfies readonly RaceConditionErrorName[];
type ReductionRaceErrorName = (typeof REDUCTION_RACE_ERRORS)[number];

function isReductionRaceErrorName(
    errorName: string | undefined
): errorName is ReductionRaceErrorName {
    return REDUCTION_RACE_ERRORS.some((candidate) => candidate === errorName);
}

export default class ReductionExecutor {
    // Every ordinary trigger enters through tryReduce, including timers and
    // reschedules. Serialize the attempt itself, then release this mutex before
    // callers resume waiting on ReductionManager's shared completion promise.
    private readonly attemptMutex: Mutex;
    // Memoized `isKillPeriodExpired` per (channel, fork). A junk-fork flood then
    // costs O(1) chain reads per window instead of one per block: a "not expired
    // until killPeriodEnd" answer is reused until that time; an "expired" answer
    // is terminal.
    private readonly killPeriodExpiryCache = new Map<
        ReductionCacheKey,
        KillPeriodObservation
    >();
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        private readonly reductionComputationService: ReductionComputationService,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "ReductionExecutor" });
        this.attemptMutex = new Mutex(
            this.logger.child({ component: "ReductionAttemptMutex" })
        );
    }

    public dispose(): void {
        this.killPeriodExpiryCache.clear();
    }

    public async getSyncedForkDisputes(
        forkId: ForkId
    ): Promise<DisputeStruct[]> {
        const commitments =
            await this.stateManager.eventSyncService.loadSynchronizedWindowCommitments(
                this.stateManager.channelId,
                forkId
            );
        return this.stateManager.agreementManager.getForkDisputes(commitments);
    }

    public async isKillPeriodExpiredCached(
        forkId: ForkId
    ): Promise<KillPeriodObservation> {
        const key = `${this.stateManager.channelId}:${forkId}`;
        const cached = this.killPeriodExpiryCache.get(key);
        if (
            cached &&
            (cached.isExpired ||
                Clock.getTimeInSeconds() < cached.killPeriodEnd)
        ) {
            return cached;
        }

        // TODO: production must use redundant provider infrastructure. Reduction
        // treats provider failure as fatal and currently assumes the configured
        // provider remains available for these reads.
        const fresh =
            await this.stateManager.stateChannelManagerContract.isKillPeriodExpired(
                this.stateManager.channelId,
                forkId
            );
        const observation = {
            windowExists: fresh.windowExists,
            isExpired: fresh.isExpired,
            killPeriodEnd: Number(fresh.killPeriodEnd)
        };
        this.killPeriodExpiryCache.set(key, observation);
        return observation;
    }

    public async tryReduce(forkId: ForkId): Promise<void> {
        await this.attemptMutex.lock({
            taskName: `ReductionExecutor.tryReduce-${forkId}`
        });
        try {
            await this.tryReduceLocked(forkId);
        } finally {
            this.attemptMutex.unlock();
        }
    }

    private async tryReduceLocked(forkId: ForkId): Promise<void> {
        if (forkId !== this.stateManager.forkId) return;

        const { windowExists, isExpired, killPeriodEnd } =
            await this.isKillPeriodExpiredCached(forkId);
        // A final dispute can transition the fork while this attempt is waiting
        // on any provider call. Its completion is authoritative, so the stale
        // ordinary attempt simply stands down.
        if (forkId !== this.stateManager.forkId) return;
        if (!windowExists) return;
        if (!isExpired) {
            this.stateManager.reductionManager.schedule(
                forkId,
                killPeriodEnd,
                true
            );
            return;
        }

        const disputes = await this.getSyncedForkDisputes(forkId);
        if (forkId !== this.stateManager.forkId) return;
        const freshExpiry =
            await this.stateManager.stateChannelManagerContract.isKillPeriodExpired(
                this.stateManager.channelId,
                forkId
            );
        if (forkId !== this.stateManager.forkId) return;
        const freshObservation = {
            windowExists: freshExpiry.windowExists,
            isExpired: freshExpiry.isExpired,
            killPeriodEnd: Number(freshExpiry.killPeriodEnd)
        };
        this.killPeriodExpiryCache.set(
            `${this.stateManager.channelId}:${forkId}`,
            freshObservation
        );
        if (!freshObservation.windowExists) return;
        if (!freshObservation.isExpired) {
            this.stateManager.reductionManager.schedule(
                forkId,
                freshObservation.killPeriodEnd,
                true
            );
            return;
        }

        if (disputes.length === 0) {
            this.logger.warn(
                `No disputes found while reducing disputed fork ${forkId}; initiating local dispute`
            );
            await this.stateManager.disputeManager.dispute(forkId);
            return;
        }

        const candidate = await this.prepareLocalCandidate(
            forkId,
            freshObservation.killPeriodEnd,
            disputes
        );
        const submission = await this.prepareSubmission(candidate);
        const submissionStatus = await this.simulateSubmission(
            forkId,
            candidate,
            submission
        );
        if (submissionStatus === "superseded") return;

        await this.complete(forkId, candidate, submission, submissionStatus);
    }

    private async complete(
        forkId: ForkId,
        candidate: LocalReductionCandidate,
        submission: { calldata: string[] },
        submissionStatus: ReductionSubmissionStatus
    ): Promise<void> {
        const installed =
            await this.stateManager.reductionManager.completeWithGenesis(
                forkId,
                candidate.reducedForkId,
                {
                    snapshotData: candidate.reducedSnapshotData,
                    encodedState: candidate.reducedEncodedStateMachineState,
                    genesisTimestamp: candidate.genesisTimestamp,
                    outboundMessageBlock: candidate.reducedOutboundMessageBlock
                }
            );
        if (installed && submissionStatus === "submit") {
            this.submitDetached(forkId, candidate, submission);
        }
    }

    private async prepareLocalCandidate(
        forkId: ForkId,
        genesisTimestamp: Timestamp,
        disputes: DisputeStruct[]
    ): Promise<LocalReductionCandidate> {
        this.logger.debug(
            `Performing local reduction on disputes for fork ${LoggerUtils.formatHash(forkId)}`,
            {
                disputes: disputes.map((dispute) =>
                    LoggerUtils.getDisputeMetadata(dispute)
                )
            }
        );
        try {
            const computation = await this.reductionComputationService.compute(
                forkId,
                disputes
            );
            const {
                reducedSnapshotData,
                reducedOutboundMessageBlock,
                reducedForkId
            } = computation;

            // The fork-update calldata walks the outbound-message chain from
            // the current on-chain snapshot through the newly reduced output.
            // Persist the deterministic terminal block before building that
            // range; setGenesisState will persist the same block idempotently.
            if (reducedOutboundMessageBlock) {
                this.stateManager.storage.outboundMessages.store(
                    reducedOutboundMessageBlock,
                    { justPersist: true }
                );
            }
            const reducedGenesisSnapshot = StateSnapshot.from({
                forkId: reducedForkId,
                blockHeight: 0,
                timestamp: genesisTimestamp,
                snapshotData: reducedSnapshotData
            });

            return {
                ...computation,
                disputes,
                reducedGenesisSnapshot,
                genesisTimestamp
            };
        } catch (error) {
            this.logger.error("Error computing reduced snapshot data", {
                customError: LoggerUtils.getCustomEvmErrorMetadata(
                    tryDecodeCustomError(error)
                ),
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private async prepareSubmission(candidate: LocalReductionCandidate) {
        const currentOnChainSnapshot = StateSnapshot.from(
            await this.stateManager.stateChannelManagerContract.getStateSnapshot(
                this.stateManager.channelId
            )
        );
        const { calldata: forkCalldata } =
            this.stateManager.snapshotUpdateService.buildForkSnapshotCalldata(
                candidate.reducedGenesisSnapshot,
                currentOnChainSnapshot
            );
        const reduceCalldata =
            this.reductionComputationService.buildReduceAndFinalizeCalldata(
                candidate.disputes,
                candidate.reduceData.latestStateSnapshot,
                candidate.reduceData.encodedStateMachineState,
                candidate.reduceData.inboundMessageBlocks,
                candidate.reducedForkId
            );
        return { calldata: [reduceCalldata, forkCalldata] };
    }

    private async simulateSubmission(
        forkId: ForkId,
        candidate: LocalReductionCandidate,
        submission: { calldata: string[] }
    ): Promise<ReductionSubmissionStatus> {
        try {
            await this.stateManager.stateChannelManagerContract.multicall.staticCall(
                submission.calldata
            );
            return "submit";
        } catch (error) {
            const customError = tryDecodeCustomError(error);
            const status = await this.classifyReductionRace(
                customError?.name,
                forkId,
                candidate.disputes
            );
            if (status) return status;
            this.logUnclassifiedSubmissionFailure(
                customError,
                forkId,
                candidate,
                "simulation"
            );
            throw customError ?? error;
        }
    }

    private submitDetached(
        forkId: ForkId,
        candidate: LocalReductionCandidate,
        submission: { calldata: string[] }
    ): void {
        this.logger.info("Reduction transaction submit", {
            forkId,
            channelId: this.stateManager.channelId
        });
        let txResponse: TransactionResponse | undefined;
        const transaction = this.stateManager.stateChannelManagerContract
            .getGasLimit()
            .then((gasLimit) =>
                this.stateManager.stateChannelManagerContract.multicall(
                    submission.calldata,
                    { gasLimit }
                )
            )
            .then(async (tx) => {
                txResponse = tx;
                await tx.wait();
            })
            .catch(async (error) => {
                let raceErrorName: ReductionRaceErrorName | undefined;
                const handlers: RaceConditionErrorHandlers = {};
                for (const errorName of REDUCTION_RACE_ERRORS) {
                    handlers[errorName] = () => {
                        raceErrorName = errorName;
                    };
                }
                const handled = await tryHandleEvmError(error, {
                    tx: txResponse,
                    forkId,
                    logger: this.logger,
                    signer: this.stateManager.signer,
                    handlers
                });
                if (handled && raceErrorName) {
                    const status = await this.classifyReductionRace(
                        raceErrorName,
                        forkId,
                        candidate.disputes
                    );
                    if (status) return;
                }
                const customError = tryDecodeCustomError(error);
                this.logUnclassifiedSubmissionFailure(
                    customError,
                    forkId,
                    candidate,
                    "detached"
                );
                throw customError ?? error;
            });
        DetachedPromises.collect(transaction);
    }

    /**
     * A reduction submission failed with something we do not classify as a
     * race, so it is about to be rethrown. Record what the failing call
     * carried before it goes: whatever the revert itself reported, next to the
     * inbound chain this candidate submitted.
     */
    private logUnclassifiedSubmissionFailure(
        customError: CustomEvmError | null,
        forkId: ForkId,
        candidate: LocalReductionCandidate,
        submissionPath: ReductionSubmissionPath
    ): void {
        this.logger.warn("Reduction submission failed unclassified", {
            customError: LoggerUtils.getCustomEvmErrorMetadata(customError),
            forkId,
            candidateForkId: candidate.reducedForkId,
            channelId: this.stateManager.channelId,
            submissionPath,
            inboundChain: LoggerUtils.getReductionInboundMetadata(
                candidate.reduceData
            )
        });
    }

    private async classifyReductionRace(
        errorName: string | undefined,
        forkId: ForkId,
        disputes: DisputeStruct[]
    ): Promise<ReductionSubmissionStatus | undefined> {
        if (!isReductionRaceErrorName(errorName)) return undefined;
        if (
            errorName === "RaceConditionDisputeAlreadyReduced" ||
            errorName === "RaceConditionBlockHeightTooOld"
        ) {
            // These races happen only once the evidence period is over, when no
            // new final dispute can be submitted. Reduction is deterministic,
            // so another successful reducer necessarily installed the same
            // result; querying it again would not add a meaningful check.
            return "already-reduced";
        }

        const reducedResult =
            await this.stateManager.stateChannelManagerContract.getReducedResult(
                this.stateManager.channelId,
                forkId
            );
        const finalDispute = disputes.find(
            (dispute) =>
                String(dispute.outputSnapshotDataHash) ===
                String(reducedResult.reducedForkId)
        );
        if (!finalDispute) return undefined;

        this.logger.info("Ordinary reduction superseded by a final dispute", {
            forkId,
            reducedForkId: reducedResult.reducedForkId,
            disputer: finalDispute.input.disputer
        });
        return "superseded";
    }
}
