import { StateSnapshot } from "@/models";
import type { ParticipantChanges } from "@/stateManager/block/SnapshotAssemblyService";
import type StateManager from "@/stateManager/StateManager";
import { Status } from "@/types";
import { isCommittedParticipantStatus } from "@/types/flags";
import type { Address, ForkId } from "@/types/types";
import { addressesEqual, DetachedPromises, Logger } from "@/utils";
import { config } from "@/utils/config";
import { tryDecodeCustomError } from "@/utils/evmErrorHandler";

/**
 * Chain refusals of an exit post: the snapshot has not consumed the inbound
 * head, another post or a later reduction landed first, the fork is
 * disputed (the leave's dispute settles it), or a 0-participant fork was
 * already closed by an earlier post.
 */
const EXIT_POST_REFUSALS = [
    "RaceConditionPendingInboundNotConsumed",
    "RaceConditionBlockHeightTooOld",
    "RaceConditionSnapshotForkMismatch",
    "RaceConditionSnapshotUpdateNotLatestFork",
    "RaceConditionSnapshotUpdateDisputedFork",
    "RaceConditionGenesisTimestampNotAvailable"
] as const;

/** This runtime's exit, from a leave request or from its own exit block. */
export type LeaveChannelState = {
    forkId: ForkId;
    isLeaveRequested: boolean;
    isLeaveTurnTaken: boolean;
    isExitBlockCommitted: boolean;
};

/**
 * Owns this runtime's membership end. A leave offers the leaver's next turn
 * to the application (`onLeaveTurn`) to author its exit. Once the exit block
 * is committed, each finalized block posts the latest state snapshot: any
 * posted snapshot that includes the exit lands it. Every dispute of an
 * exiting signer carries its self-removal (the force-exit flag), and the
 * leave watchdog starts one; a new membership of the runtime clears the
 * flag. A reduction that leaves no participant is posted by the leaver once
 * installed: no member is left to post it, and only that post closes the
 * channel. Once the runtime observes that it is in neither the local state
 * nor the chain's membership it drops to SYNCED.
 * Every drop of a member or pending joiner to SYNCED, whatever caused it
 * (a leave, a removal, a refused or expired join), emits `onLeftChannel`.
 */
