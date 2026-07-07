import ARpcMethods from "@/rpc/ARpcMethods";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import { Codec, sleep, Type } from "@/utils";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import type { Address } from "@/types/types";
import type SpectateServiceRpcMethods from "@/rpc/services/spectate/SpectateRpcMethods";
import type { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import type IsForkDisputedRpcMethods from "@/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods";
import InitHandshakeRpcMethods from "@/rpc/services/initHandshake/InitHandshakeRpcMethods";
import type { ForkId, Hash, Timestamp } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import type { PausedTryReduceStatus } from "./StubService";
import type { StubService } from "./StubService";

type PrivateTryReduceHost = {
    tryReduce: (forkId: ForkId) => Promise<unknown>;
};

type KillPeriodHost = {
    isKillPeriodExpired: (...args: unknown[]) => Promise<unknown>;
};

/**
 * Concrete method stub/restore sites. Each `stubX` saves the live original in
 * the service registry (once) and installs a fault behavior; each `restoreX`
 * reinstalls the saved original. Returns `false` from `restoreX` when nothing
 * was stubbed.
 *
 * The registry holds heterogeneous originals as `unknown`, so `restoreX` casts
 * each back to its concrete member type — the only casts here.
 */
export class StubRpcMethods extends ARpcMethods<P2PManager<HarnessControlRpc>> {
    constructor(
        transport: ATransport,
        private readonly service: StubService
    ) {
        super(transport, service.p2pManager);
    }

    /** Suppress all outbound block-confirmation broadcasts from this peer. */
    public stubBroadcast(): boolean {
        const service = this.p2pManager.remoteRpc.stateTransitionService;
        if (!this.service.stubOriginals.has("broadcast")) {
            this.service.stubOriginals.set(
                "broadcast",
                service.onBlockConfirmation
            );
        }
        // No-op delivery handler (test double for the real RpcHandler).
        service.onBlockConfirmation = (() => ({
            broadcast: () => {},
            sendOne: () => {},
            sendMultiple: () => {}
        })) as unknown as typeof service.onBlockConfirmation;
        return true;
    }

    public restoreBroadcast(): boolean {
        const original = this.service.stubOriginals.get("broadcast");
        if (original === undefined) return false;
        const service = this.p2pManager.remoteRpc.stateTransitionService;
        service.onBlockConfirmation =
            original as typeof service.onBlockConfirmation;
        this.service.stubOriginals.delete("broadcast");
        return true;
    }

    /** Prevent this peer from acting on on-chain calldata-posted events. */
    public stubCalldataPosting(): boolean {
        const eventHandler = this.service.sm.eventHandler;
        if (!this.service.stubOriginals.has("calldataPosting")) {
            this.service.stubOriginals.set(
                "calldataPosting",
                eventHandler.onBlockCalldataPosted
            );
        }
        eventHandler.onBlockCalldataPosted = async () => {};
        return true;
    }

    public restoreCalldataPosting(): boolean {
        const original = this.service.stubOriginals.get("calldataPosting");
        if (original === undefined) return false;
        const eventHandler = this.service.sm.eventHandler;
        eventHandler.onBlockCalldataPosted =
            original as typeof eventHandler.onBlockCalldataPosted;
        this.service.stubOriginals.delete("calldataPosting");
        return true;
    }

    /** Make this peer report no pending inbound message inclusion. */
    public stubPendingInboundInclusion(): boolean {
        const inbound = this.service.sm.storage.inboundMessages;
        if (!this.service.stubOriginals.has("pendingInboundInclusion")) {
            this.service.stubOriginals.set(
                "pendingInboundInclusion",
                inbound.getLatestBlockHash
            );
        }
        inbound.getLatestBlockHash = () => undefined;
        return true;
    }

    public restorePendingInboundInclusion(): boolean {
        const original = this.service.stubOriginals.get(
            "pendingInboundInclusion"
        );
        if (original === undefined) return false;
        const inbound = this.service.sm.storage.inboundMessages;
        inbound.getLatestBlockHash =
            original as typeof inbound.getLatestBlockHash;
        this.service.stubOriginals.delete("pendingInboundInclusion");
        return true;
    }

    /**
     * Suppress this peer's `disconnectAndBlacklistPeerByEvmAddress` for a single
     * allowed address (the peer won't disconnect/blacklist `allowedAddress`).
     * Used to keep a fake-dispute requester connected while others react.
     */
    public stubSelectiveDisconnect(allowedAddress: Address): boolean {
        const pm = this.p2pManager;
        if (!this.service.stubOriginals.has("selectiveDisconnect")) {
            this.service.stubOriginals.set(
                "selectiveDisconnect",
                pm.disconnectAndBlacklistPeerByEvmAddress
            );
        }
        const original = this.service.stubOriginals.get(
            "selectiveDisconnect"
        ) as typeof pm.disconnectAndBlacklistPeerByEvmAddress;
        const allowed = String(allowedAddress).toLowerCase();
        pm.disconnectAndBlacklistPeerByEvmAddress = (addr) => {
            if (String(addr).toLowerCase() === allowed) return;
            return original.call(pm, addr);
        };
        return true;
    }

    public restoreSelectiveDisconnect(): boolean {
        const original = this.service.stubOriginals.get("selectiveDisconnect");
        if (original === undefined) return false;
        const pm = this.p2pManager;
        pm.disconnectAndBlacklistPeerByEvmAddress =
            original as typeof pm.disconnectAndBlacklistPeerByEvmAddress;
        this.service.stubOriginals.delete("selectiveDisconnect");
        return true;
    }

    /**
     * Suppress this peer posting its own block on-chain (forces the on-chain
     * calldata path). `maybePostBlockOnChain` is private — cast to reach it.
     */
    public stubSuppressMaybePostBlockOnChain(): boolean {
        const sm = this.service.sm as unknown as {
            maybePostBlockOnChain: (blockHash: unknown) => void;
        };
        if (!this.service.stubOriginals.has("maybePostBlockOnChain")) {
            this.service.stubOriginals.set(
                "maybePostBlockOnChain",
                sm.maybePostBlockOnChain
            );
        }
        sm.maybePostBlockOnChain = () => {};
        return true;
    }

    public restoreSuppressMaybePostBlockOnChain(): boolean {
        const original = this.service.stubOriginals.get(
            "maybePostBlockOnChain"
        );
        if (original === undefined) return false;
        (
            this.service.sm as unknown as {
                maybePostBlockOnChain: unknown;
            }
        ).maybePostBlockOnChain = original;
        this.service.stubOriginals.delete("maybePostBlockOnChain");
        return true;
    }

    /** Suppress this peer's snapshot posting (stays dispute-eligible on-chain). */
    public stubPostStateSnapshot(): boolean {
        const sm = this.service.sm;
        if (!this.service.stubOriginals.has("postStateSnapshot")) {
            this.service.stubOriginals.set(
                "postStateSnapshot",
                sm.postStateSnapshot
            );
        }
        sm.postStateSnapshot = async () => undefined;
        return true;
    }

    public restorePostStateSnapshot(): boolean {
        const original = this.service.stubOriginals.get("postStateSnapshot");
        if (original === undefined) return false;
        const sm = this.service.sm;
        sm.postStateSnapshot = original as typeof sm.postStateSnapshot;
        this.service.stubOriginals.delete("postStateSnapshot");
        return true;
    }

    /**
     * Wrap `unsafeSetLatestState` so it records when it fires (queried via
     * `wasUnsafeSetLatestStateCalled`) but still runs the original.
     */
    public stubRecordUnsafeSetLatestState(): boolean {
        const sm = this.service.sm;
        if (!this.service.stubOriginals.has("unsafeSetLatestState")) {
            this.service.stubOriginals.set(
                "unsafeSetLatestState",
                sm.unsafeSetLatestState
            );
        }
        this.service.unsafeSetLatestStateCalled = false;
        const original = this.service.stubOriginals.get(
            "unsafeSetLatestState"
        ) as typeof sm.unsafeSetLatestState;
        const stubService = this.service;
        sm.unsafeSetLatestState = async (...args) => {
            stubService.unsafeSetLatestStateCalled = true;
            return original.apply(stubService.sm, args);
        };
        return true;
    }

    public wasUnsafeSetLatestStateCalled(): boolean {
        return this.service.unsafeSetLatestStateCalled;
    }

    public restoreUnsafeSetLatestState(): boolean {
        const original = this.service.stubOriginals.get("unsafeSetLatestState");
        if (original === undefined) return false;
        const sm = this.service.sm;
        sm.unsafeSetLatestState = original as typeof sm.unsafeSetLatestState;
        this.service.stubOriginals.delete("unsafeSetLatestState");
        return true;
    }

    // ===== RPC-method stubs (wrap a service's createRPCMethods) =====

    /**
     * Make `spectateService.onSpectateRequest` always answer with a proof at
     * `staleBlockHeight`, regardless of what was requested (stale-proof guard).
     */
    public stubSpectateStaleProof(staleBlockHeight: number): boolean {
        const service = this.p2pManager.localRpc.spectateService;
        if (!this.service.stubOriginals.has("spectateCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "spectateCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "spectateCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            methods.onSpectateRequest = async function (
                this: SpectateServiceRpcMethods,
                syncRequest: SyncRequest
            ) {
                const peerAddress = this.senderTransport.peerAddress;
                if (!peerAddress) {
                    throw new Error("stubSpectateStaleProof - missing peer");
                }
                const syncPayload = await this.service.generateSyncPayload(
                    syncRequest.channelId,
                    syncRequest.forkId,
                    staleBlockHeight
                );
                if (!syncPayload) {
                    throw new Error("stubSpectateStaleProof - no payload");
                }
                return {
                    encodedSyncPayload: Codec.encode(
                        syncPayload,
                        Type.SyncPayload
                    )
                };
            };
            return methods;
        };
        return true;
    }

    public restoreSpectateStaleProof(): boolean {
        const original = this.service.stubOriginals.get(
            "spectateCreateRpcMethods"
        );
        if (original === undefined) return false;
        const service = this.p2pManager.localRpc.spectateService;
        service.createRPCMethods = original as typeof service.createRPCMethods;
        this.service.stubOriginals.delete("spectateCreateRpcMethods");
        return true;
    }

    /**
     * Make `spectateService.onSpectateRequest` answer with bytes that are NOT a
     * valid `Codec.encode(SyncPayload)`, so the spectator's decode throws and it
     * must abort/disconnect (junk-payload handling).
     */
    public stubSpectateJunkPayload(): boolean {
        const service = this.p2pManager.localRpc.spectateService;
        if (!this.service.stubOriginals.has("spectateCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "spectateCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "spectateCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            methods.onSpectateRequest = async function (
                this: SpectateServiceRpcMethods
            ) {
                return { encodedSyncPayload: "0xdeadbeef" };
            };
            return methods;
        };
        return true;
    }

    public restoreSpectateJunkPayload(): boolean {
        return this.restoreSpectateStaleProof();
    }

    /**
     * Count incoming `onSpectateRequest` calls (still running the real handler),
     * resetting the counter on install. Lets a test assert that two concurrent
     * `sync()` calls for the same peer collapse to a single on-the-wire request.
     */
    public stubCountSpectateRequests(): boolean {
        const service = this.p2pManager.localRpc.spectateService;
        if (!this.service.stubOriginals.has("spectateCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "spectateCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        this.service.spectateRequestCount = 0;
        const original = this.service.stubOriginals.get(
            "spectateCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        const stubService = this.service;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            const realOnSpectateRequest =
                methods.onSpectateRequest.bind(methods);
            methods.onSpectateRequest = (syncRequest: SyncRequest) => {
                stubService.spectateRequestCount++;
                return realOnSpectateRequest(syncRequest);
            };
            return methods;
        };
        return true;
    }

    public getSpectateRequestCount(): number {
        return this.service.spectateRequestCount;
    }

    public restoreCountSpectateRequests(): boolean {
        return this.restoreSpectateStaleProof();
    }

    /**
     * Replace `isForkDisputedService.onDisputeAcknowledgmentRequest` with a
     * no-op that records it was called (queried via `wasDisputeAckRequestCalled`).
     */
    public stubRecordDisputeAckRequest(): boolean {
        const service = this.p2pManager.localRpc.isForkDisputedService;
        if (!this.service.stubOriginals.has("disputeAckCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "disputeAckCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        this.service.disputeAckRequestCalled = false;
        const original = this.service.stubOriginals.get(
            "disputeAckCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        const stubService = this.service;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            methods.onDisputeAcknowledgmentRequest = async function (
                this: IsForkDisputedRpcMethods
            ): Promise<boolean> {
                stubService.disputeAckRequestCalled = true;
                return false;
            };
            return methods;
        };
        return true;
    }

    public wasDisputeAckRequestCalled(): boolean {
        return this.service.disputeAckRequestCalled;
    }

    public restoreRecordDisputeAckRequest(): boolean {
        const original = this.service.stubOriginals.get(
            "disputeAckCreateRpcMethods"
        );
        if (original === undefined) return false;
        const service = this.p2pManager.localRpc.isForkDisputedService;
        service.createRPCMethods = original as typeof service.createRPCMethods;
        this.service.stubOriginals.delete("disputeAckCreateRpcMethods");
        return true;
    }

    /**
     * Make handshake never complete, and install a recording
     * `HandshakeCompletedGuard` on this peer's `spectateService` so an incoming
     * spectate RPC is blocked (queried via `wasSpectateGuardBlocked`).
     */
    public stubBlockHandshakeAndRecordSpectateGuard(): boolean {
        const initHandshakeService =
            this.p2pManager.localRpc.initHandshakeService;
        if (!this.service.stubOriginals.has("blockedInitHandshake")) {
            this.service.stubOriginals.set(
                "blockedInitHandshake",
                initHandshakeService.initHandshake
            );
        }
        initHandshakeService.initHandshake = () => {};

        const spectateService = this.p2pManager.localRpc.spectateService;
        this.service.spectateGuardBlocked = false;
        const stubService = this.service;
        // `guards` is protected on ARpcService; cast to install a test guard.
        (spectateService as unknown as { guards: unknown[] }).guards = [
            new HandshakeCompletedGuard(spectateService, {
                onFailure: () => {
                    stubService.spectateGuardBlocked = true;
                }
            })
        ];
        return true;
    }

    public wasSpectateGuardBlocked(): boolean {
        return this.service.spectateGuardBlocked;
    }

    /**
     * Wrap `spectateService.abort` to record when it fires (queried via
     * `wasSpectateAbortCalled`) while still running the original — the host-side
     * stand-in for spying on abort from the main thread.
     */
    public stubRecordSpectateAbort(): boolean {
        const service = this.p2pManager.localRpc.spectateService;
        if (!this.service.stubOriginals.has("spectateAbort")) {
            this.service.stubOriginals.set(
                "spectateAbort",
                service.abort.bind(service)
            );
        }
        this.service.spectateAbortCalled = false;
        const original = this.service.stubOriginals.get(
            "spectateAbort"
        ) as typeof service.abort;
        const stubService = this.service;
        service.abort = (peerAddress) => {
            stubService.spectateAbortCalled = true;
            return original(peerAddress);
        };
        return true;
    }

    public wasSpectateAbortCalled(): boolean {
        return this.service.spectateAbortCalled;
    }

    /**
     * Capture the transport this peer initiates a handshake over (its outbound
     * `initHandshake`), recording it on the service so a test can send an RPC
     * over a pre-handshake transport (read via `execOnHost`). Runs the original.
     */
    public stubCaptureInitHandshakeTransport(): boolean {
        const service = this.p2pManager.localRpc.initHandshakeService;
        if (!this.service.stubOriginals.has("captureInitHandshake")) {
            this.service.stubOriginals.set(
                "captureInitHandshake",
                service.initHandshake
            );
        }
        const original = this.service.stubOriginals.get(
            "captureInitHandshake"
        ) as typeof service.initHandshake;
        const stubService = this.service;
        service.initHandshake = (transport) => {
            stubService.capturedInitHandshakeTransport = transport;
            return original.call(service, transport);
        };
        return true;
    }

    /**
     * Make this peer answer handshake challenges (`onInitHandshakeRequest`) with
     * a faulty response so the *initiator* rejects it:
     * - `responseTimeOffsetSeconds` skews the returned `responseTime` so the
     *   initiator's response-timestamp check fails.
     * - `delayMs` delays the reply; only a delay that exceeds the initiator's
     *   request window (agreementTime) makes its `.request(...)` time out — a
     *   small delay just slows a still-successful response.
     * - `corruptSignature` flips the signature's recovery byte so the
     *   initiator's `ethers.verifyMessage` throws.
     * The real handler still runs first (validates + signs), so only the reply
     * is corrupted.
     */
    public stubHandshakeResponse(
        delayMs: number,
        responseTimeOffsetSeconds: number,
        corruptSignature: boolean
    ): boolean {
        const service = this.p2pManager.localRpc.initHandshakeService;
        if (!this.service.stubOriginals.has("initHandshakeCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "initHandshakeCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "initHandshakeCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        const realRequest =
            InitHandshakeRpcMethods.prototype.onInitHandshakeRequest;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            methods.onInitHandshakeRequest = async function (
                this: InitHandshakeRpcMethods,
                challengeHash: Hash,
                time: Timestamp
            ) {
                const response = await realRequest.call(
                    this,
                    challengeHash,
                    time
                );
                if (responseTimeOffsetSeconds) {
                    response.responseTime += responseTimeOffsetSeconds;
                }
                if (corruptSignature) {
                    // Keep the real 65-byte signature shape but flip its
                    // recovery (v) byte to an invalid value, so
                    // ethers.verifyMessage throws — closer to a real corrupted
                    // signature than an obviously-fake short value. (The handler
                    // signs to a hex string, so String() is identity here.)
                    const sigHex = String(response.signature);
                    response.signature = `${sigHex.slice(0, -2)}ff`;
                }
                if (delayMs > 0) {
                    await sleep(delayMs);
                }
                return response;
            };
            return methods;
        };
        return true;
    }

    public restoreHandshakeResponse(): boolean {
        const original = this.service.stubOriginals.get(
            "initHandshakeCreateRpcMethods"
        );
        if (original === undefined) return false;
        const service = this.p2pManager.localRpc.initHandshakeService;
        service.createRPCMethods = original as typeof service.createRPCMethods;
        this.service.stubOriginals.delete("initHandshakeCreateRpcMethods");
        return true;
    }

    // Reduction-race staging (hold / release / record).
    // Staging for tests that must outrun a peer's own fork transition: hold
    // all three reduction entry points (the reduction-* timers, the
    // StateSnapshotUpdated handler, and the DisputeReducedResultCommitted
    // handler — the latter reduces on the spot once the challenge period has
    // expired), then release/replay once the race is staged.

    /** Capture `reduction-*` timer tasks instead of scheduling them. */
    public stubHoldReductionTasks(): boolean {
        const timeoutManager = this.service.sm.timeoutManager;
        if (!this.service.stubOriginals.has("reductionTasks")) {
            this.service.stubOriginals.set(
                "reductionTasks",
                timeoutManager.scheduleTask.bind(timeoutManager)
            );
        }
        const original = this.service.stubOriginals.get(
            "reductionTasks"
        ) as typeof timeoutManager.scheduleTask;
        timeoutManager.scheduleTask = (task, delayMs, taskName = "unnamed") => {
            if (taskName.startsWith("reduction-")) {
                this.service.heldReductionTasks.push({ taskName, task });
                return {} as ReturnType<typeof setTimeout>;
            }
            return original(task, delayMs, taskName);
        };
        return true;
    }

    /** Restore scheduling; optionally run the held tasks (fire-and-forget). */
    public restoreReductionTasks(runHeld: boolean): boolean {
        const timeoutManager = this.service.sm.timeoutManager;
        const original = this.service.stubOriginals.get("reductionTasks");
        if (original === undefined) return false;
        timeoutManager.scheduleTask =
            original as typeof timeoutManager.scheduleTask;
        this.service.stubOriginals.delete("reductionTasks");
        const held = this.service.heldReductionTasks.splice(0);
        if (runHeld) for (const { task } of held) void task();
        return true;
    }

    public getHeldReductionTaskCount(): number {
        return this.service.heldReductionTasks.length;
    }

    /**
     * Pause a real `tryReduce(forkId)` once it has entered the kill-period call.
     * Used to prove an already-entered old-fork reduction settles idempotently
     * after another path has reduced the peer.
     */
    public stubPauseTryReduceAtKillPeriod(forkId: ForkId): boolean {
        const sm = this.service.sm;
        const host = sm as unknown as PrivateTryReduceHost;
        const localDiamond = sm.diamondStateMachine
            .localDiamondContract as unknown as KillPeriodHost;

        if (!this.service.stubOriginals.has("pausedTryReduce")) {
            this.service.stubOriginals.set(
                "pausedTryReduce",
                host.tryReduce.bind(sm)
            );
        }
        if (!this.service.stubOriginals.has("pausedTryReduceKillPeriod")) {
            this.service.stubOriginals.set(
                "pausedTryReduceKillPeriod",
                localDiamond.isKillPeriodExpired.bind(localDiamond)
            );
        }

        this.service.pausedTryReduce = {
            targetForkId: forkId,
            entered: false,
            released: false,
            settled: false,
            inside: false
        };

        const originalTryReduce = this.service.stubOriginals.get(
            "pausedTryReduce"
        ) as PrivateTryReduceHost["tryReduce"];
        const originalKillPeriod = this.service.stubOriginals.get(
            "pausedTryReduceKillPeriod"
        ) as KillPeriodHost["isKillPeriodExpired"];

        host.tryReduce = ((requestedForkId: ForkId) => {
            const state = this.service.pausedTryReduce;
            if (!state || requestedForkId !== state.targetForkId) {
                return originalTryReduce(requestedForkId);
            }

            state.inside = true;
            const promise = Promise.resolve(
                originalTryReduce(requestedForkId)
            ).finally(() => {
                state.inside = false;
            });
            state.promise = promise;
            void promise.then(
                () => {
                    state.settled = true;
                },
                (error: unknown) => {
                    state.settled = true;
                    state.error =
                        error instanceof Error ? error.message : String(error);
                }
            );
            return promise;
        }) as PrivateTryReduceHost["tryReduce"];

        localDiamond.isKillPeriodExpired = (async (...args: unknown[]) => {
            const state = this.service.pausedTryReduce;
            const requestedForkId = String(args[1]);
            // One-shot: pause only the FIRST matching kill-period call
            // (`!state.entered`). A second call while `inside` would otherwise
            // overwrite `state.release`, so `releasePausedTryReduce` would
            // resolve the wrong resolver and strand the first paused call.
            if (
                state &&
                state.inside &&
                !state.entered &&
                !state.released &&
                requestedForkId === state.targetForkId
            ) {
                state.entered = true;
                await new Promise<void>((resolve) => {
                    state.release = resolve;
                });
            }
            return originalKillPeriod(...args);
        }) as KillPeriodHost["isKillPeriodExpired"];

        return true;
    }

    public startPausedTryReduce(forkId: ForkId): boolean {
        if (!this.service.pausedTryReduce) return false;
        const host = this.service.sm as unknown as PrivateTryReduceHost;
        void host.tryReduce(forkId);
        return true;
    }

    public releasePausedTryReduce(): boolean {
        const state = this.service.pausedTryReduce;
        if (!state) return false;
        state.released = true;
        state.release?.();
        return true;
    }

    public getPausedTryReduceStatus(): PausedTryReduceStatus {
        const state = this.service.pausedTryReduce;
        const status: PausedTryReduceStatus = {
            entered: state?.entered ?? false,
            released: state?.released ?? false,
            settled: state?.settled ?? false
        };
        if (state?.error !== undefined) status.error = state.error;
        return status;
    }

    public restorePausedTryReduce(): boolean {
        this.releasePausedTryReduce();

        const sm = this.service.sm;
        const host = sm as unknown as PrivateTryReduceHost;
        const localDiamond = sm.diamondStateMachine
            .localDiamondContract as unknown as KillPeriodHost;
        let restored = false;

        const originalTryReduce =
            this.service.stubOriginals.get("pausedTryReduce");
        if (originalTryReduce !== undefined) {
            host.tryReduce =
                originalTryReduce as PrivateTryReduceHost["tryReduce"];
            this.service.stubOriginals.delete("pausedTryReduce");
            restored = true;
        }

        const originalKillPeriod = this.service.stubOriginals.get(
            "pausedTryReduceKillPeriod"
        );
        if (originalKillPeriod !== undefined) {
            localDiamond.isKillPeriodExpired =
                originalKillPeriod as KillPeriodHost["isKillPeriodExpired"];
            this.service.stubOriginals.delete("pausedTryReduceKillPeriod");
            restored = true;
        }

        // Drop the pause state so a later reduction can't observe stale flags.
        this.service.pausedTryReduce = undefined;

        return restored;
    }

    /** Hold StateSnapshotUpdated events instead of handling them. */
    public stubHoldSnapshotUpdatedEvents(): boolean {
        const eventHandler = this.service.sm.eventHandler;
        if (!this.service.stubOriginals.has("snapshotUpdatedEvents")) {
            this.service.stubOriginals.set(
                "snapshotUpdatedEvents",
                eventHandler.onStateSnapshotUpdated.bind(eventHandler)
            );
        }
        eventHandler.onStateSnapshotUpdated = (async (...args: unknown[]) => {
            this.service.heldSnapshotUpdatedArgs.push(args);
        }) as typeof eventHandler.onStateSnapshotUpdated;
        return true;
    }

    /** Restore the handler; optionally replay the held events through it. */
    public restoreSnapshotUpdatedEvents(replay: boolean): boolean {
        const eventHandler = this.service.sm.eventHandler;
        const original = this.service.stubOriginals.get(
            "snapshotUpdatedEvents"
        );
        if (original === undefined) return false;
        const restored = original as typeof eventHandler.onStateSnapshotUpdated;
        eventHandler.onStateSnapshotUpdated = restored;
        this.service.stubOriginals.delete("snapshotUpdatedEvents");
        const held = this.service.heldSnapshotUpdatedArgs.splice(0);
        if (replay) {
            for (const args of held) {
                void (restored as (...a: unknown[]) => Promise<void>)(...args);
            }
        }
        return true;
    }

    public getHeldSnapshotUpdatedCount(): number {
        return this.service.heldSnapshotUpdatedArgs.length;
    }

    /** Hold DisputeReducedResultCommitted events instead of handling them. */
    public stubHoldReducedCommitEvents(): boolean {
        const eventHandler = this.service.sm.eventHandler;
        if (!this.service.stubOriginals.has("reducedCommitEvents")) {
            this.service.stubOriginals.set(
                "reducedCommitEvents",
                eventHandler.onDisputeReducedResultCommitted.bind(eventHandler)
            );
        }
        eventHandler.onDisputeReducedResultCommitted = (async (
            ...args: unknown[]
        ) => {
            this.service.heldReducedCommitArgs.push(args);
        }) as typeof eventHandler.onDisputeReducedResultCommitted;
        return true;
    }

    public restoreReducedCommitEvents(replay: boolean): boolean {
        const eventHandler = this.service.sm.eventHandler;
        const original = this.service.stubOriginals.get("reducedCommitEvents");
        if (original === undefined) return false;
        const restored =
            original as typeof eventHandler.onDisputeReducedResultCommitted;
        eventHandler.onDisputeReducedResultCommitted = restored;
        this.service.stubOriginals.delete("reducedCommitEvents");
        const held = this.service.heldReducedCommitArgs.splice(0);
        if (replay) {
            for (const args of held) {
                void (restored as (...a: unknown[]) => Promise<void>)(...args);
            }
        }
        return true;
    }

    /** `reduceLocally` counts calls and resolves undefined (nothing to reduce). */
    public stubReduceLocallyNoop(): boolean {
        const sm = this.service.sm;
        if (!this.service.stubOriginals.has("reduceLocally")) {
            this.service.stubOriginals.set(
                "reduceLocally",
                sm.reduceLocally.bind(sm)
            );
        }
        sm.reduceLocally = (async () => {
            this.service.reduceLocallyCallCount += 1;
            return undefined;
        }) as typeof sm.reduceLocally;
        return true;
    }

    /** `reduceLocally` counts calls and forwards to the real implementation. */
    public stubRecordReduceLocally(): boolean {
        const sm = this.service.sm;
        if (!this.service.stubOriginals.has("reduceLocally")) {
            this.service.stubOriginals.set(
                "reduceLocally",
                sm.reduceLocally.bind(sm)
            );
        }
        const original = this.service.stubOriginals.get(
            "reduceLocally"
        ) as typeof sm.reduceLocally;
        sm.reduceLocally = ((forkId) => {
            this.service.reduceLocallyCallCount += 1;
            return original(forkId);
        }) as typeof sm.reduceLocally;
        return true;
    }

    public restoreReduceLocally(): boolean {
        const sm = this.service.sm;
        const original = this.service.stubOriginals.get("reduceLocally");
        if (original === undefined) return false;
        sm.reduceLocally = original as typeof sm.reduceLocally;
        this.service.stubOriginals.delete("reduceLocally");
        return true;
    }

    public getReduceLocallyCallCount(): number {
        return this.service.reduceLocallyCallCount;
    }

    /**
     * Count `spectateService.sync` requests; `forward` keeps the real sync
     * running (record-only otherwise — the punishment path stays quiet).
     */
    public stubRecordSpectateSync(forward: boolean): boolean {
        const spectate = this.p2pManager.localRpc.spectateService;
        if (!this.service.stubOriginals.has("spectateSync")) {
            this.service.stubOriginals.set(
                "spectateSync",
                spectate.sync.bind(spectate)
            );
        }
        const original = this.service.stubOriginals.get(
            "spectateSync"
        ) as typeof spectate.sync;
        spectate.sync = ((...args: Parameters<typeof spectate.sync>) => {
            this.service.spectateSyncCallCount += 1;
            if (forward) return original(...args);
        }) as typeof spectate.sync;
        return true;
    }

    public restoreSpectateSync(): boolean {
        const spectate = this.p2pManager.localRpc.spectateService;
        const original = this.service.stubOriginals.get("spectateSync");
        if (original === undefined) return false;
        spectate.sync = original as typeof spectate.sync;
        this.service.stubOriginals.delete("spectateSync");
        return true;
    }

    public getSpectateSyncCallCount(): number {
        return this.service.spectateSyncCallCount;
    }
}

export default StubRpcMethods;
