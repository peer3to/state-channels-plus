import IOnMessage from "@/IOnMessage";
import type StateManager from "@/stateManager";
import Rpc, {
    deserializeRpc,
    deserializeRpcResponse,
    MAX_RPC_FRAME_BYTES,
    RpcResponse
} from "@/rpc/Rpc";
import MainRpcService from "@/rpc/MainRpcService";
import { P2pSigner } from "@/evm";
import { ATransport, LoopbackTransport, TransportType } from "@/transport";
import ProfileManager from "@/ProfileManager";
import Holepunch from "@/Holepunch";
import { ethers } from "ethers";
import { DebugProxy, getChecksumAddress, LocalDiscoveryServer } from "@/utils";
import type { Logger } from "@/utils";
import { Buffer } from "buffer";
import { config, isNodeRuntime } from "@/utils/config";
import { Address, ChannelId } from "./types/types";
import { isInstanceOfRpcService } from "./utils/ObjectChecks";
import type ARpcService from "@/rpc/ARpcService";
import RemoteRpcProxy, { RemoteRpcProxyType } from "./rpc/RemoteRpcProxy";
import type { CustomRpcConstructor } from "./rpc/registry";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { sleep } from "@/utils";
import type { SyncFailReason } from "@/rpc/services/spectate/SpectateService";

/** Max distinct connected peers tried, one at a time, before giving up. */
const MAX_RESUME_SYNC_PEERS = 3;
/** Caps TOTAL attempts (including collision-deferred retries) so a peer that
 * always collides can't spin the whole budget without progress. */
const MAX_RESUME_SYNC_ATTEMPTS = MAX_RESUME_SYNC_PEERS * 2;
/** Fixed delay between peer-switch attempts. */
const RESUME_PEER_SWITCH_DELAY_MS = 500;
/**
 * Per-attempt request timeout for a resume sync. Deliberately NOT
 * timeConfig.agreementTime (5s) - a placeholder pending devops SPIKE-0's
 * measured RTT figures for the resume path specifically.
 */
const RESUME_SYNC_TIMEOUT_MS = 8000;
/** Resume must leave window for be-03's self-defense/back-off. */
const RESUME_BUDGET_FRACTION = 0.5;
/** Share of the total resume budget given to hydrate and to transport rejoin
 * each; the rest goes to peer rotation. No single correct split - chosen so
 * neither phase alone can exhaust the budget before rotation gets a turn. */
const RESUME_HYDRATE_BUDGET_FRACTION = 0.25;
const RESUME_REJOIN_BUDGET_FRACTION = 0.25;

export type ResumeFailReason =
    | "transport"
    | "hydration-failed"
    | "no-peers"
    | "deadline-expired"
    | SyncFailReason;

export type ResumeResult =
    | { status: "restored"; localWasAhead: boolean }
    | { status: "failed"; reason: ResumeFailReason; retryable: boolean };

/** Raised by withDeadline() when the wrapped phase outran its own sub-budget
 * (not the phase itself failing). */
class ResumePhaseTimeoutError extends Error {}

/** Races `promise` against `timeoutMs`; on timeout throws
 * ResumePhaseTimeoutError but does not cancel the underlying operation. */
function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => {
                reject(
                    new ResumePhaseTimeoutError(
                        `resume phase exceeded ${timeoutMs}ms`
                    )
                );
            },
            Math.max(0, timeoutMs)
        );
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