export default class LeaveChannelService {
    private readonly logger: Logger;
    private exit?: LeaveChannelState;
    private watchdog?: ReturnType<typeof setTimeout>;
    // one exit post runs at a time; a finalized block during it posts once more
    private isPosting = false;
    private isPostQueued = false;
    // one membership check runs at a time; at most one more waits behind it
    private checks: Promise<void> = Promise.resolve();
    private isCheckQueued = false;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "LeaveChannel" });
        const events = stateManager.events;
        const check = () => this.requestCheck();
        events.on("p2pEventHooks", "onBlockFinalized", () =>
            this.postLatestSnapshot()
        );
        events.on("p2pEventHooks", "onSetState", check);
        events.on("p2pEventHooks", "onStatusChanged", (oldStatus, status) =>
            this.onStatusChanged(oldStatus, status)
        );
        events.on("eventHandler", "onStateSnapshotUpdated", (_, snapshot) => {
            // a snapshot that still lists this signer removed no
            // one: only a pending exit checks it
            if (
                !this.exit &&
                stateManager.membershipService.includesSigner(
                    snapshot.snapshotData.participants as Address[]
                )
            )
                return;
            this.requestCheck();
        });
        events.on("eventHandler", "onDisputeReducedResultCommitted", check);
        events.on("eventHandler", "onChannelStorageCleared", check);
    }

    private get isLeaving(): boolean {
        return this.exit?.isLeaveRequested === true;
    }

    public get state(): LeaveChannelState | null {
        return this.exit ? { ...this.exit } : null;
    }

    public assertOperationAllowed(operation: string): void {
        if (this.isLeaving)
            throw new Error(
                `${operation} is unavailable while terminal channel leave is pending`
            );
    }

    /** Starts this runtime's leave; `onLeftChannel` reports its end. */
    public leaveChannel(): void {
        if (this.isLeaving) return;
        if (
            !this.exit &&
            !isCommittedParticipantStatus(this.stateManager.status)
        ) {
            // nothing to leave
            this.stateManager.p2pEventHooks.onLeftChannel?.();
            return;
        }
        (this.exit ?? this.startExit()).isLeaveRequested = true;
        this.requestCheck();
    }

    /** Whether the leaver's turn goes to the application to author its exit. */
    public shouldTakeLeaveTurn(nextToWrite: Address): boolean {
        const exit = this.exit;
        if (
            !exit?.isLeaveRequested ||
            exit.isLeaveTurnTaken ||
            exit.isExitBlockCommitted ||
            !addressesEqual(nextToWrite, this.stateManager.signerAddress)
        )
            return false;
        exit.isLeaveTurnTaken = true;
        return true;
    }

    /** A committed block; the signer's own exit block starts its exit. */
    public onBlockCommitted(participantChanges: ParticipantChanges): void {
        // a signer that already left has no exit to start
        if (
            !participantChanges.left.has(this.stateManager.signerAddress) ||
            !isCommittedParticipantStatus(this.stateManager.status)
        )
            return;
        (this.exit ?? this.startExit()).isExitBlockCommitted = true;
    }

    private startExit(): LeaveChannelState {
        const sm = this.stateManager;
        const exit: LeaveChannelState = {
            forkId: sm.forkId,
            isLeaveRequested: false,
            isLeaveTurnTaken: false,
            isExitBlockCommitted: false
        };
        this.exit = exit;
        // every dispute of this signer now carries its self-removal; a
        // started exit is never retracted, only a new membership clears it
        sm.storage.forceExit.setForceExit(true);
        this.armWatchdog(config.LEAVE_CHANNEL_WATCHDOG_MS);
        return exit;
    }

    private requestCheck(): void {
        if (this.isCheckQueued) return;
        this.isCheckQueued = true;
        const check = this.checks.then(() => {
            this.isCheckQueued = false;
            return this.checkLeft();
        });
        this.checks = check.catch(() => undefined);
        DetachedPromises.observe(check, (error) => {
            throw error;
        });
    }

    /** Ends the membership once it is gone from the local state and the chain. */
    private async checkLeft(): Promise<void> {
        const sm = this.stateManager;
        const membership = sm.membershipService;
        if (!this.exit && !isCommittedParticipantStatus(sm.status)) return;
        // a tracked join ends the membership itself: seated, refused,
        // expired, or dropped by an installed state
        if (sm.channelJoinService.isJoinInProgress()) return;
        const participants = await sm.getParticipantsCurrent();
        if (membership.includesSigner(participants)) {
            const exit = this.exit;
            // a new fork that keeps the signer: an exit block of the
            // replaced fork no longer holds; a started exit leaves there. A
            // drop to SYNCED during the read already ended the exit.
            if (
                !exit ||
                sm.forkId === exit.forkId ||
                !isCommittedParticipantStatus(sm.status)
            )
                return;
            this.endExit();
            this.startExit().isLeaveRequested = true;
            return;
        }
        if (await membership.isSignerOnChain()) {
            // an installed reduction that left no participant: only its
            // fork post closes the channel, and no member is left to post it
            if (this.exit && participants.length === 0) this.postSnapshot();
            return;
        }
        // onStatusChanged below ends the exit and emits onLeftChannel
        membership.dropMembership();
    }

    /**
     * A member or pending joiner that becomes SYNCED left, whatever ended
     * the membership: its leave, a removal, a refused or expired join. A new
     * membership (a join, or the opening of a channel) does not carry the
     * ended one's self-removal; a state that lists a leaver again without a
     * join is no new membership and keeps it.
     */
    private onStatusChanged(oldStatus: Status, status: Status): void {
        const wasMember = isCommittedParticipantStatus(oldStatus);
        if (wasMember && status === Status.SYNCED) {
            this.endExit();
            this.logger.info("Left the channel");
            this.stateManager.p2pEventHooks.onLeftChannel?.();
        } else if (isNewMembership(oldStatus, status)) {
            this.stateManager.storage.forceExit.setForceExit(false);
        }
        this.requestCheck();
    }

    private postLatestSnapshot(): void {
        if (this.exit?.isExitBlockCommitted) this.postSnapshot();
    }

    private postSnapshot(): void {
        // the block finalized during a post can be the one that lands the
        // exit, and a leaver commits no later block to post again: it posts
        // once more after this post, unless this post landed the exit
        if (this.isPosting) {
            this.isPostQueued = true;
            return;
        }
        this.isPosting = true;
        // scheduled like a block post: the task tracks the post, so disposal
        // bounds its wait. Its own failure is fatal: it is rethrown as an
        // unhandled rejection. Not DetachedPromises.observe: that also
        // collects the post, and teardown would then wait on a post still
        // waiting for its receipt, past the disposal bound.
        this.stateManager.timeoutManager.scheduleTask(
            () => {
                const post = this.postExitSnapshot();
                void post.catch((error: unknown) => {
                    throw error;
                });
                return post.catch(() => undefined);
            },
            0,
            "exit snapshot post"
        );
    }

    /**
     * One exit post. A chain refusal (e.g. an inbound message the snapshot
     * has not consumed) lands nothing and is logged: the next finalized
     * block, or the one queued during this post, posts again. Any other
     * failure rejects.
     */
    private async postExitSnapshot(): Promise<void> {
        const sm = this.stateManager;
        let posted: StateSnapshot | undefined;
        try {
            posted = await sm.snapshotUpdateService.postStateSnapshotWait(
                sm.forkId
            );
        } catch (error) {
            const refusal = tryDecodeCustomError(error)?.name;
            if (!EXIT_POST_REFUSALS.some((name) => name === refusal))
                throw error;
            this.logger.info("The chain refused the exit snapshot post", {
                refusal
            });
        } finally {
            this.isPosting = false;
            // a posted snapshot that drops this signer landed the exit
            const hasExitLanded =
                posted !== undefined &&
                !sm.membershipService.includesSigner(
                    posted.snapshotData.participants as Address[]
                );
            if (this.isPostQueued) {
                this.isPostQueued = false;
                // one follow-up per queued trigger: an exit block posts
                // again; a reduction that left no participant posts from the
                // check
                if (!hasExitLanded) {
                    if (this.exit?.isExitBlockCommitted) this.postSnapshot();
                    else this.requestCheck();
                }
            }
        }
    }

    /**
     * A member disputes its own removal. A pending join waits another
     * watchdog: it lands, or its expiry ends it. A dispute that loses the
     * evidence race waits for that window's reduction.
     */
    private async onWatchdog(): Promise<void> {
        this.watchdog = undefined;
        const exit = this.exit;
        if (!exit) return;
        const sm = this.stateManager;
        // a join in progress lands (forced in if needed) or ends first
        if (sm.channelJoinService.isJoinInProgress())
            return this.armWatchdog(config.LEAVE_CHANNEL_WATCHDOG_MS);
        // the chain can hold the exit before this runtime observed it: the
        // check ends a settled exit, a restarted one has its own watchdog
        this.requestCheck();
        await this.checks;
        if (this.exit !== exit) return;
        if (sm.storage.disputes.didIDispute(exit.forkId)) return;
        this.logger.info("Starting the leave's self-removal dispute", {
            forkId: exit.forkId
        });
        await sm.disputeManager.dispute(exit.forkId);
    }

    private armWatchdog(delayMs: number): void {
        this.cancelWatchdog();
        this.watchdog = this.stateManager.timeoutManager.scheduleTask(
            () =>
                DetachedPromises.observe(this.onWatchdog(), (error) => {
                    throw error;
                }),
            delayMs,
            "channel leave watchdog"
        );
    }

    private cancelWatchdog(): void {
        if (!this.watchdog) return;
        this.stateManager.timeoutManager.cancelTask(this.watchdog);
        this.watchdog = undefined;
    }

    private endExit(): void {
        if (!this.exit) return;
        this.cancelWatchdog();
        this.exit = undefined;
    }
}

/** A join (a pending joiner) or a channel opening starts a new membership; SYNCED to a member without a join does not. */
function isNewMembership(oldStatus: Status, status: Status): boolean {
    if (isCommittedParticipantStatus(oldStatus)) return false;
    if (status === Status.PENDING_PARTICIPANT) return true;
    return status === Status.PARTICIPATING && oldStatus !== Status.SYNCED;
}
