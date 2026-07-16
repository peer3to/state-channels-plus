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

        const { isExpired, killPeriodEnd } =
            await this.isKillPeriodExpiredCached(forkId);
        // A final dispute can transition the fork while this attempt is waiting
        // on any provider call. Its completion is authoritative, so the stale
        // ordinary attempt simply stands down.
        if (forkId !== this.stateManager.forkId) return;
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
        if (!freshExpiry.isExpired) {
            this.killPeriodExpiryCache.delete(
                `${this.stateManager.channelId}:${forkId}`
            );
            this.stateManager.reductionManager.schedule(
                forkId,
                Number(freshExpiry.killPeriodEnd),
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
            Number(freshExpiry.killPeriodEnd),
            disputes
        );
        const submission = await this.prepareSubmission(candidate);
        const submissionStatus = await this.simulateSubmission(
            forkId,
            disputes,
            submission
        );
        if (submissionStatus === "superseded") return;

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
            this.submitDetached(forkId, disputes, submission);
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
                disputes
            );
            if (status) return status;
            throw custom ?? error;
        }
    }

    private submitDetached(
        forkId: ForkId,
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
                        disputes
                    );
                    if (status) return;
                }
                throw tryDecodeCustomError(error) ?? error;
            });
        DetachedPromises.collect(transaction);
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
