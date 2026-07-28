import type {
    MessageBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import Clock from "@/Clock";
import type { ReduceData } from "@/types";
import type { Bytes, ForkId, Timestamp } from "@/types/types";
import { DetachedPromises, Logger } from "@/utils";

import ReductionComputationService, {
    type ReductionComputation
} from "./ReductionComputationService";
import ReductionExecutor from "./ReductionExecutor";
import type StateManager from "../StateManager";

type ReductionTimeout = {
    handle: ReturnType<typeof setTimeout>;
    triggerTimestamp: Timestamp;
};

export type ReductionGenesis = {
    snapshotData: SnapshotDataStruct;
    encodedState: Bytes;
    genesisTimestamp: Timestamp;
    outboundMessageBlock?: MessageBlockStruct;
};

export type CompletedReduction = {
    reducedForkId: ForkId;
};

type ReductionCompletion = {
    promise: Promise<CompletedReduction>;
    resolve: (result: CompletedReduction) => void;
    reject: (error: unknown) => void;
    result?: CompletedReduction;
    settled: boolean;
};

export default class ReductionManager {
    private readonly completions = new Map<ForkId, ReductionCompletion>();
    // Reduction timers are independent triggers. They do not own completion
    // state and only start another attempt when they fire.
    private readonly timeouts = new Map<ForkId, ReductionTimeout>();
    private readonly reductionComputationService: ReductionComputationService;
    private readonly reductionExecutor: ReductionExecutor;
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "ReductionManager" });
        this.reductionComputationService = new ReductionComputationService(
            stateManager
        );
        this.reductionExecutor = new ReductionExecutor(
            stateManager,
            this.reductionComputationService,
            logger
        );
    }

    public cancelScheduledReductions(): void {
        for (const timeout of this.timeouts.values()) {
            this.stateManager.timeoutManager.cancelTask(timeout.handle);
        }
        this.timeouts.clear();
    }

    public dispose(): void {
        this.cancelScheduledReductions();
        this.completions.clear();
        this.reductionExecutor.dispose();
    }

    public schedule(
        forkId: ForkId,
        localTriggerTimestamp: Timestamp,
        isRescheduled = false
    ): void {
        const now = Clock.getTimeInSeconds();
        this.logger.debug(
            `setReductionTimeout called for fork ${forkId} at ${localTriggerTimestamp} (in ${localTriggerTimestamp - now}s)`
        );

        // If existing timeout exists, only replace if new timeout is further in the future or if it's reschduled (fix a bug where the rescheduled timeout isn't replaced and doesn't fire)
        // TODO - probably has an edge-case related to the timestamp (think)
        const existing = this.timeouts.get(forkId);
        if (existing) {
            if (
                !isRescheduled &&
                existing.triggerTimestamp >= localTriggerTimestamp
            ) {
                return;
            }
            this.stateManager.timeoutManager.cancelTask(existing.handle);
        }

        // Schedule new reduction attempt
        const handle = this.stateManager.timeoutManager.scheduleTask(
            () => {
                if (this.timeouts.get(forkId)?.handle === handle) {
                    this.timeouts.delete(forkId);
                }
                DetachedPromises.collect(this.tryReduce(forkId));
            },
            Math.max(1, localTriggerTimestamp - now) * 1000,
            `reduction-${forkId}`
        );

        this.timeouts.set(forkId, {
            handle,
            triggerTimestamp: localTriggerTimestamp
        });
        this.logger.info(
            `Scheduled reduction timeout for fork ${forkId} at ${localTriggerTimestamp} (in ${localTriggerTimestamp - now}s)`
        );
    }

    public async tryReduce(
        forkId: ForkId
    ): Promise<CompletedReduction | undefined> {
        if (forkId !== this.stateManager.forkId) {
            this.logger.debug("Ignoring reduction attempt for an old fork", {
                forkId,
                currentForkId: this.stateManager.forkId
            });
            return (
                this.completions.get(forkId)?.promise ??
                Promise.resolve(undefined)
            );
        }

        const isDisputed =
            await this.stateManager.stateChannelManagerContract.isForkDisputed(
                this.stateManager.channelId,
                forkId
            );
        if (!isDisputed) return undefined;

        const completion = this.getOrCreateCompletion(forkId);
        try {
            if (!completion.settled) {
                await this.reductionExecutor.tryReduce(forkId);
            }
        } catch (error) {
            this.failCompletion(completion, error);
        }
        return completion.promise;
    }

    public computeReduction(
        forkId: ForkId,
        disputes: DisputeStruct[]
    ): Promise<ReductionComputation> {
        return this.reductionComputationService.compute(forkId, disputes);
    }

    public computeReductionLocally(
        forkId: ForkId,
        disputes: DisputeStruct[]
    ): Promise<ReductionComputation> {
        return this.reductionComputationService.computeLocally(
            forkId,
            disputes
        );
    }

    public buildReduceAndFinalizeCalldata(
        disputes: DisputeStruct[],
        latestStateSnapshot: ReduceData["latestStateSnapshot"],
        encodedStateMachineState: ReduceData["encodedStateMachineState"],
        inboundMessageBlocks: ReduceData["inboundMessageBlocks"],
        reducedForkId: ForkId
    ): string {
        return this.reductionComputationService.buildReduceAndFinalizeCalldata(
            disputes,
            latestStateSnapshot,
            encodedStateMachineState,
            inboundMessageBlocks,
            reducedForkId
        );
    }

    public async completeWithGenesis(
        forkId: ForkId,
        reducedForkId: ForkId,
        genesis: ReductionGenesis
    ): Promise<boolean> {
        const completion = this.getOrCreateCompletion(forkId);
        let installed = false;
        try {
            installed = await this.stateManager.withMutex(
                async () => {
                    if (completion.settled) return false;
                    if (this.stateManager.forkId !== forkId) {
                        this.logger.debug(
                            "Reduction completion skipped because the fork already changed",
                            {
                                forkId,
                                currentForkId: this.stateManager.forkId,
                                reducedForkId
                            }
                        );
                        return false;
                    }

                    await this.stateManager.unsafeSetGenesisState(
                        genesis.snapshotData,
                        genesis.encodedState,
                        reducedForkId,
                        genesis.genesisTimestamp,
                        genesis.outboundMessageBlock
                    );
                    const result = { reducedForkId };
                    completion.result = result;
                    completion.settled = true;
                    completion.resolve(result);
                    return true;
                },
                { taskName: `ReductionManager.complete-${forkId}` }
            );
        } catch (error) {
            this.failCompletion(completion, error);
            await completion.promise;
        }

        const result = await completion.promise;
        if (result.reducedForkId !== reducedForkId) {
            const error = new Error(
                `Final reduction expected fork ${reducedForkId}, but completed with ${result.reducedForkId}`
            );
            this.logger.error("Final reduction result mismatch", {
                forkId,
                expectedReducedForkId: reducedForkId,
                completedReducedForkId: result.reducedForkId
            });
            this.stateManager.abort();
            throw error;
        }
        return installed;
    }

    public getCompletedReduction(
        forkId: ForkId
    ): CompletedReduction | undefined {
        return this.completions.get(forkId)?.result;
    }

    public hasOperation(forkId: ForkId): boolean {
        return this.completions.has(forkId);
    }

    public getSyncedForkDisputes(forkId: ForkId): Promise<DisputeStruct[]> {
        return this.reductionExecutor.getSyncedForkDisputes(forkId);
    }

    public isKillPeriodExpiredCached(forkId: ForkId) {
        return this.reductionExecutor.isKillPeriodExpiredCached(forkId);
    }

    private getOrCreateCompletion(forkId: ForkId): ReductionCompletion {
        const existing = this.completions.get(forkId);
        if (existing) return existing;

        let resolve!: (result: CompletedReduction) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<CompletedReduction>(
            (resolvePromise, rejectPromise) => {
                resolve = resolvePromise;
                reject = rejectPromise;
            }
        );
        const completion = {
            promise,
            resolve,
            reject,
            settled: false
        };
        this.completions.set(forkId, completion);
        return completion;
    }

    private failCompletion(
        completion: ReductionCompletion,
        error: unknown
    ): void {
        if (completion.settled) return;
        completion.settled = true;
        this.logger.error("Fatal reduction error", {
            error: error instanceof Error ? error.message : String(error)
        });
        this.stateManager.abort();
        completion.reject(error);
    }
}
