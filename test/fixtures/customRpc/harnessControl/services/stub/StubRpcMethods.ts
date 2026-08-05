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
import type { StateSnapshot } from "@/models";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { getBytes, hexlify, id } from "ethers";
import type { Bytes, ForkId, Hash, Timestamp } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import type {
    EventSyncFailureProbe,
    PausedReductionStatus,
    ReductionSimulationErrorName,
    ConcurrentCalldataRecoveryProbe,
    CleanCommittedDivergenceProbe,
    DisputeStrategyResultMatrix,
    MissingParticipantSnapshotsProbe,
    HeldSpectateRequestStatus,
    SpectatePayloadCorruption
} from "./StubService";
import type { StubService } from "./StubService";

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

    /** Make authored blocks omit pending inbound messages. */
    public stubPendingInboundInclusion(): boolean {
        // This is deliberately scoped to block assembly. Stubbing the inbound
        // storage head also corrupts disputes constructed while the stub is
        // active.
        const sm = this.service.sm as unknown as {
            getPendingInboundMessageBlocks: (
                previousStateSnapshot: StateSnapshot
            ) => MessageBlockStruct[];
        };
        if (!this.service.stubOriginals.has("pendingInboundInclusion")) {
            this.service.stubOriginals.set(
                "pendingInboundInclusion",
                sm.getPendingInboundMessageBlocks
            );
        }
        sm.getPendingInboundMessageBlocks = () => [];
        return true;
    }

    public restorePendingInboundInclusion(): boolean {
        const original = this.service.stubOriginals.get(
            "pendingInboundInclusion"
        );
        if (original === undefined) return false;
        const sm = this.service.sm as unknown as {
            getPendingInboundMessageBlocks: unknown;
        };
        sm.getPendingInboundMessageBlocks = original;
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
        const snapshotUpdateService = this.service.sm.snapshotUpdateService;
        if (!this.service.stubOriginals.has("postStateSnapshot")) {
            this.service.stubOriginals.set(
                "postStateSnapshot",
                snapshotUpdateService.postStateSnapshot
            );
        }
        snapshotUpdateService.postStateSnapshot = async () => undefined;
        return true;
    }

    public restorePostStateSnapshot(): boolean {
        const original = this.service.stubOriginals.get("postStateSnapshot");
        if (original === undefined) return false;
        const snapshotUpdateService = this.service.sm.snapshotUpdateService;
        snapshotUpdateService.postStateSnapshot =
            original as typeof snapshotUpdateService.postStateSnapshot;
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
     * Hold an in-flight `onSpectateRequest` at entry (before it returns to its
     * caller) so a test can deterministically stage "a sync is currently in
     * flight to this peer" without racing timing/polling. Uses its own
     * dedicated registry key (distinct from `spectateCreateRpcMethods`) so it
     * can be installed alongside `stubCountSpectateRequests` (or any other
     * `onSpectateRequest` wrapper) on the same peer, in either order, without
     * either wrapper clobbering the other. Releasing lets the real handler run
     * to completion and answer with the real payload.
     */
    public stubHoldSpectateRequest(): boolean {
        const service = this.p2pManager.localRpc.spectateService;
        if (
            !this.service.stubOriginals.has(
                "heldSpectateRequestCreateRpcMethods"
            )
        ) {
            this.service.stubOriginals.set(
                "heldSpectateRequestCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "heldSpectateRequestCreateRpcMethods"
        ) as typeof service.createRPCMethods;

        const prior = this.service.heldSpectateRequest;
        if (prior && prior.entered && !prior.settled) prior.release?.();

        this.service.heldSpectateRequest = {
            entered: false,
            released: false,
            settled: false
        };

        const stubService = this.service;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            const realOnSpectateRequest =
                methods.onSpectateRequest.bind(methods);
            methods.onSpectateRequest = async (syncRequest: SyncRequest) => {
                const state = stubService.heldSpectateRequest;
                if (state && !state.released) {
                    state.entered = true;
                    await new Promise<void>((resolve) => {
                        state.release = resolve;
                    });
                }
                const result = await realOnSpectateRequest(syncRequest);
                if (state) state.settled = true;
                return result;
            };
            return methods;
        };
        return true;
    }

    public getHeldSpectateRequestStatus(): HeldSpectateRequestStatus {
        const state = this.service.heldSpectateRequest;
        return {
            entered: state?.entered ?? false,
            released: state?.released ?? false,
            settled: state?.settled ?? false
        };
    }

    public releaseHeldSpectateRequest(): boolean {
        const state = this.service.heldSpectateRequest;
        if (!state) return false;
        state.released = true;
        state.release?.();
        return true;
    }

    public restoreHoldSpectateRequest(): boolean {
        this.releaseHeldSpectateRequest();
        const original = this.service.stubOriginals.get(
            "heldSpectateRequestCreateRpcMethods"
        );
        this.service.heldSpectateRequest = undefined;
        if (original === undefined) return false;
        const service = this.p2pManager.localRpc.spectateService;
        service.createRPCMethods = original as typeof service.createRPCMethods;
        this.service.stubOriginals.delete(
            "heldSpectateRequestCreateRpcMethods"
        );
        return true;
    }

    /**
     * Make `spectateService.onSpectateRequest` answer with a REAL sync payload
     * (generated for the requester's own `forkId`/`blockHeight` — nothing about
     * what's requested is altered) that has exactly one field corrupted, so the
     * outer `Codec.decode(SyncPayload)` still succeeds but a single named,
     * peer-provable self-consistency check fails downstream. Uses its own
     * dedicated registry key (distinct from `spectateCreateRpcMethods` and
     * `heldSpectateRequestCreateRpcMethods`) so it composes with the hold stub
     * and the request-counter stub on the same peer, in any install order.
     */
    public stubSpectateCorruptPayload(
        corruption: SpectatePayloadCorruption
    ): boolean {
        const service = this.p2pManager.localRpc.spectateService;
        if (
            !this.service.stubOriginals.has(
                "corruptSpectatePayloadCreateRpcMethods"
            )
        ) {
            this.service.stubOriginals.set(
                "corruptSpectatePayloadCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "corruptSpectatePayloadCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            methods.onSpectateRequest = async function (
                this: SpectateServiceRpcMethods,
                syncRequest: SyncRequest
            ) {
                const syncPayload = await this.service.generateSyncPayload(
                    syncRequest.channelId,
                    syncRequest.forkId,
                    syncRequest.blockHeight
                );
                if (!syncPayload) {
                    throw new Error("stubSpectateCorruptPayload - no payload");
                }
                if (corruption === "finalized-state-hash") {
                    syncPayload.latestFinalizedEncodedState =
                        StubRpcMethods.corruptEncodedState(
                            syncPayload.latestFinalizedEncodedState
                        );
                } else {
                    syncPayload.latestForkGenesisEncodedState =
                        StubRpcMethods.corruptEncodedState(
                            syncPayload.latestForkGenesisEncodedState
                        );
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

    public restoreSpectateCorruptPayload(): boolean {
        const original = this.service.stubOriginals.get(
            "corruptSpectatePayloadCreateRpcMethods"
        );
        if (original === undefined) return false;
        const service = this.p2pManager.localRpc.spectateService;
        service.createRPCMethods = original as typeof service.createRPCMethods;
        this.service.stubOriginals.delete(
            "corruptSpectatePayloadCreateRpcMethods"
        );
        return true;
    }

    /**
     * Flip a byte in the middle of an encoded state so it no longer matches
     * its own declared hash, while leaving the byte length (and thus any
     * structural decode) intact.
     */
    private static corruptEncodedState(encodedState: Bytes): Bytes {
        const bytes = getBytes(encodedState);
        if (bytes.length === 0) {
            throw new Error("stubSpectateCorruptPayload - empty encoded state");
        }
        const index = Math.floor(bytes.length / 2);
        bytes[index] ^= 0xff;
        return hexlify(bytes);
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

    public async probeRejectedEventSyncLog(): Promise<EventSyncFailureProbe> {
        return this.service.probeRejectedEventSyncLog();
    }

    public async probeConcurrentCalldataRecovery(): Promise<ConcurrentCalldataRecoveryProbe> {
        return this.service.probeConcurrentCalldataRecovery();
    }

    public async probeDisputeStrategyResultMatrix(): Promise<DisputeStrategyResultMatrix> {
        return this.service.probeDisputeStrategyResultMatrix();
    }

    public async probeCleanCommittedDivergence(): Promise<CleanCommittedDivergenceProbe> {
        return this.service.probeCleanCommittedDivergence();
    }

    public async probeMissingParticipantSnapshots(): Promise<MissingParticipantSnapshotsProbe> {
        return this.service.probeMissingParticipantSnapshots();
    }

    public async probeAuthorGatePreviousSnapshotMember(): Promise<string> {
        return this.service.probeAuthorGatePreviousSnapshotMember();
    }

    public async probeAuthorGateMatchingResultingSnapshot(): Promise<string> {
        return this.service.probeAuthorGateMatchingResultingSnapshot();
    }

    public async probeAuthorGateStaleHeightSnapshot(): Promise<string> {
        return this.service.probeAuthorGateStaleHeightSnapshot();
    }

    public async probeAuthorGateWrongForkSnapshot(): Promise<string> {
        return this.service.probeAuthorGateWrongForkSnapshot();
    }

    public async probeAuthorGateMatchingSnapshotExcludingAuthor(): Promise<string> {
        return this.service.probeAuthorGateMatchingSnapshotExcludingAuthor();
    }

    public async probeAuthorGateMissingSnapshotPreviousMember(): Promise<string> {
        return this.service.probeAuthorGateMissingSnapshotPreviousMember();
    }

    public async probeAuthorGateMissingSnapshotOutsider(): Promise<string> {
        return this.service.probeAuthorGateMissingSnapshotOutsider();
    }

    public async probeAuthorGateNoAnchorCurrentParticipant(): Promise<string> {
        return this.service.probeAuthorGateNoAnchorCurrentParticipant();
    }

    public async probeAuthorGateNoAnchorPendingParticipant(
        pendingParticipant: string
    ): Promise<string> {
        return this.service.probeAuthorGateNoAnchorPendingParticipant(
            pendingParticipant as Address
        );
    }

    public async probeAuthorGateNoAnchorUnknownAddress(): Promise<string> {
        return this.service.probeAuthorGateNoAnchorUnknownAddress();
    }

    /** Pause a real reduction once it enters its kill-period lookup. */
    public stubPauseReductionAtKillPeriod(forkId: ForkId): boolean {
        const reductionManager = this.service.sm.reductionManager;
        const contract = this.service.sm.stateChannelManagerContract;

        if (!this.service.stubOriginals.has("pausedReduction")) {
            this.service.stubOriginals.set(
                "pausedReduction",
                reductionManager.tryReduce.bind(reductionManager)
            );
        }
        if (!this.service.stubOriginals.has("pausedReductionKillPeriod")) {
            this.service.stubOriginals.set(
                "pausedReductionKillPeriod",
                contract.isKillPeriodExpired.bind(contract)
            );
        }

        const prior = this.service.pausedReduction;
        if (prior && prior.entered && !prior.settled) prior.release?.();

        this.service.pausedReduction = {
            targetForkId: forkId,
            entered: false,
            released: false,
            settled: false,
            inside: false
        };

        const originalReduce = this.service.stubOriginals.get(
            "pausedReduction"
        ) as typeof reductionManager.tryReduce;
        const originalKillPeriod = this.service.stubOriginals.get(
            "pausedReductionKillPeriod"
        ) as typeof contract.isKillPeriodExpired;

        reductionManager.tryReduce = ((requestedForkId: ForkId) => {
            const state = this.service.pausedReduction;
            if (!state || requestedForkId !== state.targetForkId) {
                return originalReduce(requestedForkId);
            }

            state.inside = true;
            const promise = originalReduce(requestedForkId).finally(() => {
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
        }) as typeof reductionManager.tryReduce;

        contract.isKillPeriodExpired = (async (channelId, requestedForkId) => {
            const state = this.service.pausedReduction;
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
            return originalKillPeriod(channelId, requestedForkId);
        }) as typeof contract.isKillPeriodExpired;
        return true;
    }

    public releasePausedReduction(): boolean {
        const state = this.service.pausedReduction;
        if (!state) return false;
        state.released = true;
        state.release?.();
        return true;
    }

    public getPausedReductionStatus(): PausedReductionStatus {
        const state = this.service.pausedReduction;
        const status: PausedReductionStatus = {
            entered: state?.entered ?? false,
            released: state?.released ?? false,
            settled: state?.settled ?? false
        };
        if (state?.error !== undefined) status.error = state.error;
        return status;
    }

    public restorePausedReduction(): boolean {
        this.releasePausedReduction();
        const reductionManager = this.service.sm.reductionManager;
        const contract = this.service.sm.stateChannelManagerContract;
        let restored = false;

        const originalReduce =
            this.service.stubOriginals.get("pausedReduction");
        if (originalReduce !== undefined) {
            reductionManager.tryReduce =
                originalReduce as typeof reductionManager.tryReduce;
            this.service.stubOriginals.delete("pausedReduction");
            restored = true;
        }

        const originalKillPeriod = this.service.stubOriginals.get(
            "pausedReductionKillPeriod"
        );
        if (originalKillPeriod !== undefined) {
            contract.isKillPeriodExpired =
                originalKillPeriod as typeof contract.isKillPeriodExpired;
            this.service.stubOriginals.delete("pausedReductionKillPeriod");
            restored = true;
        }

        this.service.pausedReduction = undefined;
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

    /** Drop subscribed dispute logs before the scheduler records their key. */
    public stubHoldDisputeCommittedEvents(passFirst = true): boolean {
        const eventSyncService = this.service.sm.eventSyncService;
        this.service.passFirstDisputeCommittedEvent = passFirst;
        if (!this.service.stubOriginals.has("disputeCommittedEvents")) {
            this.service.stubOriginals.set(
                "disputeCommittedEvents",
                eventSyncService.scheduleLog.bind(eventSyncService)
            );
        }
        const original = this.service.stubOriginals.get(
            "disputeCommittedEvents"
        ) as typeof eventSyncService.scheduleLog;
        eventSyncService.scheduleLog = async (...args) => {
            const parsed =
                this.service.sm.stateChannelManagerContract.interface.parseLog({
                    topics: args[0].topics,
                    data: args[0].data
                });
            if (
                parsed?.name === "DisputeCommitted" ||
                parsed?.name === "DisputeCommittedWithAuditingData"
            ) {
                const eventKey = `${args[0].transactionHash}:${args[0].index}`;
                if (
                    this.service.passFirstDisputeCommittedEvent &&
                    this.service.passedDisputeCommittedEventKeys.size === 0
                ) {
                    // Let the dispute under validation arrive, then model a
                    // missed subscription delivery for replacement evidence.
                    this.service.passedDisputeCommittedEventKeys.add(eventKey);
                    return original(...args);
                }
                const wasAlreadyDropped =
                    this.service.heldDisputeCommittedArgs.some(
                        ([heldKey]) => heldKey === eventKey
                    );
                if (!wasAlreadyDropped) {
                    // Lose the subscribed delivery once. A later explicit
                    // query of the same log must reach the real scheduler so
                    // this stub accurately models missed subscription data.
                    this.service.heldDisputeCommittedArgs.push([eventKey]);
                    return;
                }
            }
            return original(...args);
        };
        return true;
    }

    /** Restore scheduling. Dropped subscription payloads are recovered by query. */
    public restoreDisputeCommittedEvents(replay: boolean): boolean {
        const eventSyncService = this.service.sm.eventSyncService;
        const original = this.service.stubOriginals.get(
            "disputeCommittedEvents"
        );
        if (original === undefined) return false;
        eventSyncService.scheduleLog =
            original as typeof eventSyncService.scheduleLog;
        this.service.stubOriginals.delete("disputeCommittedEvents");
        this.service.heldDisputeCommittedArgs.splice(0);
        this.service.passedDisputeCommittedEventKeys.clear();
        this.service.passFirstDisputeCommittedEvent = true;
        void replay;
        return true;
    }

    public getHeldDisputeCommittedCount(): number {
        return this.service.heldDisputeCommittedArgs.length;
    }

    /** Reserve this participant as a later evidence author. */
    public stubSuppressDisputeInitiation(): boolean {
        const disputeManager = this.service.sm.disputeManager;
        if (!this.service.stubOriginals.has("disputeInitiation")) {
            this.service.stubOriginals.set(
                "disputeInitiation",
                disputeManager.dispute.bind(disputeManager)
            );
        }
        disputeManager.dispute =
            (async () => {}) as typeof disputeManager.dispute;
        return true;
    }

    public restoreDisputeInitiation(): boolean {
        const disputeManager = this.service.sm.disputeManager;
        const original = this.service.stubOriginals.get("disputeInitiation");
        if (original === undefined) return false;
        disputeManager.dispute = original as typeof disputeManager.dispute;
        this.service.stubOriginals.delete("disputeInitiation");
        return true;
    }

    /** Fail the next final-dispute output preparation, then restore immediately. */
    public stubFailNextFinalDisputePreparation(): boolean {
        const agreementManager = this.service.sm.agreementManager;
        if (!this.service.stubOriginals.has("finalDisputePreparation")) {
            this.service.stubOriginals.set(
                "finalDisputePreparation",
                agreementManager.getLatestSnapshotFromStateProof.bind(
                    agreementManager
                )
            );
        }
        const original = this.service.stubOriginals.get(
            "finalDisputePreparation"
        ) as typeof agreementManager.getLatestSnapshotFromStateProof;
        agreementManager.getLatestSnapshotFromStateProof = ((...args) => {
            agreementManager.getLatestSnapshotFromStateProof = original;
            this.service.stubOriginals.delete("finalDisputePreparation");
            void args;
            throw new Error("Forced final-dispute output preparation failure");
        }) as typeof agreementManager.getLatestSnapshotFromStateProof;
        return true;
    }

    public restoreFinalDisputePreparation(): boolean {
        const agreementManager = this.service.sm.agreementManager;
        const original = this.service.stubOriginals.get(
            "finalDisputePreparation"
        );
        if (original === undefined) return false;
        agreementManager.getLatestSnapshotFromStateProof =
            original as typeof agreementManager.getLatestSnapshotFromStateProof;
        this.service.stubOriginals.delete("finalDisputePreparation");
        return true;
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

    /** `ReductionManager.tryReduce` counts calls and resolves as a no-op. */
    public stubReduceNoop(): boolean {
        const reductionManager = this.service.sm.reductionManager;
        if (!this.service.stubOriginals.has("reduce")) {
            this.service.stubOriginals.set(
                "reduce",
                reductionManager.tryReduce.bind(reductionManager)
            );
        }
        this.service.reduceCallCount = 0;
        reductionManager.tryReduce = (async () => {
            this.service.reduceCallCount += 1;
            return undefined;
        }) as typeof reductionManager.tryReduce;
        return true;
    }

    /** `ReductionManager.tryReduce` counts calls and forwards to the real method. */
    public stubRecordReduce(): boolean {
        const reductionManager = this.service.sm.reductionManager;
        if (!this.service.stubOriginals.has("reduce")) {
            this.service.stubOriginals.set(
                "reduce",
                reductionManager.tryReduce.bind(reductionManager)
            );
        }
        this.service.reduceCallCount = 0;
        const original = this.service.stubOriginals.get(
            "reduce"
        ) as typeof reductionManager.tryReduce;
        reductionManager.tryReduce = ((forkId) => {
            this.service.reduceCallCount += 1;
            return original(forkId);
        }) as typeof reductionManager.tryReduce;
        return true;
    }

    public restoreReduce(): boolean {
        const reductionManager = this.service.sm.reductionManager;
        const original = this.service.stubOriginals.get("reduce");
        if (original === undefined) return false;
        reductionManager.tryReduce =
            original as typeof reductionManager.tryReduce;
        this.service.stubOriginals.delete("reduce");
        return true;
    }

    public getReduceCallCount(): number {
        return this.service.reduceCallCount;
    }

    /** Make the next reduction simulation fail with a selected contract error. */
    public stubNextReductionSimulationError(
        errorName: ReductionSimulationErrorName
    ): boolean {
        const contract = this.service.sm.stateChannelManagerContract;
        const runner = contract.runner;
        if (!runner?.call) {
            throw new Error(
                "Reduction simulation runner does not support call"
            );
        }
        if (!this.service.stubOriginals.has("reductionSimulation")) {
            this.service.stubOriginals.set(
                "reductionSimulation",
                runner.call.bind(runner)
            );
        }
        const original = this.service.stubOriginals.get(
            "reductionSimulation"
        ) as NonNullable<typeof runner.call>;
        const multicallSelector =
            contract.interface.getFunction("multicall")!.selector;
        runner.call = async (transaction) => {
            if (!String(transaction.data).startsWith(multicallSelector)) {
                return await original(transaction);
            }
            runner.call = original;
            this.service.stubOriginals.delete("reductionSimulation");
            throw { data: id(`${errorName}()`).slice(0, 10) };
        };
        return true;
    }

    public restoreReductionSimulation(): boolean {
        const contract = this.service.sm.stateChannelManagerContract;
        const runner = contract.runner;
        if (!runner?.call) return false;
        const original = this.service.stubOriginals.get("reductionSimulation");
        if (original === undefined) return false;
        runner.call = original as NonNullable<typeof runner.call>;
        this.service.stubOriginals.delete("reductionSimulation");
        return true;
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
        this.service.spectateSyncCallCount = 0;
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