class P2PManager<TCustomRpc extends MainRpcService = MainRpcService>
    implements IOnMessage
{
    stateManager: StateManager<TCustomRpc>;
    logger: Logger;
    p2pSigner: P2pSigner<TCustomRpc>;
    profileManager = new ProfileManager();
    localRpc: TCustomRpc;
    remoteRpc: RemoteRpcProxyType<TCustomRpc>;
    /** In-process transport used for "send to self" (no-target) delivery. */
    loopbackTransport: LoopbackTransport;
    //TODO - map EVM address to websocket
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = config.DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;

    // Dedups concurrent resumeFromBackground() calls. A single in-flight
    // promise (not a per-channel map) is enough: this P2PManager instance is
    // itself scoped to one channel, via `stateManager`.
    private resumeInFlight?: Promise<ResumeResult>;
    // Set synchronously by dispose(); the resume path checks this between
    // every await so it never acts on a torn-down transport/storage.
    private disposed = false;

    private rpcRequestCounter = 0;
    private pendingRpcRequests = new Map<
        string,
        {
            resolve: (value: any) => void;
            reject: (reason: Error) => void;
            transport: ATransport;
            timeout: ReturnType<typeof setTimeout>;
        }
    >();
    private disposalPromise?: Promise<void>;

    constructor(
        stateManager: StateManager<TCustomRpc>,
        signer: ethers.Signer,
        customRpc?: CustomRpcConstructor<TCustomRpc, any>,
        customRpcOptions?: any
    ) {
        this.stateManager = stateManager;
        this.logger = stateManager.logger.child({ component: "P2PManager" });
        if (config.DEBUG_LOCAL_TRANSPORT) {
            LocalDiscoveryServer.setLogger(this.logger);
        }
        this.p2pSigner = new P2pSigner(
            signer,
            stateManager.signerAddress,
            this.self
        );

        if (customRpc) {
            this.localRpc = new customRpc(
                this.self,
                customRpcOptions
            ) as TCustomRpc;
        } else {
            if (customRpcOptions !== undefined) {
                throw new Error(
                    "customRpcOptions requires customRpc to be configured"
                );
            }
            this.localRpc = new MainRpcService(this.self) as TCustomRpc;
        }
        this.remoteRpc = RemoteRpcProxy.createProxy(
            this.localRpc
        ) as unknown as RemoteRpcProxyType<TCustomRpc>;
        this.loopbackTransport = new LoopbackTransport(this.self);
        this.holepunch = new Holepunch(this.self);
        return this.self;
    }
    //Mark resources for garbage collection
    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }
        // Flip before awaiting anything so a resume in flight (or one racing
        // to start) observes disposal and bails instead of acting on
        // torn-down state.
        this.disposed = true;
        this.disposalPromise = this.finishDispose();
        return this.disposalPromise;
    }

    private async finishDispose(): Promise<void> {
        // Let an in-flight resume unwind on its own (it self-terminates on
        // the `disposed` flag) before tearing down connections/swarm.
        if (this.resumeInFlight) {
            await this.resumeInFlight.catch(() => undefined);
        }
        this.disconnectAll();
        await this.holepunch.dispose();
    }
    public broadcastRpc(rpc: Rpc) {
        const debugConnections = this.openConnections.map((transport) => {
            return {
                transportType: transport.transportType,
                peerAddress: transport.peerAddress
            };
        });
        this.logger.debug("broadcastRpc", {
            rpc: LoggerUtils.getRpcLogMetadata(rpc),
            debugConnections
        });
        for (const transport of this.openConnections) {
            transport.send(rpc);
        }
    }

    /**
     * Sends a request-style RPC to a single peer and resolves with the value the
     * peer's handler returns. The promise rejects on a remote error, transport
     * disconnect, or after `timeoutMs` (time safety).
     */
    public sendRpcRequest<T = unknown>(
        rpc: Rpc,
        transport: ATransport,
        options?: { timeoutMs?: number }
    ): Promise<T> {
        const requestId = `${++this.rpcRequestCounter}`;
        // `agreementTime` is in seconds; the RPC timeout is in milliseconds.
        const timeoutMs =
            options?.timeoutMs ??
            this.stateManager.timeConfig.agreementTime * 1000;

        return new Promise<T>((resolve, reject) => {
            const timeout = this.stateManager.timeoutManager.scheduleTask(
                () => {
                    if (this.pendingRpcRequests.delete(requestId)) {
                        reject(
                            new Error(
                                `RPC request '${rpc.service}.${rpc.method}' timed out after ${timeoutMs}ms`
                            )
                        );
                    }
                },
                timeoutMs,
                `rpcRequest:${rpc.service}.${rpc.method}`
            );

            this.pendingRpcRequests.set(requestId, {
                resolve,
                reject,
                transport,
                timeout
            });

            try {
                transport.send({ ...rpc, requestId });
            } catch (e) {
                if (this.pendingRpcRequests.delete(requestId)) {
                    this.stateManager.timeoutManager.cancelTask(timeout);
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            }
        });
    }

    private handleRpcResponse(response: RpcResponse, transport: ATransport) {
        const pending = this.pendingRpcRequests.get(response.requestId);
        if (!pending) return;
        // Only the peer we sent the request to may settle it. Compare by peer
        // identity (not transport object) so a transport upgrade for the same
        // peer (e.g. HOLEPUNCH -> WEBRTC) still settles the pending request.
        if (!ATransport.isSamePeer(pending.transport, transport)) {
            this.disconnectAndBlacklistPeer(transport);
            return;
        }
        this.pendingRpcRequests.delete(response.requestId);
        this.stateManager.timeoutManager.cancelTask(pending.timeout);
        if (response.ok) {
            pending.resolve(response.result);
        } else {
            pending.reject(
                new Error(response.error ?? "RPC request failed on the peer")
            );
        }
    }

    private rejectPendingRpcRequestsForTransport(
        transport: ATransport,
        reason: Error
    ): void {
        for (const [requestId, pending] of this.pendingRpcRequests) {
            if (pending.transport !== transport) continue;
            this.pendingRpcRequests.delete(requestId);
            this.stateManager.timeoutManager.cancelTask(pending.timeout);
            pending.reject(reason);
        }
    }

    public onRpc(serializedRpc: string, transport: ATransport) {
        try {
            // Reject oversized frames before parsing so a peer can't force
            // unbounded JSON.parse/dispatch work.
            if (serializedRpc.length > MAX_RPC_FRAME_BYTES) {
                this.logger.warn("Oversized RPC frame; disconnecting", {
                    bytes: serializedRpc.length,
                    transportType: TransportType[transport.transportType],
                    peerAddress: transport.peerAddress
                });
                this.disconnectConnection(transport);
                return;
            }
            const response = deserializeRpcResponse(serializedRpc);
            if (response) {
                this.handleRpcResponse(response, transport);
                return;
            }
            const rpc = deserializeRpc(serializedRpc);
            this.logger.verbose("onRpc", {
                rpc: rpc ? LoggerUtils.getRpcLogMetadata(rpc) : undefined,
                transportType: TransportType[transport.transportType],
                peerAddress: transport.peerAddress
            });
            if (!rpc) {
                this.disconnectConnection(transport);
                return;
            }
            if (!isInstanceOfRpcService(this.localRpc, rpc.service)) {
                this.disconnectConnection(transport);
                return;
            }
            const service = this.localRpc[
                rpc.service
            ] as unknown as ARpcService<any>;
            const success = service.runRPC(rpc, transport);
            if (!success) {
                this.disconnectConnection(transport);
                return;
            }
        } catch (e) {
            this.disconnectConnection(transport);
            this.logger.error("onRpc - error handling RPC frame", {
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
                transportType: TransportType[transport.transportType],
                peerAddress: transport.peerAddress
            });
        }
    }
    public async tryOpenConnectionToChannel(channelId: string) {
        if (config.DEBUG_LOCAL_TRANSPORT) {
            // In the browser there's no harness fixture to drive discovery, so
            // form the local mesh here via the relay hub. In node the harness
            // drives LocalDiscoveryServer.connectToPeers itself (and also sets a
            // registry URL for its own peer-mesh), so stay a no-op there.
            if (!isNodeRuntime() && config.LOCAL_DISCOVERY_REGISTRY_URL) {
                await LocalDiscoveryServer.tryStart();
                await LocalDiscoveryServer.connectToPeers(
                    this.self,
                    channelId,
                    this.stateManager.signerAddress.toString()
                );
            }
            return;
        }
        const topic = Buffer.alloc(32).fill(channelId);
        await this.holepunch.join(topic);
    }
    public addConnection(transport: ATransport) {
        // A "connection" only exists after full handshake completion.
        if (!this.openConnections.includes(transport)) {
            this.openConnections.push(transport);
        }
    }

    public disconnectConnection(transport: ATransport) {
        const profile = this.profileManager.getProfileByTransport(transport);

        this.rejectPendingRpcRequestsForTransport(
            transport,
            new Error("Peer disconnected before RPC response arrived")
        );

        this.openConnections = this.openConnections.filter(
            (t) => t !== transport
        );
        profile && this.profileManager.removeTransport(transport);

        try {
            transport.close();
        } catch {
            // ignore
        }
    }

    public disconnectAndBlacklistPeer(transport: ATransport, cause?: string) {
        this.profileManager.getProfileByTransport(transport)?.blacklist();

        this.disconnectConnection(transport);
    }

    public disconnectAndBlacklistPeerByEvmAddress(evmAddress: Address) {
        const profile = this.profileManager.getProfileByEvmAddress(evmAddress);
        if (!profile) return;
        profile.blacklist();
        const transport = profile.getTransport();
        if (!transport) return;
        this.disconnectConnection(transport);
    }

    public disconnectAndBlacklistPeers(peers: Iterable<Address>) {
        for (const peer of peers) {
            this.disconnectAndBlacklistPeerByEvmAddress(peer);
        }
    }

    public isBlacklisted(evmAddress: Address): boolean {
        return (
            this.profileManager.getProfileByEvmAddress(evmAddress)
                ?.isBlackListed || false
        );
    }

    public disconnectAll() {
        for (const transport of this.openConnections) {
            this.disconnectConnection(transport);
        }
    }

    /**
     * Returns a snapshot of currently connected peer identities (EVM addresses).
     */
    public getConnectedPeers(): Set<Address> {
        const addresses = new Set<Address>();
        for (const transport of this.openConnections) {
            const fromTransport = transport.peerAddress;
            if (fromTransport) {
                // Boundary: transport.peerAddress can originate outside ethers.
                addresses.add(getChecksumAddress(fromTransport));
                continue;
            }

            const profile =
                this.profileManager.getProfileByTransport(transport);
            const fromProfile = profile?.getEvmAddress();
            if (fromProfile) {
                addresses.add(fromProfile.toString());
            }
        }
        return addresses;
    }

    /**
     * Mobile reconnect: recover a backgrounded channel without tearing down
     * the process-global Holepunch swarm (it's shared across every open
     * channel - see Holepunch.ts/HolepunchRelay.ts). Dedups concurrent calls
     * by returning the in-flight promise.
     */
    public resumeFromBackground(): Promise<ResumeResult> {
        if (this.resumeInFlight) return this.resumeInFlight;
        if (this.disposed) {
            return Promise.resolve({
                status: "failed",
                reason: "transport",
                retryable: false
            });
        }

        const channelId = this.stateManager.getChannelId();
        this.resumeInFlight = this.doResumeFromBackground(channelId).finally(
            () => {
                this.resumeInFlight = undefined;
            }
        );
        return this.resumeInFlight;
    }

    private disposedResumeResult(): ResumeResult {
        return { status: "failed", reason: "transport", retryable: false };
    }

    private async doResumeFromBackground(
        channelId: ChannelId
    ): Promise<ResumeResult> {
        // Budget from the steady-state timeout window (height >= 1). The
        // height-0 evidence grace is deliberately excluded: storage isn't
        // hydrated yet so the in-memory height can't be trusted, and the
        // shorter window is the conservative side for the budget cap.
        const totalBudgetMs =
            this.stateManager.getTimeoutWaitTimeSeconds(1) *
            1000 *
            RESUME_BUDGET_FRACTION;
        const deadline = Date.now() + totalBudgetMs;

        // enterResumeWindow() must precede the transport rejoin: the rejoin
        // triggers the handshake that fires InitHandshakeService's reactive
        // sync, which is exactly what the resume window's non-destructive
        // failure policy exists to tame. exitResumeWindow() runs in finally
        // so no throw/early-return leaves that policy suppressed forever.
        //
        // Exception: `withDeadline` never cancels the operation it wraps -
        // on a rejoin-phase timeout, the real `holepunch.join(topic)` call
        // is still running when we return below. If the outer `finally`
        // closed the window right then, a handshake completing shortly
        // after (while this method has already returned) could fire a
        // reactive sync with the window closed - reopening the exact
        // "reactive sync hard-aborts the state manager mid-restore" race
        // this window exists to prevent. `deferWindowCloseToRejoinSettle`
        // lets the rejoin-timeout branch opt the outer `finally` out of
        // closing the window itself; closing is instead attached directly
        // to the real (uncancelled) rejoin promise so it only happens once
        // that promise has genuinely settled - see below.
        let deferWindowCloseToRejoinSettle = false;
        this.localRpc.spectateService.enterResumeWindow();
        try {
            if (this.disposed) return this.disposedResumeResult();

            this.stateManager.p2pEventHooks.onResumePhase?.("reconnecting");

            // Storage must be hydrated strictly before the transport/topic
            // join (same ordering Storage.attachPersistence and
            // P2pRuntimeHost's connect path require) - otherwise a handshake
            // completing on the rejoined transport can fire a reactive sync
            // that mutates state on top of a half-replayed store.
            const hydrateBudgetMs = Math.min(
                Math.max(0, deadline - Date.now()),
                totalBudgetMs * RESUME_HYDRATE_BUDGET_FRACTION
            );
            try {
                await withDeadline(
                    this.stateManager.storage.hydrate(),
                    hydrateBudgetMs
                );
            } catch (e) {
                if (e instanceof ResumePhaseTimeoutError) {
                    return {
                        status: "failed",
                        reason: "deadline-expired",
                        retryable: true
                    };
                }
                this.logger.warn(
                    "resumeFromBackground - storage hydrate failed",
                    {
                        channelId,
                        error: e instanceof Error ? e.message : String(e)
                    }
                );
                return {
                    status: "failed",
                    reason: "hydration-failed",
                    retryable: true
                };
            }

            if (this.disposed) return this.disposedResumeResult();

            const rejoinBudgetMs = Math.min(
                Math.max(0, deadline - Date.now()),
                totalBudgetMs * RESUME_REJOIN_BUDGET_FRACTION
            );
            // Held outside the try so the timeout branch below can attach a
            // settle-time window-close to the REAL promise, not the
            // withDeadline() wrapper (which already settled via timeout).
            const rejoinCall = this.tryOpenConnectionToChannel(
                String(channelId)
            );
            try {
                // Topic rejoin (Holepunch.rejoinTopics via join(), idempotent)
                // + whatever re-handshake the existing connection flow
                // drives. Never touches the shared swarm singleton itself.
                await withDeadline(rejoinCall, rejoinBudgetMs);
            } catch (e) {
                if (e instanceof ResumePhaseTimeoutError) {
                    // rejoinCall is still in flight. Don't let the outer
                    // finally close the resume window now - defer the close
                    // to whenever rejoinCall itself actually settles, so a
                    // handshake that completes after we've already returned
                    // still lands inside an open window.
                    deferWindowCloseToRejoinSettle = true;
                    rejoinCall
                        .finally(() =>
                            this.localRpc.spectateService.exitResumeWindow()
                        )
                        .catch(() => undefined);
                    return {
                        status: "failed",
                        reason: "deadline-expired",
                        retryable: true
                    };
                }
                this.logger.warn(
                    "resumeFromBackground - transport rejoin failed",
                    {
                        channelId,
                        error: e instanceof Error ? e.message : String(e)
                    }
                );
                return {
                    status: "failed",
                    reason: "transport",
                    retryable: true
                };
            }

            if (this.disposed) return this.disposedResumeResult();

            this.stateManager.p2pEventHooks.onResumePhase?.("resyncing");

            try {
                return await this.resyncWithPeerSwitch(channelId, deadline);
            } catch (e) {
                this.logger.warn("resumeFromBackground - unexpected error", {
                    channelId,
                    error: e instanceof Error ? e.message : String(e)
                });
                return {
                    status: "failed",
                    reason: "transport",
                    retryable: true
                };
            }
        } finally {
            // Skip the normal close if it was handed off to rejoinCall's own
            // settle-time handler above - otherwise we'd double-decrement
            // resumeWindowDepth (once here, once when rejoinCall settles).
            if (!deferWindowCloseToRejoinSettle) {
                this.localRpc.spectateService.exitResumeWindow();
            }
        }
    }

    /**
     * Rotates connected peers one at a time (never concurrently) via the
     * awaitable resume sync, within the remaining budget.
     *
     * `tryOpenConnectionToChannel` (already awaited before this method runs)
     * does NOT wait for handshakes to complete - it just fires
     * `holepunch.join(topic)` and returns. `getConnectedPeers()` only counts
     * fully-handshaked transports, so a single snapshot taken once at the
     * start can legitimately be empty even though peers are seconds (or
     * milliseconds) away from finishing their handshake. So candidates are
     * NOT queued up once at the start - `getConnectedPeers()` is re-read
     * fresh whenever the working queue runs dry, and if that fresh read is
     * STILL empty, we sleep and poll again rather than giving up, until
     * either a peer becomes available or the deadline is exhausted.
     *
     * On "in-flight-collision" the peer is deferred to the back of the
     * (current) queue (that sync may finish and resync us within a beat)
     * rather than retried immediately or permanently excluded - so one
     * perpetually-colliding peer can't starve a healthy peer further back.
     * Any other failure permanently excludes that peer for this resume
     * attempt. Distinct peers are capped at MAX_RESUME_SYNC_PEERS; total
     * attempts (including collision re-tries) are capped at
     * MAX_RESUME_SYNC_ATTEMPTS.
     *
     * "no-peers" is only returned once the deadline is exhausted with zero
     * attempts EVER launched (i.e. no peer was available to try during the
     * entire window) - not merely because the queue was momentarily empty.
     */
    private async resyncWithPeerSwitch(
        channelId: ChannelId,
        deadline: number
    ): Promise<ResumeResult> {
        const queue: Address[] = [];
        const distinctPeers = new Set<Address>();
        // Peers that failed with a non-collision (permanently-excluding)
        // reason during this resume attempt; never re-queued even if a
        // later poll of getConnectedPeers() still reports them connected.
        const excludedPeers = new Set<Address>();
        let attempts = 0;
        let lastFailure:
            | { reason: ResumeFailReason; retryable: boolean }
            | undefined;

        const isEligibleForQueue = (peer: Address): boolean =>
            !excludedPeers.has(peer) &&
            (distinctPeers.has(peer) ||
                distinctPeers.size < MAX_RESUME_SYNC_PEERS);

        while (Date.now() < deadline && attempts < MAX_RESUME_SYNC_ATTEMPTS) {
            if (this.disposed) return this.disposedResumeResult();

            if (queue.length === 0) {
                // Re-read live handshake state fresh on every refill - never
                // reuse a stale snapshot from an earlier iteration.
                for (const peer of this.getConnectedPeers()) {
                    if (isEligibleForQueue(peer)) queue.push(peer);
                }
            }

            if (queue.length === 0) {
                if (distinctPeers.size >= MAX_RESUME_SYNC_PEERS) {
                    // Distinct-peer cap already reached and nothing is
                    // queued (no collision-deferred retry pending) - no
                    // future poll of getConnectedPeers() can ever add a new
                    // eligible candidate, since isEligibleForQueue() only
                    // admits already-seen peers once the cap is hit. Further
                    // polling here would just burn the remaining budget
                    // sleeping for no possible gain, so stop and report the
                    // last attempt's failure instead.
                    break;
                }
                const remainingMs = deadline - Date.now();
                if (remainingMs <= 0) break;
                await sleep(Math.min(RESUME_PEER_SWITCH_DELAY_MS, remainingMs));
                continue;
            }

            const peer = queue.shift()!;
            if (!isEligibleForQueue(peer)) {
                // Became ineligible (e.g. distinct-cap hit) between being
                // queued and being picked up; drop and re-poll.
                continue;
            }
            distinctPeers.add(peer);

            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) break;
            attempts++;

            // RESUME MUST REQUEST LATEST STATE: no forkId/blockHeight. A
            // resuming client has a stale view by definition, and
            // generateSyncPayload returning undefined for an unprovable
            // fork/above-latest height gets the RESPONDER to blacklist US -
            // fork/height targeting here would burn the whole candidate set.
            const outcome = await this.localRpc.spectateService.syncAwaitable(
                peer,
                channelId,
                {
                    resumeMode: true,
                    timeoutMs: Math.min(RESUME_SYNC_TIMEOUT_MS, remainingMs)
                }
            );

            if (outcome.ok) {
                return {
                    status: "restored",
                    localWasAhead: outcome.localWasAhead
                };
            }

            this.logger.debug(
                "resumeFromBackground - peer sync failed; switching peer",
                { channelId, peer, reason: outcome.reason }
            );
            lastFailure = { reason: outcome.reason, retryable: true };

            if (outcome.reason === "in-flight-collision") {
                queue.push(peer);
            } else {
                excludedPeers.add(peer);
            }

            const remainingAfter = deadline - Date.now();
            if (remainingAfter <= 0) break;
            // Skip the delay when nothing could possibly benefit from it:
            // the queue is empty AND the distinct-peer cap is already
            // reached, so the top-of-loop check will break out immediately
            // on the next iteration anyway - sleeping here would just burn
            // budget for a poll we already know is pointless.
            if (
                queue.length > 0 ||
                distinctPeers.size < MAX_RESUME_SYNC_PEERS
            ) {
                await sleep(
                    Math.min(RESUME_PEER_SWITCH_DELAY_MS, remainingAfter)
                );
            }
        }

        if (lastFailure) {
            return {
                status: "failed",
                reason: lastFailure.reason,
                retryable: lastFailure.retryable
            };
        }
        // Deadline exhausted (or attempt cap hit) with zero attempts ever
        // launched: no peer was ever available to try during the window.
        return { status: "failed", reason: "no-peers", retryable: true };
    }
}

export default P2PManager;
