import { Block } from "@/models";
import type { ParticipantChanges } from "@/stateManager/block/SnapshotAssemblyService";
import type StateManager from "@/stateManager/StateManager";
import { Status } from "@/types";
import { isCommittedParticipantStatus } from "@/types/flags";
import type { Address, ForkId } from "@/types/types";
import { addressesEqual, DetachedPromises, Logger } from "@/utils";
import { config } from "@/utils/config";

type LeavePhase =
    | "starting"
    | "awaiting-exit"
    | "exit-authored"
    | "disputing"
    | "awaiting-settlement";

type LeaveOperation = {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
    participantCount: number;
    ingestedBlockCount: number;
    forkId: ForkId;
    phase: LeavePhase;
    leaveTurnEmitted: boolean;
    watchdog?: ReturnType<typeof setTimeout>;
};

export type LeaveChannelState = {
    participantCount: number;
    ingestedBlockCount: number;
    forkId: ForkId;
    phase: LeavePhase;
    leaveTurnEmitted: boolean;
};

/** Owns the terminal leave operation for one runtime. */
export default class LeaveChannelService {
    private readonly logger: Logger;
    private operation?: LeaveOperation;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "LeaveChannel" });
    }

    public get isLeaving(): boolean {
        return this.operation !== undefined;
    }

    public get state(): LeaveChannelState | null {
        const operation = this.operation;
        if (!operation) return null;
        return {
            participantCount: operation.participantCount,
            ingestedBlockCount: operation.ingestedBlockCount,
            forkId: operation.forkId,
            phase: operation.phase,
            leaveTurnEmitted: operation.leaveTurnEmitted
        };
    }

    public assertOperationAllowed(operation: string): void {
        if (!this.operation) return;
        throw new Error(
            `${operation} is unavailable while terminal channel leave is pending`
        );
    }

    public leaveChannel(): Promise<void> {
        if (this.operation) return this.operation.promise;

        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        const operation: LeaveOperation = {
            promise,
            resolve,
            reject,
            participantCount: 0,
            ingestedBlockCount: 0,
            forkId: this.stateManager.forkId,
            phase: "starting",
            leaveTurnEmitted: false
        };
        this.operation = operation;

        if (!isCommittedParticipantStatus(this.stateManager.status)) {
            operation.resolve();
            return operation.promise;
        }

        void this.startCommittedLeave(operation).catch((error) =>
            this.fail(operation, error)
        );
        return operation.promise;
    }

    public takeLeaveTurn(nextToWrite: Address): boolean {
        const operation = this.operation;
        if (
            !operation ||
            operation.phase !== "awaiting-exit" ||
            operation.leaveTurnEmitted ||
            !addressesEqual(nextToWrite, this.stateManager.signerAddress)
        ) {
            return false;
        }
        operation.leaveTurnEmitted = true;
        return true;
    }

    public async onBlockCommitted(
        block: Block,
        participantChanges: ParticipantChanges
    ): Promise<void> {
        const operation = this.operation;
        if (!operation) return;

        if (participantChanges.left.has(this.stateManager.signerAddress)) {
            operation.phase = "exit-authored";
            this.cancelWatchdog(operation);
            return;
        }
        if (
            operation.phase !== "awaiting-exit" ||
            block.forkId !== operation.forkId
        ) {
            return;
        }

        operation.ingestedBlockCount += 1;
        if (operation.ingestedBlockCount >= operation.participantCount + 1) {
            const fallback = this.startDisputeFallback(
                operation,
                "block bound"
            );
            DetachedPromises.observe(fallback, (error) =>
                this.fail(operation, error)
            );
        }
    }

    /**
     * The authored exit's self-removal dispute did not land. The leave fails
     * only when no dispute window covers the fork; see `awaitCoveringWindow`.
     */
    public onExitSelfRemovalNotStarted(forkId: ForkId): void {
        const operation = this.operation;
        if (
            !operation ||
            operation.phase !== "exit-authored" ||
            operation.forkId !== forkId
        )
            return;
        DetachedPromises.collect(
            this.awaitCoveringWindow(operation, "exit-authored").then(
                (covered) => {
                    if (!covered)
                        this.fail(
                            operation,
                            new Error(
                                "Terminal channel leave failed to start a dispute"
                            )
                        );
                },
                (error) => this.fail(operation, error)
            )
        );
    }

    public onExitFallbackFailed(forkId: ForkId, error: unknown): void {
        const operation = this.operation;
        if (
            !operation ||
            operation.phase !== "exit-authored" ||
            operation.forkId !== forkId
        )
            return;
        this.fail(operation, error);
    }

    public async onSettledStateObserved(): Promise<void> {
        const operation = this.operation;
        if (!operation || operation.phase === "starting") return;

        const sm = this.stateManager;
        const remainsLocal = await sm.membershipService.isSignerInLocalState();
        const disputeSettlementObserved =
            (operation.phase === "awaiting-settlement" ||
                sm.storage.disputes.didIDispute(operation.forkId)) &&
            sm.forkId !== operation.forkId;

        if (
            sm.status === Status.SYNCED &&
            !remainsLocal &&
            (disputeSettlementObserved ||
                !(await sm.membershipService.isSignerOnChain()))
        ) {
            this.cancelWatchdog(operation);
            operation.resolve();
            return;
        }

        if (
            remainsLocal &&
            sm.forkId !== operation.forkId &&
            isCommittedParticipantStatus(sm.status)
        ) {
            operation.forkId = sm.forkId;
            operation.ingestedBlockCount = 0;
            operation.leaveTurnEmitted = false;
            operation.phase = "awaiting-exit";
            this.armWatchdog(operation);
        }
    }

    public dispose(): void {
        const operation = this.operation;
        if (!operation) return;
        this.cancelWatchdog(operation);
        operation.reject(
            new Error(
                "P2P runtime was disposed while channel leave was pending"
            )
        );
    }

    private async startCommittedLeave(
        operation: LeaveOperation
    ): Promise<void> {
        const participants =
            await this.stateManager.diamondStateMachine.getParticipants();
        if (this.operation !== operation) return;

        operation.participantCount = participants.length;
        operation.forkId = this.stateManager.forkId;
        this.stateManager.storage.forceExit.setForceExit(true);

        if (this.stateManager.storage.disputes.didIDispute(operation.forkId)) {
            operation.phase = "awaiting-settlement";
            return;
        }

        operation.phase = "awaiting-exit";
        this.armWatchdog(operation);
        await this.onSettledStateObserved();
    }

    private armWatchdog(operation: LeaveOperation): void {
        this.cancelWatchdog(operation);
        operation.watchdog = this.stateManager.timeoutManager.scheduleTask(
            () =>
                DetachedPromises.observe(
                    this.startDisputeFallback(operation, "watchdog"),
                    (error) => this.fail(operation, error)
                ),
            config.LEAVE_CHANNEL_WATCHDOG_MS,
            "terminal channel leave watchdog"
        );
    }

    private cancelWatchdog(operation: LeaveOperation): void {
        if (!operation.watchdog) return;
        this.stateManager.timeoutManager.cancelTask(operation.watchdog);
        operation.watchdog = undefined;
    }

    private async startDisputeFallback(
        operation: LeaveOperation,
        reason: "block bound" | "watchdog"
    ): Promise<void> {
        if (
            this.operation !== operation ||
            operation.phase !== "awaiting-exit"
        ) {
            return;
        }
        this.cancelWatchdog(operation);

        if (this.stateManager.storage.disputes.didIDispute(operation.forkId)) {
            operation.phase = "awaiting-settlement";
            return;
        }

        const forkId = operation.forkId;
        operation.phase = "disputing";
        this.logger.info(
            "Terminal channel leave starting self-removal dispute",
            {
                forkId,
                reason
            }
        );
        const started =
            await this.stateManager.membershipService.startSelfRemovalDispute(
                forkId
            );
        // A settlement during the upload re-armed the leave on a newer fork,
        // with its own attempt; this result belongs to the fork left behind.
        if (
            this.operation !== operation ||
            operation.phase !== "disputing" ||
            operation.forkId !== forkId
        ) {
            return;
        }
        if (!started) {
            if (!(await this.awaitCoveringWindow(operation, "disputing"))) {
                throw new Error(
                    "Terminal channel leave failed to start a dispute"
                );
            }
            return;
        }
        operation.phase = "awaiting-settlement";
    }

    /**
     * A self-removal dispute that did not land fails the leave only when no
     * dispute window covers the fork. When one does, another participant won
     * the race to upload for it: that window's settlement moves the runtime to
     * a new fork, where `onSettledStateObserved` either completes the leave or
     * re-arms it, so the self-removal is retried once on that fork. Returns
     * false only when the leave must fail.
     */
    private async awaitCoveringWindow(
        operation: LeaveOperation,
        phase: "disputing" | "exit-authored"
    ): Promise<boolean> {
        const sm = this.stateManager;
        const forkId = operation.forkId;
        const covered = await sm.stateChannelManagerContract.isForkDisputed(
            sm.channelId,
            forkId
        );
        // The leave moved on while the read ran; nothing here is current.
        if (
            this.operation !== operation ||
            operation.phase !== phase ||
            operation.forkId !== forkId
        )
            return true;
        if (!covered) return false;
        this.logger.info(
            "Terminal channel leave waiting for the dispute window covering its fork",
            { forkId }
        );
        operation.phase = "awaiting-settlement";
        // The window may already have settled while the upload ran.
        await this.onSettledStateObserved();
        return true;
    }

    private fail(operation: LeaveOperation, error: unknown): void {
        if (this.operation !== operation) return;
        this.cancelWatchdog(operation);
        operation.reject(
            error instanceof Error ? error : new Error(String(error))
        );
    }
}
