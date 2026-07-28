import { Logger } from "@/utils";
import type { ForkId } from "@/types/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type {
    RecordedDisputeSubmission,
    ReductionSimulationErrorName
} from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import { waitFor } from "@test/utils/waitFor";

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
                const { replayEvents = true, runHeldTasks = false } = options;
                await ctl().restoreReductionTasks(runHeldTasks).request();
                await ctl().restoreReducedCommitEvents(replayEvents).request();
                await ctl()
                    .restoreSnapshotUpdatedEvents(replayEvents)
                    .request();
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
        options: { hold?: boolean } = {}
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
            .stubRecordDisputeSubmissions(options.hold ?? false)
            .request();
        const recorded = () => ctl().getRecordedDisputeSubmissions().request();
        const heldCount = async () => (await recorded()).held;
        return {
            submissions: async () => (await recorded()).submissions,
            heldCount,
            waitUntilHeld: (timeoutMs = 10000) =>
                waitFor(async () => (await heldCount()) > 0, timeoutMs),
            release: async () => {
                await ctl().releaseDisputeSubmissions().request();
            },
            restore: async () => {
                await ctl().restoreDisputeSubmissions().request();
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
        timeoutMs = 10000
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
            waitUntilParked: (timeoutMs = 10000) =>
                waitFor(async () => (await parkedCount()) > 0, timeoutMs),
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

    async spectateSyncCallCount(peerIndex: number): Promise<number> {
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.getSpectateSyncCallCount()
            .request();
    }
}
