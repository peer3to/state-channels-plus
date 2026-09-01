// @spec-test-coverage-ignore: restorable timing controls exercised by mapped lobby and negotiation tests
import { Logger } from "@/utils";
import type { ForkId } from "@/types/types";
import type { Status } from "@/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type {
    DisputeSubmissionFailureSpec,
    RecordedDisputeSubmission,
    RecordedFraudProofApply,
    ReductionSimulationErrorName
} from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { waitFor } from "@test/utils/waitFor";
import type {
    HeldLobbyReplyKind,
    HeldNegotiationReplyKind
} from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";

/**
 * RPC-method stubs that wrap a service's `createRPCMethods` host-side.
 *
 * The original generic `stubServiceCreateRpcMethod(fn)` shipped an arbitrary
 * main-thread function into the RPC layer; that can't cross the runtime port
 * (the stub needs the host's `this.senderTransport`/`this.service`/`this.remoteRpc`
 * and SDK imports). Each distinct stub is therefore a concrete, named host-side
 * behavior selected here.
 */
export class RpcStubActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {}

    async holdLobbyReply(
        peerIndex: number,
        kind: HeldLobbyReplyKind
    ): Promise<() => Promise<number>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness.control(peer).stub.holdLobbyReply(kind).request();
        return async () =>
            await this.harness.control(peer).stub.releaseLobbyReply().request();
    }

    async holdNegotiationReply(
        peerIndex: number,
        kind: HeldNegotiationReplyKind
    ): Promise<() => Promise<number>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.holdNegotiationReply(kind)
            .request();
        return async () =>
            await this.harness
                .control(peer)
                .stub.releaseNegotiationReply()
                .request();
    }

    async holdMatchedNegotiation(
        peerIndex: number
    ): Promise<() => Promise<number>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.holdMatchedNegotiation()
            .request();
        return async () =>
            await this.harness
                .control(peer)
                .stub.releaseMatchedNegotiation()
                .request();
    }

    async holdSetChannelId(peerIndex: number): Promise<() => Promise<number>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness.control(peer).stub.holdSetChannelId().request();
        return async () =>
            await this.harness
                .control(peer)
                .stub.releaseSetChannelId()
                .request();
    }

    async overrideLobbyRoleDuration(
        peerIndex: number,
        durationMs: number
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.overrideLobbyRoleDuration(durationMs)
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreLobbyRoleDuration()
                .request();
        };
    }

    /**
     * Make the given peers answer every spectate request with a proof at
     * `staleBlockHeight` (stale-proof guard test). Returns a teardown.
     */
    async stubSpectateStaleProof(
        peerIndices: number[],
        staleBlockHeight: number
    ): Promise<() => Promise<void>> {
        await Promise.all(
            peerIndices.map((i) =>
                this.harness
                    .control(this.harness.getPeer(i))
                    .stub.stubSpectateStaleProof(staleBlockHeight)
                    .request()
            )
        );
        this.logger.debug(
            `Stubbed spectate stale proof (height ${staleBlockHeight}) on peers [${peerIndices.join(", ")}]`
        );
        return async () => {
            await Promise.all(
                peerIndices.map((i) =>
                    this.harness
                        .control(this.harness.getPeer(i))
                        .stub.restoreSpectateStaleProof()
                        .request()
                )
            );
        };
    }

    /**
     * Make the given peers answer every spectate request with undecodable junk
     * bytes (a peer returning data that isn't a valid encoded SyncPayload).
     * Returns a teardown.
     */
    async stubSpectateJunkPayload(
        peerIndices: number[]
    ): Promise<() => Promise<void>> {
        await Promise.all(
            peerIndices.map((i) =>
                this.harness
                    .control(this.harness.getPeer(i))
                    .stub.stubSpectateJunkPayload()
                    .request()
            )
        );
        this.logger.debug(
            `Stubbed spectate junk payload on peers [${peerIndices.join(", ")}]`
        );
        return async () => {
            await Promise.all(
                peerIndices.map((i) =>
                    this.harness
                        .control(this.harness.getPeer(i))
                        .stub.restoreSpectateJunkPayload()
                        .request()
                )
            );
        };
    }

    /**
     * Replace a peer's `onDisputeAcknowledgmentRequest` with a no-op that records
     * the call. Returns a teardown.
     */
    async stubRecordDisputeAckRequest(
        peerIndex: number
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubRecordDisputeAckRequest()
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreRecordDisputeAckRequest()
                .request();
        };
    }

    async wasDisputeAckRequestCalled(peerIndex: number): Promise<boolean> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.wasDisputeAckRequestCalled()
            .request();
    }

    async holdDisputeCommittedEvents(
        peerIndex: number,
        options: {
            /**
             * Let the first new dispute event reach the peer, then drop later
             * events. Defaults to true so the peer validates the original
             * dispute while missing replacement evidence; false drops the
             * original event as well.
             */
            passFirst?: boolean;
        } = {}
    ): Promise<(replay: boolean) => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubHoldDisputeCommittedEvents(options.passFirst ?? true)
            .request();
        return async (replay: boolean) => {
            await this.harness
                .control(peer)
                .stub.restoreDisputeCommittedEvents(replay)
                .request();
        };
    }

    async getHeldDisputeCommittedCount(peerIndex: number): Promise<number> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.getHeldDisputeCommittedCount()
            .request();
    }

    async failNextFinalDisputePreparation(
        peerIndex: number
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubFailNextFinalDisputePreparation()
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreFinalDisputePreparation()
                .request();
        };
    }

    /**
     * Count `onSpectateRequest` calls reaching the given peer (real handler still
     * runs). Returns a teardown. Pair with `getSpectateRequestCount`.
     */
    async stubCountSpectateRequests(
        peerIndex: number
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubCountSpectateRequests()
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreCountSpectateRequests()
                .request();
        };
    }

    async getSpectateRequestCount(peerIndex: number): Promise<number> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.getSpectateRequestCount()
            .request();
    }

    /**
     * Make a peer reply to handshake challenges with a faulty response so the
     * initiator rejects it. `delayMs` forces a request timeout; `responseTime
     * OffsetSeconds` skews the response timestamp. Returns a teardown.
     */
    async stubHandshakeResponse(
        peerIndex: number,
        options: {
            delayMs?: number;
            responseTimeOffsetSeconds?: number;
            corruptSignature?: boolean;
        } = {}
    ): Promise<() => Promise<void>> {
        const {
            delayMs = 0,
            responseTimeOffsetSeconds = 0,
            corruptSignature = false
        } = options;
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubHandshakeResponse(
                delayMs,
                responseTimeOffsetSeconds,
                corruptSignature
            )
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreHandshakeResponse()
                .request();
        };
    }

    /**
     * Disarm a peer's pending reduction timers. Call it before a test that
     * staged reductions ends: an armed timer fires into teardown and leaks its
     * `tryReduce` into the detached-promise drain.
     */
    async cancelScheduledReductions(peerIndex: number): Promise<void> {
        await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.cancelScheduledReductions()
            .request();
    }

    /**
     * Hold every reduction entry point on a peer — the `reduction-*` timers,
     * the StateSnapshotUpdated handler, and the DisputeReducedResultCommitted
     * handler (which reduces on the spot once the challenge period expires) —
     * so a staged race can outrun the peer's own fork transition.
     */
    async holdReductionRace(peerIndex: number): Promise<{
        /** Held StateSnapshotUpdated events so far (chain-event arrival). */
        heldSnapshotEventCount: () => Promise<number>;
        /**
         * Restore all three entry points. Held events replay through the real
         * handlers in chain order (reduced-commit first) unless
         * `replayEvents: false`; held timer tasks are discarded unless
         * `runHeldTasks`.
         */
        release: (options?: {
            replayEvents?: boolean;
            runHeldTasks?: boolean;
            /**
             * Leave `reduction-*` timer scheduling stubbed out. Use it when the
             * test is done driving reductions: restoring scheduling lets a
             * fresh timer arm and fire into teardown, and its `tryReduce` then
             * hangs the detached-promise drain.
             */
            keepTasksHeld?: boolean;
        }) => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubHoldReductionTasks().request();
        await ctl().stubHoldSnapshotUpdatedEvents().request();
        await ctl().stubHoldReducedCommitEvents().request();
        this.logger.debug(
            `Holding reduction race entry points on peer ${peerIndex}`
        );
        return {
            heldSnapshotEventCount: async () =>
                await ctl().getHeldSnapshotUpdatedCount().request(),
            release: async (options = {}) => {
                const {
                    replayEvents = true,
                    runHeldTasks = false,
                    keepTasksHeld = false
                } = options;
                if (keepTasksHeld) {
                    await ctl().dropHeldReductionTasks().request();
                } else {
                    await ctl().restoreReductionTasks(runHeldTasks).request();
                }
                await ctl().restoreReducedCommitEvents(replayEvents).request();
                await ctl()
                    .restoreSnapshotUpdatedEvents(replayEvents)
                    .request();
            }
        };
    }

    /**
     * Blind a peer's log recovery: every `provider.getLogs` throws, so no
     * recovery query can succeed. Subscribed deliveries are unaffected - they
     * arrive over `eth_subscribe`, never through `getLogs`.
     */
    async failChainLogQueries(peerIndex: number): Promise<{
        restore: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubFailChainLogQueries().request();
        this.logger.debug(`Failing chain log queries on peer ${peerIndex}`);
        return {
            restore: async () => {
                await ctl().restoreChainLogQueries().request();
            }
        };
    }

    /**
     * Make a peer's onDisputeCommitted throw -> every dispute log dispatched
     * to it fails, a recovery's re-dispatch included.
     */
    async failDisputeCommittedHandler(peerIndex: number): Promise<{
        /** Dispatches that reached the failing handler so far. */
        handlerCalls: () => Promise<number>;
        restore: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubFailDisputeCommittedHandler().request();
        this.logger.debug(`Failing onDisputeCommitted on peer ${peerIndex}`);
        return {
            handlerCalls: async () =>
                await ctl()
                    .getFailedDisputeCommittedHandlerCallCount()
                    .request(),
            restore: async () => {
                await ctl().restoreDisputeCommittedHandler().request();
            }
        };
    }

    /**
     * Hold a peer's InboundMessagesProcessed handler -> its chain view of the
     * inbound chain stops advancing while block ingest keeps running. Models a
     * lagging chain event: everything downstream of the handler is unapplied.
     *
     * This disables the handler, so on-demand inbound recovery cannot heal it
     * either - recovery re-dispatches the log into the same held handler. Use
     * it to stage the abstain; use `dropInboundMessageLogs` to stage recovery.
     */
    async holdInboundMessageEvents(peerIndex: number): Promise<{
        /** Chain events held so far. */
        heldCount: () => Promise<number>;
        /** Restore the handler; held events replay unless `replay: false`. */
        release: (options?: { replay?: boolean }) => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubHoldInboundMessageEvents().request();
        this.logger.debug(
            `Holding InboundMessagesProcessed on peer ${peerIndex}`
        );
        return {
            heldCount: async () =>
                await ctl().getHeldInboundMessageCount().request(),
            release: async (options = {}) => {
                const { replay = true } = options;
                await ctl().restoreInboundMessageEvents(replay).request();
            }
        };
    }

    /**
     * Lose a peer's subscribed InboundMessagesProcessed deliveries before the
     * event scheduler records them. The handler stays live, so an explicit
     * query of the same log still applies it - this is the fixture on-demand
     * inbound recovery can heal, unlike `holdInboundMessageEvents`.
     *
     * `dropCount: 1` loses one log and lets the next land, which moves the
     * store head above the hole (`MessageBlockStorage.store` advances on any
     * height >= the current one).
     */
    async dropInboundMessageLogs(
        peerIndex: number,
        options: { dropCount?: number } = {}
    ): Promise<{
        /** Distinct logs dropped so far. */
        droppedCount: () => Promise<number>;
        /**
         * Wait until `count` deliveries have been lost. The subscription
         * delivers to this peer independently of the peers a join waits on, so
         * a test that needs the gap staged must wait for it.
         */
        waitUntilDropped: (count?: number, timeoutMs?: number) => Promise<void>;
        /** Stop dropping; already-dropped logs stay recoverable by query. */
        release: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubDropInboundMessageLogs(options.dropCount).request();
        this.logger.debug(
            `Dropping InboundMessagesProcessed logs on peer ${peerIndex}`,
            { dropCount: options.dropCount }
        );
        const droppedCount = async () =>
            await ctl().getDroppedInboundMessageLogCount().request();
        return {
            droppedCount,
            waitUntilDropped: (
                count = 1,
                timeoutMs = this.harness.event.protocolEventTimeoutMs()
            ) =>
                waitFor(async () => (await droppedCount()) >= count, timeoutMs),
            release: async () => {
                await ctl().restoreInboundMessageLogs().request();
            }
        };
    }

    /**
     * Record what `dispute()` uploads on a peer without sending it. With
     * `hold: true` every recorded send parks until `release`, so a second
     * `dispute()` can be observed queueing behind the dispute mutex.
     */
    async recordDisputeSubmissions(
        peerIndex: number,
        options: {
            hold?: boolean;
            failWith?: DisputeSubmissionFailureSpec;
        } = {}
    ): Promise<{
        submissions: () => Promise<RecordedDisputeSubmission[]>;
        /** Sends parked at the hold so far. */
        heldCount: () => Promise<number>;
        waitUntilHeld: (timeoutMs?: number) => Promise<void>;
        release: () => Promise<void>;
        restore: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl()
            .stubRecordDisputeSubmissions(
                options.hold ?? false,
                options.failWith
            )
            .request();
        const recorded = () => ctl().getRecordedDisputeSubmissions().request();
        const heldCount = async () => (await recorded()).held;
        return {
            submissions: async () => (await recorded()).submissions,
            heldCount,
            waitUntilHeld: (
                timeoutMs = this.harness.event.protocolEventTimeoutMs()
            ) => waitFor(async () => (await heldCount()) > 0, timeoutMs),
            release: async () => {
                await ctl().releaseDisputeSubmissions().request();
            },
            restore: async () => {
                await ctl().restoreDisputeSubmissions().request();
            }
        };
    }

    /**
     * Record `killDispute`'s on-chain apply on a peer (the real transaction
     * still runs). With `hold: true` every send parks until `release`, so
     * several kills can be staged inside one live kill window.
     */
    async recordDisputeFraudProofApplies(
        peerIndex: number,
        options: {
            hold?: boolean;
            failWith?: DisputeSubmissionFailureSpec;
        } = {}
    ): Promise<{
        applies: () => Promise<RecordedFraudProofApply[]>;
        /** Sends parked at the hold so far. */
        heldCount: () => Promise<number>;
        waitUntilHeld: (count: number, timeoutMs?: number) => Promise<void>;
        release: () => Promise<void>;
        restore: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl()
            .stubRecordDisputeFraudProofApplies(
                options.hold ?? false,
                options.failWith
            )
            .request();
        const recorded = () =>
            ctl().getRecordedDisputeFraudProofApplies().request();
        const heldCount = async () => (await recorded()).held;
        return {
            applies: async () => (await recorded()).applies,
            heldCount,
            waitUntilHeld: (
                count,
                timeoutMs = this.harness.event.protocolEventTimeoutMs()
            ) => waitFor(async () => (await heldCount()) >= count, timeoutMs),
            release: async () => {
                await ctl().releaseDisputeFraudProofApplies().request();
            },
            restore: async () => {
                await ctl().restoreDisputeFraudProofApplies().request();
            }
        };
    }

    /** Keep a peer out of a kill race. Returns a teardown. */
    async suppressDisputeKill(peerIndex: number): Promise<{
        skippedCount: () => Promise<number>;
        /** The first skipped kill also marks the proof as stored. */
        waitUntilSkipped: (timeoutMs?: number) => Promise<void>;
        restore: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubSuppressDisputeKill().request();
        const skippedCount = () =>
            ctl().getSuppressedDisputeKillCount().request();
        return {
            skippedCount,
            waitUntilSkipped: (
                timeoutMs = this.harness.event.protocolEventTimeoutMs()
            ) => waitFor(async () => (await skippedCount()) > 0, timeoutMs),
            restore: async () => {
                await ctl().restoreDisputeKill().request();
            }
        };
    }

    async disputeMutexWaiterCount(peerIndex: number): Promise<number> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.getDisputeMutexWaiterCount()
            .request();
    }

    /** Resolve once a second `dispute()` caller is queued behind the mutex. */
    async waitUntilDisputeMutexContended(
        peerIndex: number,
        timeoutMs = this.harness.event.protocolEventTimeoutMs()
    ): Promise<void> {
        await waitFor(
            async () => (await this.disputeMutexWaiterCount(peerIndex)) > 0,
            timeoutMs
        );
    }

    /**
     * Park a peer's `constructDispute` at its first async boundary (the state
     * proof read) for `forkId`. `waitUntilParked` resolves once a construction
     * is actually held, so a test can land a real fraud proof inside the window
     * and then `release` it.
     */
    async holdConstructDisputeAtStateProof(
        peerIndex: number,
        forkId: ForkId
    ): Promise<{
        waitUntilParked: (timeoutMs?: number) => Promise<void>;
        parkedCount: () => Promise<number>;
        release: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubPauseConstructDisputeAtStateProof(forkId).request();
        this.logger.debug(
            `Holding constructDispute at the state proof read on peer ${peerIndex}`
        );
        const parkedCount = async () =>
            (await ctl().getPausedConstructDisputeStatus().request()).entered;
        return {
            parkedCount,
            waitUntilParked: (
                timeoutMs = this.harness.event.protocolEventTimeoutMs()
            ) => waitFor(async () => (await parkedCount()) > 0, timeoutMs),
            release: async () => {
                await ctl().restorePausedConstructDispute().request();
            }
        };
    }

    /** Make `ReductionManager.tryReduce` a counted no-op. Returns a teardown. */
    async reduceNoop(peerIndex: number): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness.control(peer).stub.stubReduceNoop().request();
        return async () => {
            await this.harness.control(peer).stub.restoreReduce().request();
        };
    }

    /** Count `ReductionManager.tryReduce` calls while forwarding to the real one. */
    async recordReduce(peerIndex: number): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness.control(peer).stub.stubRecordReduce().request();
        return async () => {
            await this.harness.control(peer).stub.restoreReduce().request();
        };
    }

    async reduceCallCount(peerIndex: number): Promise<number> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.getReduceCallCount()
            .request();
    }

    async releaseReductionWithSimulationError(
        peerIndex: number,
        errorName: ReductionSimulationErrorName
    ): Promise<void> {
        const stub = this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await stub.stubNextReductionSimulationError(errorName).request();
        await stub.restoreReductionTasks(true).request();
    }

    /**
     * Count `spectateService.sync` requests on the peer; `forward: false`
     * records without running the real sync (keeps the sync-failure
     * punishment path quiet during staging). Returns a teardown.
     */
    async recordSpectateSync(
        peerIndex: number,
        options: { forward: boolean }
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubRecordSpectateSync(options.forward)
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreSpectateSync()
                .request();
        };
    }

    /**
     * Stop a peer running the participant-timeout check, so staging is not cut
     * short by a real timeout dispute. Returns a teardown.
     */
    async suppressTimeoutCheck(
        peerIndex: number
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubSuppressTimeoutCheck()
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restoreSuppressTimeoutCheck()
                .request();
        };
    }

    /**
     * Record every scheduled task's label and delay on a peer; tasks matching
     * `suppressPrefix` are recorded without running.
     */
    async recordScheduledTasks(
        peerIndex: number,
        options: { suppressPrefix?: string } = {}
    ): Promise<{
        tasks: () => Promise<{ taskName: string; delayMs: number }[]>;
        restore: () => Promise<void>;
    }> {
        const ctl = () =>
            this.harness.control(this.harness.getPeer(peerIndex)).stub;
        await ctl().stubRecordScheduledTasks(options.suppressPrefix).request();
        return {
            tasks: async () =>
                (await ctl().getRecordedScheduledTasks().request()).tasks,
            restore: async () => {
                await ctl().restoreRecordScheduledTasks().request();
            }
        };
    }

    /** Staging: force a peer's session status (fault injection). */
    async setPeerStatus(peerIndex: number, status: Status): Promise<void> {
        await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.setPeerStatus(status)
            .request();
    }

    async spectateSyncCallCount(peerIndex: number): Promise<number> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.getSpectateSyncCallCount()
            .request();
    }

    /**
     * Addresses this peer asked to sync from, once `count` sync calls have
     * landed. Resolved by the record stub, so no polling - but the request is
     * parked host-side for as long as that takes, so it needs a timeout well
     * past the queue window (the RPC default is 6s).
     */
    async spectateSyncTargetsWait(
        peerIndex: number,
        count: number,
        timeoutMs = this.harness.event.protocolEventTimeoutMs()
    ): Promise<string[]> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.waitForSpectateSyncCalls(count)
            .request({ timeoutMs });
    }
}
