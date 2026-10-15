import Clock from "@/Clock";
import { StateSnapshot } from "@/models";
import type { PreparedJoinChannelConfirmation } from "@/rpc/network/services";
import type StateManager from "@/stateManager/StateManager";
import type { JoinRecord, JoinUpdate } from "@/storage/ForceJoinStorage";
import { Status, timeoutWaitTime } from "@/types";
import { isCommittedParticipantStatus } from "@/types/flags";
import type { BlockHeight, ForkId, Hash } from "@/types/types";
import { Codec, DetachedPromises, Logger, Type } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import {
    type CustomEvmError,
    isProvenSubmissionFailure,
    tryDecodeCustomError
} from "@/utils/evmErrorHandler";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type {
    BalanceStruct,
    JoinChannelConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

/** A join or top-up submission the chain proved failed (see `isProvenSubmissionFailure`). */
type SubmissionRefusal = { error: unknown; custom: CustomEvmError | null };

/** One join or top-up submission. "uncertain": it may still land. */
type SubmissionOutcome = "submitted" | "uncertain" | SubmissionRefusal;

/**
 * Owns this runtime's join and top-ups; the join record lives in
 * `storage.forceJoin`. A submitted join is pending until
 * the chain mirror shows it; a join whose authorization expires first ends.
 * An observed join that peers do not include within N turns (counted in
 * committed blocks, bounded by a deadline) is forced in by a dispute. The
 * join ends once the status leaves PENDING_PARTICIPANT; a join that ends
 * without a seat (refused, expired) leaves the runtime SYNCED, which the
 * leave service reports as `onLeftChannel`.
 */
export default class ChannelJoinService {
    private readonly logger: Logger;
    private readonly unsubscribers: (() => void)[];
    private joining?: Promise<boolean>;
    private toppingUp?: Promise<boolean>;
    // the authorization expiry before the join is observed, the force-join deadline after
    private timer?: ReturnType<typeof setTimeout>;
    // one join check runs at a time; at most one more waits behind it
    private checks: Promise<void> = Promise.resolve();
    private isCheckQueued = false;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "ChannelJoin" });
        const events = stateManager.events;
        const check = () => this.requestCheck();
        this.unsubscribers = [
            events.on("p2pEventHooks", "onStatusChanged", (_, status) => {
                if (status !== Status.PENDING_PARTICIPANT) this.endJoin();
            }),
            events.on("eventHandler", "onInboundMessagesProcessed", check),
            events.on("eventHandler", "onStateSnapshotUpdated", check)
        ];
    }

    /**
     * Submits a prepared join; a call while one runs gets the same promise.
     * A refusal that a fresh confirmation can win (the threshold set widened,
     * or the channel's on-chain snapshot moved to a stored one) is collected
     * again with the same balance and submitted again, for each such refusal
     * up to the channel's maximum participant count of retries; any other
     * refusal, or one past that cap, is final.
     */
    public joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        return this.shareJoin(() =>
            this.runJoin(
                { confirmation, expectedSnapshotHash, expectedForkId },
                false
            )
        );
    }

    /**
     * Collects a join confirmation for `balance` and submits it like
     * `joinChannel`. A channel already full is neither collected for nor
     * submitted to. A full channel, found here or refused by the chain,
     * aborts the runtime, or leaves it SYNCED with `shouldSpectateWhenFull`.
     * A call while a join runs gets that join's promise.
     */
    public collectAndJoinChannel(
        balance: BalanceStruct,
        shouldSpectateWhenFull: boolean
    ): Promise<boolean> {
        return this.shareJoin(async () => {
            if (await this.isChannelFull()) {
                this.onChannelFull(shouldSpectateWhenFull);
                return false;
            }
            return this.runJoin(
                await this.stateManager.p2pManager.localRpc.joinChannelService.prepareJoinChannelConfirmation(
                    balance
                ),
                shouldSpectateWhenFull
            );
        });
    }

    /** Submits a prepared top-up, retried like a join; a failed top-up keeps the participation. */
    public topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<boolean> {
        return (this.toppingUp ??= this.runTopUp({
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        }).finally(() => {
            this.toppingUp = undefined;
        }));
    }

    /** Whether this runtime tracks a submitted join that is neither seated nor ended. */
    public isJoinInProgress(): boolean {
        return this.stateManager.storage.forceJoin.getJoin() !== undefined;
    }

    /** A committed block that does not seat this pending joiner counts toward the force-join bound. */
    public onBlockCommitted(height: BlockHeight): void {
        const join = this.stateManager.storage.forceJoin.getJoin();
        // A fast table authors N turns before its writers even observe the
        // join: count only blocks committed once this Clock is agreementTime
        // past observing it.
        if (
            join?.countingStartsAt === undefined ||
            Clock.getTimeInSeconds() < join.countingStartsAt
        )
            return;
        if (
            this.updateActiveJoin(join, {
                countingFromHeight: join.countingFromHeight ?? height,
                latestCountedHeight: height
            })
        )
            this.requestCheck();
    }

    public dispose(): void {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        this.cancelTimer();
    }

    /** A join call while one runs gets the running join's promise. */
    private shareJoin(run: () => Promise<boolean>): Promise<boolean> {
        return (this.joining ??= run().finally(() => {
            this.joining = undefined;
        }));
    }

    private async runJoin(
        prepared: PreparedJoinChannelConfirmation,
        shouldSpectateWhenFull: boolean
    ): Promise<boolean> {
        const sm = this.stateManager;
        if (sm.status !== Status.SYNCED)
            throw new Error(
                `joinChannel requires SYNCED status, got ${Status[sm.status]}`
            );
        let attempt = prepared;
        let outcome = await this.submitJoin(attempt);
        // each round retries a refusal that a fresh confirmation can win; a
        // disposed runtime handles no refusal. The cap is the channel's
        // maximum participant count: each threshold refusal means another
        // member landed, and a full channel refuses a join finally.
        for (
            let retries = 0;
            typeof outcome === "object" &&
            !sm.isDisposed &&
            retries < sm.storage.queues.maxChannelParticipants;
            retries++
        ) {
            // one logical join: the refused attempt's expiry and checks retire
            // before the retry is decided and while the fresh confirmation is
            // collected, so nothing ends the join or reports it in between; a
            // check already past a read stops at its next isActive check
            const refused = this.markJoinRetrying();
            if (
                !(await this.shouldRetryWithFreshConfirmation(attempt, outcome))
            )
                break;
            const fresh = await this.prepareConfirmationAgain(
                attempt.confirmation
            );
            // the join ended or the runtime was disposed meanwhile: no
            // further funded submission
            if (sm.isDisposed || !refused || !this.isCurrent(refused))
                return false;
            // a retry that cannot be collected ends the join with no further
            // submission; the race refusal itself is no abort
            if (!fresh) {
                sm.setStatus(Status.SYNCED);
                return false;
            }
            attempt = fresh;
            outcome = await this.submitJoin(attempt);
        }
        // a runtime disposed while a submission was pending handles no refusal
        if (typeof outcome === "object" && !sm.isDisposed)
            this.onJoinRefused(outcome, shouldSpectateWhenFull);
        return outcome === "submitted";
    }

    private async runTopUp(
        prepared: PreparedJoinChannelConfirmation
    ): Promise<boolean> {
        const sm = this.stateManager;
        if (!isCommittedParticipantStatus(sm.status))
            throw new Error(
                `topUpBalance requires PARTICIPATING or PENDING_PARTICIPANT status, got ${Status[sm.status]}`
            );
        let attempt = prepared;
        let outcome = await this.submitTopUp(attempt);
        for (
            let retries = 0;
            typeof outcome === "object" &&
            !sm.isDisposed &&
            retries < sm.storage.queues.maxChannelParticipants &&
            (await this.shouldRetryWithFreshConfirmation(attempt, outcome));
            retries++
        ) {
            const fresh = await this.prepareConfirmationAgain(
                attempt.confirmation
            );
            if (!fresh || sm.isDisposed) return false;
            attempt = fresh;
            outcome = await this.submitTopUp(attempt);
        }
        if (typeof outcome === "object")
            this.logger.warn("topUpBalance failed", {
                error: errorMessage(outcome.error)
            });
        return outcome === "submitted";
    }

    /** One join submission; the runtime is pending from it until the join ends. */
    private async submitJoin({
        confirmation,
        expectedSnapshotHash,
        expectedForkId
    }: PreparedJoinChannelConfirmation): Promise<SubmissionOutcome> {
        const sm = this.stateManager;
        const { deadlineTimestamp } = Codec.decode(
            String(confirmation.signedJoinChannel.encodedJoinChannel),
            Type.JoinChannel
        );
        const join = sm.storage.forceJoin.startJoin(
            sm.storage.blocks.getLatestBlockHeight(sm.forkId),
            Number(deadlineTimestamp)
        );
        sm.setStatus(Status.PENDING_PARTICIPANT);
        this.armUntilJoinExpiry(join);
        this.logger.info("Submitting the join", {
            submissionHeight: join.submissionHeight
        });
        try {
            const tx = await sm.stateChannelManagerContract.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            await tx.wait();
            return "submitted";
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (
                custom?.name === "ErrorJoinChannelParticipantAlreadyExists" &&
                this.isCurrent(join)
            ) {
                this.logger.warn(
                    "joinChannel - participant already exists; keeping the pending join"
                );
                return "submitted";
            }
            if (isProvenSubmissionFailure(error, custom))
                return { error, custom };
            if (await sm.membershipService.isSignerOnChain()) {
                this.logger.warn(
                    "joinChannel - submission outcome uncertain but the chain lists the signer"
                );
                return "submitted";
            }
            this.logger.warn(
                "joinChannel - submission outcome uncertain; keeping the pending join",
                { error: errorMessage(error) }
            );
            return "uncertain";
        }
    }

    private async submitTopUp({
        confirmation,
        expectedSnapshotHash,
        expectedForkId
    }: PreparedJoinChannelConfirmation): Promise<SubmissionOutcome> {
        try {
            const tx =
                await this.stateManager.stateChannelManagerContract.topUpBalance(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                );
            await tx.wait();
            return "submitted";
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            return isProvenSubmissionFailure(error, custom)
                ? { error, custom }
                : "uncertain";
        }
    }

    /**
     * A final join refusal leaves the runtime SYNCED (it left); a race or
     * authorization revert also aborts it, and a full channel is handled by
     * `onChannelFull`.
     */
    private onJoinRefused(
        { error, custom }: SubmissionRefusal,
        shouldSpectateWhenFull: boolean
    ): void {
        const sm = this.stateManager;
        // ends the join (status subscription); LeaveChannelService emits
        // onLeftChannel, before the abort's onAbort below
        sm.setStatus(Status.SYNCED);
        switch (custom?.name) {
            case "ErrorTooManyParticipants":
                this.onChannelFull(shouldSpectateWhenFull);
                return;
            case "RaceConditionJoinChannelExpired":
            case "RaceConditionSnapshotForkMismatch":
            case "RaceConditionJoinChannelSnapshotMismatch":
            case "RaceConditionJoinChannelForkDisputed":
            case "ErrorJoinChannelInvalidSignature":
            case "ErrorJoinChannelConfirmationNotThresholdSigned":
                this.logger.warn(
                    `joinChannel - race condition: ${custom.name}`,
                    {
                        customError:
                            LoggerUtils.getCustomEvmErrorMetadata(custom)
                    }
                );
                sm.abort();
                return;
        }
        this.logger.warn("joinChannel - tx failed, reverting to SYNCED", {
            error: errorMessage(error)
        });
    }

    /** Whether the chain's seated and pending participants already fill the channel. */
    private async isChannelFull(): Promise<boolean> {
        return (
            (
                await this.stateManager.membershipService.getOnChainParticipantUnion()
            ).length >= this.stateManager.storage.queues.maxChannelParticipants
        );
    }

    /** A full channel ends the join: the runtime aborts, or stays SYNCED spectating with `shouldSpectateWhenFull`. */
    private onChannelFull(shouldSpectateWhenFull: boolean): void {
        if (shouldSpectateWhenFull) {
            this.logger.warn("joinChannel - the channel is full; spectating");
            return;
        }
        this.logger.warn("joinChannel - the channel is full; aborting");
        this.stateManager.abort();
    }

    /**
     * Whether a refusal is a race that a fresh confirmation can win: another
     * join landed first and widened the threshold set past the confirmation's
     * signers, or the channel's on-chain snapshot moved to a stored one.
     */
    private async shouldRetryWithFreshConfirmation(
        prepared: PreparedJoinChannelConfirmation,
        { custom }: SubmissionRefusal
    ): Promise<boolean> {
        // a full channel is final, even when the snapshot moved after the refusal
        if (custom?.name === "ErrorTooManyParticipants") return false;
        if (custom?.name === "ErrorJoinChannelConfirmationNotThresholdSigned") {
            this.logger.info(
                "The threshold set changed before the submission landed; a fresh confirmation is submitted again"
            );
            return true;
        }
        return this.hasSnapshotMovedToStoredOne(prepared.expectedSnapshotHash);
    }

    /**
     * Whether the channel's on-chain snapshot moved from `pinnedHash` to
     * another one, with both stored by this runtime: the pin was a real
     * earlier snapshot and the new one is known, so the refusal is the
     * snapshot-update race and a fresh confirmation can be prepared.
     */
    private async hasSnapshotMovedToStoredOne(
        pinnedHash: Hash
    ): Promise<boolean> {
        const sm = this.stateManager;
        const current = StateSnapshot.from(
            await sm.stateChannelManagerContract.getStateSnapshot(sm.channelId)
        );
        const snapshots = sm.storage.stateSnapshots;
        const hasMoved =
            current.hash !== pinnedHash &&
            snapshots.getStateSnapshotByHash(pinnedHash) !== undefined &&
            snapshots.getStateSnapshotByHash(current.hash) !== undefined;
        if (hasMoved)
            this.logger.info(
                "The channel snapshot moved to a stored one before the submission landed; a fresh confirmation is submitted again",
                { pinnedHash, currentHash: current.hash }
            );
        return hasMoved;
    }

    /**
     * A fresh confirmation for the same join or top-up as `confirmation` (its
     * balance), pinned to the channel's current snapshot; undefined when it
     * cannot be collected.
     */
    private async prepareConfirmationAgain(
        confirmation: JoinChannelConfirmationStruct
    ): Promise<PreparedJoinChannelConfirmation | undefined> {
        const { balance } = Codec.decode(
            String(confirmation.signedJoinChannel.encodedJoinChannel),
            Type.JoinChannel
        );
        try {
            return await this.stateManager.p2pManager.localRpc.joinChannelService.prepareJoinChannelConfirmation(
                balance
            );
        } catch (error) {
            this.logger.warn(
                "The fresh confirmation for the retry could not be collected; the call fails without a further submission",
                { error: errorMessage(error) }
            );
            return undefined;
        }
    }

    private requestCheck(): void {
        if (this.isCheckQueued) return;
        this.isCheckQueued = true;
        const check = this.checks.then(() => {
            this.isCheckQueued = false;
            return this.checkJoin();
        });
        this.checks = check.catch(() => undefined);
        DetachedPromises.observe(check, (error) => {
            throw error;
        });
    }

    /**
     * Moves the join on: observed once the chain mirror lists it pending,
     * ended once its authorization expired unlanded, forced in once its
     * block bound or deadline passed.
     */
    private async checkJoin(): Promise<void> {
        // a check queued behind the runtime's disposal starts no read
        if (this.stateManager.isDisposed) return;
        const join = this.stateManager.storage.forceJoin.getJoin();
        // a retry being collected is one logical join with the refused attempt
        if (!join || join.isRetrying) return;
        if (join.countingStartsAt === undefined)
            return this.checkJoinLanded(join);
        // after its own force-join dispute (which can carry a self-removal)
        // the join is settled by its seat or by the chain dropping it
        if (join.isDisputeStarted) return this.checkJoinDropped(join);
        const trigger = await this.getForceJoinTrigger(join);
        if (trigger) await this.startForceJoinDispute(join, trigger);
    }

    /**
     * An observed join that both the installed local state and the chain
     * omit was dropped unseated (e.g. its force-join dispute also removed
     * the signer): the drop to SYNCED ends it and the leave service reports
     * it.
     */
    private async checkJoinDropped(join: JoinRecord): Promise<void> {
        const membership = this.stateManager.membershipService;
        if (await membership.isSignerInLocalState()) return;
        if (await membership.isSignerOnChain()) return;
        if (!this.isActive(join)) return;
        this.logger.info("The chain dropped the observed join");
        membership.dropMembership();
    }

    private async checkJoinLanded(join: JoinRecord): Promise<void> {
        const sm = this.stateManager;
        if (await sm.membershipService.isSignerPendingInMirror())
            return this.onJoinObserved(join);
        // a timer that fires early (or a check run before the deadline)
        // waits for the deadline again rather than ending the check
        if (Clock.getTimeInSeconds() <= join.authorizationDeadline)
            return this.armUntilJoinExpiry(join);
        const { timestamp } = await Clock.getBlockchainTime();
        if (timestamp <= join.authorizationDeadline)
            return this.armUntilJoinExpiry(join);
        // listed on chain: the mirror shows the join next
        if (await sm.membershipService.isSignerOnChain()) return;
        if (!this.isActive(join)) return;
        this.logger.info(
            "The join authorization expired before the join landed"
        );
        // the drop to SYNCED ends the join here (status subscription) and
        // makes LeaveChannelService emit onLeftChannel
        sm.membershipService.dropMembership();
    }

    /**
     * Both force-join bounds start once the join is on chain, never at
     * submission: before it, the peers that must include the join cannot
     * have seen it either. Blocks count from agreementTime later; the
     * deadline is armed now.
     */
    private async onJoinObserved(join: JoinRecord): Promise<void> {
        const sm = this.stateManager;
        const countingStartsAt =
            Clock.getTimeInSeconds() + sm.timeConfig.agreementTime;
        if (!this.updateActiveJoin(join, { countingStartsAt })) return;
        await this.armUntilForceJoinDeadline(join);
    }

    /** What makes the force-join dispute due: its deadline or its block bound; undefined while neither passed. */
    private async getForceJoinTrigger(
        join: JoinRecord
    ): Promise<string | undefined> {
        if (join.isForceJoinDeadlinePassed) return "deadline";
        const { countingFromHeight, latestCountedHeight } = join;
        if (
            countingFromHeight === undefined ||
            latestCountedHeight === undefined ||
            latestCountedHeight <
                countingFromHeight + (await this.getForceJoinTurns())
        )
            return undefined;
        return `block ${latestCountedHeight}`;
    }

    /** Requests the force-join dispute; a deferred one waits another deadline. */
    private async startForceJoinDispute(
        join: JoinRecord,
        trigger: string
    ): Promise<void> {
        const sm = this.stateManager;
        const forkId = sm.forkId;
        const isSignerOnChain = await sm.membershipService.isSignerOnChain();
        // a disposal during the read ends the check: no drop, no dispute
        if (sm.isDisposed) return;
        // an observed join the chain no longer lists was dropped unseated:
        // the drop to SYNCED ends it, and the leave service reports it
        if (!this.isActive(join)) return;
        if (!isSignerOnChain) {
            this.logger.info("The chain dropped the observed join", {
                forkId,
                trigger
            });
            return sm.membershipService.dropMembership();
        }
        const disputeWindowCreationTimestamp = Number(
            await sm.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                sm.channelId,
                forkId
            )
        );
        if (
            disputeWindowCreationTimestamp !== 0 &&
            (await Clock.getBlockchainTime()).timestamp >=
                disputeWindowCreationTimestamp + sm.timeConfig.evidenceTime
        ) {
            this.logger.info(
                "Force join dispute deferred: dispute evidence window expired",
                { forkId, trigger, disputeWindowCreationTimestamp }
            );
            return this.armUntilForceJoinDeadline(join);
        }
        if (!this.updateActiveJoin(join, { isDisputeStarted: true })) return;
        this.cancelTimer();
        this.logger.info(
            "Force join dispute triggered: the join was not included in time",
            { forkId, trigger }
        );
        sm.disputeManager.requestDispute(forkId);
    }

    /** The chain admits the join only in a block not past its authorization deadline. */
    private armUntilJoinExpiry(join: JoinRecord): void {
        if (!this.isActive(join)) return;
        const seconds = Math.max(
            join.authorizationDeadline + 1 - Clock.getTimeInSeconds(),
            1
        );
        this.armTimer(seconds * 1000, "join authorization expiry", () =>
            this.requestCheck()
        );
    }

    /**
     * The block bound needs blocks; a table whose writers author none would
     * hold the join forever. The deadline gives the join the same N turns,
     * each the full window a writer gets before it can be timed out, so an
     * honest table that is merely slow still includes the join first.
     */
    private async armUntilForceJoinDeadline(join: JoinRecord): Promise<void> {
        const sm = this.stateManager;
        const turns = await this.getForceJoinTurns();
        if (!this.updateActiveJoin(join, { isForceJoinDeadlinePassed: false }))
            return;
        this.armTimer(
            turns *
                timeoutWaitTime(sm.timeConfig, join.submissionHeight + 1) *
                1000,
            "force join deadline",
            () => {
                if (
                    this.updateActiveJoin(join, {
                        isForceJoinDeadlinePassed: true
                    })
                )
                    this.requestCheck();
            }
        );
    }

    /** N: one turn for each participant and one more. */
    private async getForceJoinTurns(): Promise<number> {
        return (
            (await this.stateManager.diamondStateMachine.getParticipants())
                .length + 1
        );
    }

    private armTimer(delayMs: number, name: string, onFire: () => void): void {
        this.cancelTimer();
        this.timer = this.stateManager.timeoutManager.scheduleTask(
            () => {
                this.timer = undefined;
                onFire();
            },
            delayMs,
            name
        );
    }

    private cancelTimer(): void {
        if (!this.timer) return;
        this.stateManager.timeoutManager.cancelTask(this.timer);
        this.timer = undefined;
    }

    /**
     * Sets `isRetrying` on the refused join and cancels its timer: its checks
     * stop until the retry submits a new join or the join ends.
     */
    private markJoinRetrying(): JoinRecord | undefined {
        const forceJoin = this.stateManager.storage.forceJoin;
        const refused = forceJoin.getJoin();
        if (refused) forceJoin.updateJoin(refused.id, { isRetrying: true });
        this.cancelTimer();
        return refused;
    }

    private isCurrent(join: JoinRecord): boolean {
        return this.stateManager.storage.forceJoin.getJoin()?.id === join.id;
    }

    /**
     * Whether `join` is still the active submission of a live runtime:
     * current and not retrying. Every check re-reads this after its awaited
     * reads, before it drops the membership, records an observation or arms
     * a timer.
     */
    private isActive(join: JoinRecord): boolean {
        if (this.stateManager.isDisposed) return false;
        const current = this.stateManager.storage.forceJoin.getJoin();
        return current?.id === join.id && !current.isRetrying;
    }

    private updateActiveJoin(join: JoinRecord, update: JoinUpdate): boolean {
        return (
            this.isActive(join) &&
            this.stateManager.storage.forceJoin.updateJoin(join.id, update)
        );
    }

    private endJoin(): void {
        this.cancelTimer();
        this.stateManager.storage.forceJoin.clear();
    }
}
