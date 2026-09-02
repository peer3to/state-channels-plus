import type { ParticipantChanges } from "@/stateManager/block/SnapshotAssemblyService";
import type StateManager from "@/stateManager/StateManager";
import { Block } from "@/models";
import { Status } from "@/types";
import type { Address, ForkId } from "@/types/types";
import { addressesEqual, Logger } from "@/utils";
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

const COMMITTED_STATUSES = new Set<Status>([
    Status.PENDING_PARTICIPANT,
    Status.PARTICIPATING
]);

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

        if (!COMMITTED_STATUSES.has(this.stateManager.status)) {
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
            await this.startDisputeFallback(operation, "block bound");
        }
    }

    public async onSettledStateObserved(): Promise<void> {
        const operation = this.operation;
        if (!operation || operation.phase === "starting") return;

        const sm = this.stateManager;
        const [localParticipants, onChainParticipants] = await Promise.all([
            sm.getParticipantsCurrent(),
            sm.membershipService.getOnChainParticipantUnion()
        ]);
        const remainsLocal = localParticipants.some((participant) =>
            addressesEqual(participant, sm.signerAddress)
        );
        const remainsOnChain = onChainParticipants.some((participant) =>
            addressesEqual(participant, sm.signerAddress)
        );
        const disputeSettlementObserved =
            (operation.phase === "awaiting-settlement" ||
                sm.storage.disputes.didIDispute(operation.forkId)) &&
            sm.forkId !== operation.forkId;

        if (
            sm.status === Status.SYNCED &&
            !remainsLocal &&
            (!remainsOnChain || disputeSettlementObserved)
        ) {
            this.cancelWatchdog(operation);
            operation.resolve();
            return;
        }

        if (
            remainsLocal &&
            sm.forkId !== operation.forkId &&
            COMMITTED_STATUSES.has(sm.status)
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
            new Error("P2P runtime was disposed while channel leave was pending")
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

        if (
            this.stateManager.storage.disputes.didIDispute(operation.forkId)
        ) {
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
            () => this.startDisputeFallback(operation, "watchdog"),
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

        if (
            this.stateManager.storage.disputes.didIDispute(operation.forkId)
        ) {
            operation.phase = "awaiting-settlement";
            return;
        }

        operation.phase = "disputing";
        this.logger.info("Terminal channel leave starting self-removal dispute", {
            forkId: operation.forkId,
            reason
        });
        await this.stateManager.disputeManager.dispute(operation.forkId);
        if (!this.stateManager.storage.disputes.didIDispute(operation.forkId)) {
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
