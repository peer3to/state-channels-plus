import Clock from "@/Clock";
import { Block } from "@/models";
import type { ParticipantChanges } from "@/stateManager/block/SnapshotAssemblyService";
import type StateManager from "@/stateManager/StateManager";
import { Status } from "@/types";
import { isCommittedParticipantStatus } from "@/types/flags";
import type { Address, ForkId } from "@/types/types";
import { addressesEqual, DetachedPromises, Logger } from "@/utils";
import { config } from "@/utils/config";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";

type LeavePhase =
    | "starting"
    | "awaiting-join"
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
    private disposed = false;

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

    public onExitFallbackFailed(forkId: ForkId, error: unknown): void {
        const operation = this.operation;
        if (
            !operation ||
            operation.phase !== "exit-authored" ||
            operation.forkId !== forkId
        )
            return;
        // the window already holds commitments -> its reduction settles the leave
        if (
            tryDecodeCustomError(error)?.name ===
            "RaceConditionDisputeEvidencePeriodExpired"
        ) {
            operation.phase = "awaiting-settlement";
            return;
        }
        this.fail(operation, error);
    }

    public async onSettledStateObserved(): Promise<void> {
        const operation = this.operation;
        // Until its authorization expires, the join may still land: only the
        // join wait settles an unobserved join.
        if (
            !operation ||
            operation.phase === "starting" ||
            operation.phase === "awaiting-join"
        )
            return;

        const sm = this.stateManager;
        const remainsLocal = await sm.membershipService.isSignerInLocalState();
        const disputeSettlementObserved =
            (operation.phase === "awaiting-settlement" ||
                sm.storage.disputes.didIDispute(operation.forkId)) &&
            sm.forkId !== operation.forkId;

        // A closed channel (NOT_OPENED after the last exit) holds no member,
        // so an exit that closed it settles the leave as SYNCED would.
        if (
            (sm.status === Status.SYNCED || sm.status === Status.NOT_OPENED) &&
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
        this.disposed = true;
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

        // A pending joiner that has not observed its own join on chain has
        // nothing to remove yet: it waits until its join authorization has
        // expired on chain before any exit fallback starts.
        const sm = this.stateManager;
        if (
            sm.status === Status.PENDING_PARTICIPANT &&
            !sm.membershipService.isOwnJoinObserved()
        ) {
            operation.phase = "awaiting-join";
            this.scheduleJoinWait(operation, 0);
            return;
        }

        operation.phase = "awaiting-exit";
        this.armWatchdog(operation);
        await this.onSettledStateObserved();
    }

    /** The leaver's own join arrived on chain: its leave proceeds as a member's. */
    public onOwnJoinObserved(): void {
        const operation = this.operation;
        if (!operation || operation.phase !== "awaiting-join") return;
        operation.phase = "awaiting-exit";
        this.armWatchdog(operation);
    }

    /**
     * Checks the join once the chain is past the join authorization's
     * deadline (at least `minimumSeconds` from now). The contract admits a
     * join only in a block whose timestamp is at most that deadline.
     */
    private scheduleJoinWait(
        operation: LeaveOperation,
        minimumSeconds: number
    ): void {
        const deadline =
            this.stateManager.membershipService.getJoinAuthorizationDeadline();
        const untilExpirySeconds =
            deadline === undefined
                ? 0
                : deadline + 1 - Clock.getTimeInSeconds();
        operation.watchdog = this.stateManager.timeoutManager.scheduleTask(
            () =>
                DetachedPromises.observe(
                    this.settleUnobservedJoin(operation),
                    (error) => this.fail(operation, error)
                ),
            Math.max(minimumSeconds, untilExpirySeconds, 0) * 1000,
            "terminal channel leave join wait"
        );
    }

    /** The join wait still owns this operation: no observation, disposal or replacement happened. */
    private isAwaitingJoin(operation: LeaveOperation): boolean {
        return (
            !this.disposed &&
            this.operation === operation &&
            operation.phase === "awaiting-join" &&
            !this.stateManager.membershipService.isOwnJoinObserved()
        );
    }

    /**
     * The join wait ended without the leaver observing its join; the
     * membership service owns the join decision. "open": the join can still
     * land, so the wait continues. "landed": the observation only lags and
     * the member's leave runs. "expired" or "none" (the join was dropped):
     * the leave has nothing to remove and settles. An observation, disposal
     * or replacement during the read wins over the read.
     */
    private async settleUnobservedJoin(
        operation: LeaveOperation
    ): Promise<void> {
        operation.watchdog = undefined;
        if (!this.isAwaitingJoin(operation)) return;
        const membership = this.stateManager.membershipService;
        const join = await membership.getOwnJoinState();
        if (!this.isAwaitingJoin(operation)) return;
        if (join.state === "open") {
            this.scheduleJoinWait(operation, 1);
            return;
        }
        if (join.state === "landed") {
            operation.phase = "awaiting-exit";
            this.armWatchdog(operation);
            return;
        }
        membership.dropMembership();
        this.logger.info(
            "Terminal channel leave settled: the join authorization expired and the join never reached the chain"
        );
        operation.resolve();
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

        operation.phase = "disputing";
        this.logger.info(
            "Terminal channel leave starting self-removal dispute",
            {
                forkId: operation.forkId,
                reason
            }
        );
        if (
            !(await this.stateManager.membershipService.startSelfRemovalDispute(
                operation.forkId
            ))
        ) {
            throw new Error("Terminal channel leave failed to start a dispute");
        }
        operation.phase = "awaiting-settlement";
    }

    private fail(operation: LeaveOperation, error: unknown): void {
        if (this.operation !== operation) return;
        this.cancelWatchdog(operation);
        operation.reject(
            error instanceof Error ? error : new Error(String(error))
        );
    }
}
