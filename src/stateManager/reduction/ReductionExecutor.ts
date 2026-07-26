import { TransactionResponse } from "ethers";

import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import Clock from "@/Clock";
import { StateSnapshot } from "@/models";
import type { ForkId, Timestamp } from "@/types/types";
import { DetachedPromises, Logger, Mutex } from "@/utils";
import {
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
type ReductionSubmissionStatus =
    | "submit"
    | "already-reduced"
    | "superseded"
    // Our own candidate went stale against the chain. Unlike "superseded" (a
    // final dispute won and drives the fork itself) nothing else will settle
    // this fork, so the attempt must be retried against the moved head.
    | "stale-candidate";
// Which call site classified the revert. "simulation" still owns the decision
// to install; "detached" already installed the candidate before submitting.
type ReductionSubmissionPath = "simulation" | "detached";
const REDUCTION_RACE_ERRORS = [
    "RaceConditionDisputeAlreadyReduced",
    "RaceConditionBlockHeightTooOld",
    "RaceConditionReductionExpectationDoesntMatch",
    // Not a race per se: our reduce inputs went stale against the chain, so
    // reduceAndFinalize reverts the inbound-block check. Classified here so
    // classifyReductionRace can gate it (swallow vs discard) instead of letting
    // it escape the detached reduction path as an unhandled rejection.
    "ErrorDisputeInboundMessageBlocksInvalid"
] as const satisfies readonly RaceConditionErrorName[];
type ReductionRaceErrorName = (typeof REDUCTION_RACE_ERRORS)[number];

function isReductionRaceErrorName(
    errorName: string | undefined
): errorName is ReductionRaceErrorName {
    return REDUCTION_RACE_ERRORS.some((candidate) => candidate === errorName);
}

export default class ReductionExecutor {
    // A stale candidate is retried against the moved chain head, but a
    // divergence that survives this many recomputes is not transient — stop
    // retrying and let the attempt fail loudly instead of looping in silence.
    private static readonly MAX_STALE_CANDIDATE_RETRIES = 3;
    // Every ordinary trigger enters through tryReduce, including timers and
    // reschedules. Serialize the attempt itself, then release this mutex before
    // callers resume waiting on ReductionManager's shared completion promise.
    private readonly attemptMutex: Mutex;
    // Consecutive stale-candidate discards per (channel, fork). Cleared once the
    // fork's reduction installs, so only an unbroken run counts.
    private readonly staleCandidateRetries = new Map<
        ReductionCacheKey,
        number
    >();
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
        this.staleCandidateRetries.clear();
        this.killPeriodExpiryCache.clear();
    }

    public async getSyncedForkDisputes(
        forkId: ForkId
    ): Promise<DisputeStruct[]> {
        const commitments =
            await this.stateManager.stateChannelManagerContract.getWindowCommitments(
                this.stateManager.channelId,
                forkId
            );
        const missing = commitments.filter(
            (commitment) =>
                !this.stateManager.storage.disputes.getDispute(commitment)
        );
        if (missing.length > 0) {
            await this.stateManager.eventSyncService.ensureDisputesProcessed(
                this.stateManager.channelId,
                forkId,
                commitments
            );
        }
        return this.stateManager.agreementManager.getForkDisputes(commitments);
    }

    public async isKillPeriodExpiredCached(
        forkId: ForkId
    ): Promise<KillPeriodObservation> {
        const key = this.getReductionCacheKey(forkId);
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
            this.getReductionCacheKey(forkId),
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
            candidate.reducedForkId,
            disputes,
            submission
        );
        if (submissionStatus === "stale-candidate") {
            // Nothing was installed and no other actor settles this fork, so
            // leaving now would strand the completion promise. The cause is the
            // chain moving under us, so recompute against the new head after
            // letting it settle. A divergence that outlives the retries is a
            // real local fault: rethrow so the completion fails and aborts
            // rather than looping forever.
            this.retryStaleCandidate(forkId, candidate.reducedForkId);
            return;
        }
        if (submissionStatus === "superseded") return;

        this.staleCandidateRetries.delete(this.getReductionCacheKey(forkId));
        await this.complete(
            forkId,
            candidate,
            disputes,
            submission,
            submissionStatus
        );
    }

    private async complete(
        forkId: ForkId,
        candidate: LocalReductionCandidate,
        disputes: DisputeStruct[],
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
            this.submitDetached(
                forkId,
                candidate.reducedForkId,
                disputes,
                submission
            );
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
            const custom = tryDecodeCustomError(error);
            this.logger.error("Error computing reduced snapshot data", {
                custom,
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
        candidateForkId: ForkId,
        disputes: DisputeStruct[],
        submission: { calldata: string[] }
    ): Promise<ReductionSubmissionStatus> {
        try {
            await this.stateManager.stateChannelManagerContract.multicall.staticCall(
                submission.calldata,
                { gasLimit: 3_000_000 }
            );
            return "submit";
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            const status = await this.classifyReductionRace(
                custom?.name,
                forkId,
                candidateForkId,
                disputes,
                "simulation"
            );
            if (status) return status;
            throw custom ?? error;
        }
    }

    private submitDetached(
        forkId: ForkId,
        candidateForkId: ForkId,
        disputes: DisputeStruct[],
        submission: { calldata: string[] }
    ): void {
        this.logger.info("Reduction transaction submit", {
            forkId,
            channelId: this.stateManager.channelId
        });
        let txResponse: TransactionResponse | undefined;
        const transaction = this.stateManager.stateChannelManagerContract
            .multicall(submission.calldata, {
                // Right-sized from 10M: measures ~0.5M avg / ~1.2M max in e2e, so 3M
                // leaves ample headroom while freeing block gas under concurrency
                // (was inflated to dodge ethers gas-estimation failures).
                gasLimit: 3_000_000
            })
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
                        candidateForkId,
                        disputes,
                        "detached"
                    );
                    // complete() already installed this candidate and settled
                    // the completion, and the fork has moved on — so no later
                    // attempt re-enters the executor for this source fork and
                    // nothing can reconcile the install. A candidate the chain
                    // did not commit therefore has to fail closed here.
                    if (status === "stale-candidate") {
                        this.logger.error(
                            "Reduction submit rejected a candidate that is already installed locally - aborting",
                            { forkId, candidateForkId }
                        );
                        this.stateManager.abort();
                        throw new Error(
                            `Installed reduction candidate ${candidateForkId} for fork ${forkId} was rejected on submit`
                        );
                    }
                    if (status) return;
                }
                throw tryDecodeCustomError(error) ?? error;
            });
        DetachedPromises.collect(transaction);
    }

    private async classifyReductionRace(
        errorName: string | undefined,
        forkId: ForkId,
        candidateForkId: ForkId,
        disputes: DisputeStruct[],
        path: ReductionSubmissionPath
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

        // The revert means our inboundMessageBlocks no longer chain to the
        // target hash reduce() derives from live chain storage, so our candidate
        // is stale. Only a committed result equal to our candidate means we
        // simply lost the race and can converge; anything else is a stale
        // candidate, and each call site decides its own policy (retry before
        // installing, fail closed once installed).
        if (errorName === "ErrorDisputeInboundMessageBlocksInvalid") {
            if (
                String(reducedResult.reducedForkId) === String(candidateForkId)
            ) {
                this.logger.info(
                    "Ordinary reduction superseded by another reducer",
                    {
                        forkId,
                        reducedForkId: reducedResult.reducedForkId,
                        reducer: reducedResult.reducer
                    }
                );
                return "already-reduced";
            }
            // Logged at warn so a genuine, persistent local divergence stays
            // diagnosable instead of vanishing as a benign race.
            this.logger.warn(
                path === "detached"
                    ? "Reduction inbound-blocks invalid after submit; stale candidate already installed"
                    : "Reduction inbound-blocks invalid; local candidate diverged from chain - discarding",
                {
                    forkId,
                    candidateForkId,
                    committedForkId: reducedResult.reducedForkId,
                    path
                }
            );
            return "stale-candidate";
        }

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

    // Reschedule a recompute against the moved chain head, waiting for the write
    // that moved it to settle. Throws once the run of consecutive discards is
    // exhausted so ReductionManager fails the completion and aborts.
    private retryStaleCandidate(forkId: ForkId, candidateForkId: ForkId): void {
        const key = this.getReductionCacheKey(forkId);
        const attempt = (this.staleCandidateRetries.get(key) ?? 0) + 1;
        if (attempt > ReductionExecutor.MAX_STALE_CANDIDATE_RETRIES) {
            this.staleCandidateRetries.delete(key);
            throw new Error(
                `Reduction candidate ${candidateForkId} for fork ${forkId} stayed stale across ${ReductionExecutor.MAX_STALE_CANDIDATE_RETRIES} recomputes`
            );
        }
        this.staleCandidateRetries.set(key, attempt);
        const delay = Math.max(
            1,
            this.stateManager.timeConfig.chainFallbackTime
        );
        this.logger.info("Rescheduling reduction after a stale candidate", {
            forkId,
            candidateForkId,
            attempt,
            delay
        });
        this.stateManager.reductionManager.schedule(
            forkId,
            Clock.getTimeInSeconds() + delay,
            true
        );
    }

    private getReductionCacheKey(forkId: ForkId): ReductionCacheKey {
        return `${this.stateManager.channelId}:${forkId}`;
    }
}
