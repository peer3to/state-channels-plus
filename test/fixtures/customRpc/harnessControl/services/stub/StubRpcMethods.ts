// @spec-test-coverage-ignore: RPC fixture support exercised by owning E2E declarations.
import ARpcMethods from "@/rpc/ARpcMethods";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import { Codec, DetachedPromises, sleep, Type } from "@/utils";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import type { Status } from "@/types";
import type { Address } from "@/types/types";
import type SpectateServiceRpcMethods from "@/rpc/services/spectate/SpectateRpcMethods";
import type { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import type IsForkDisputedRpcMethods from "@/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods";
import InitHandshakeRpcMethods from "@/rpc/services/initHandshake/InitHandshakeRpcMethods";
import type JoinChannelRpcMethods from "@/rpc/services/joinChannel/JoinChannelRpcMethods";
import { encodedCustomErrorRevert } from "@test/factory";
import type { ForkId, Hash, Timestamp } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import { REDUCTION_ATTEMPT_STUB_FAILURE } from "./StubService";
import type {
    DisputeSubmissionFailureSpec,
    PausedConstructDisputeState,
    PausedConstructDisputeStatus,
    PausedReductionStatus,
    RecordedDisputeSubmission,
    RecordedFraudProofApply,
    ReductionSimulationErrorName,
    ConcurrentCalldataRecoveryProbe,
    CleanCommittedDivergenceProbe,
    DisputeStrategyResultMatrix,
    MissingParticipantSnapshotsProbe,
    BlockValidationProbe,
    BlockValidationProbeOptions,
    BlockProbeOptions,
    BlockIngestProbe,
    BlockCalldataRecoveryProbe,
    InboundRunRecoveryProbe,
    ReductionChallengeProbe,
    IsDisputedForkProbe,
    HeldLobbyReplyKind,
    HeldNegotiationReplyKind,
    HeldMembershipReceiptKind,
    ReductionApplicationControl,
    ReductionAttemptHoldPoint,
    ReductionAttemptResume,
    DetachedCallOutcome
} from "./StubService";
import type { BlockWorkHoldPoint, StubService } from "./StubService";
import { protocolEventTimeoutMs } from "@test/harness/core/testTimeConfig";

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

    public holdBlockWork(point: BlockWorkHoldPoint): boolean {
        if (!["authoring", "commit", "signature"].includes(point))
            throw new Error("Invalid block-work hold point");
        this.service.installBlockWorkHold(point);
        return true;
    }

    public getBlockWorkHoldEntered(): number {
        return this.service.blockWorkEntered;
    }

    public releaseBlockWorkHold(): boolean {
        this.service.releaseBlockWorkHold();
        return true;
    }

    public getStateMutexWaiterCount(): number {
        const queue = Reflect.get(this.service.sm.mutex, "queue");
        if (!Array.isArray(queue))
            throw new Error("Expected a mutex waiter queue");
        return queue.length;
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
        // This is deliberately scoped to block authoring. Stubbing the inbound
        // storage head also corrupts disputes constructed while the stub is
        // active.
        const production = this.service.sm.blockProductionService;
        if (!this.service.stubOriginals.has("pendingInboundInclusion")) {
            this.service.stubOriginals.set(
                "pendingInboundInclusion",
                production["getPendingInboundMessageBlocks"]
            );
        }
        production["getPendingInboundMessageBlocks"] = () => [];
        return true;
    }

    public restorePendingInboundInclusion(): boolean {
        const original = this.service.stubOriginals.get(
            "pendingInboundInclusion"
        );
        if (original === undefined) return false;
        const production = this.service.sm.blockProductionService;
        production["getPendingInboundMessageBlocks"] =
            original as (typeof production)["getPendingInboundMessageBlocks"];
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
     * calldata path).
     */
    public stubSuppressMaybePostBlockOnChain(): boolean {
        const posting = this.service.sm.calldataPostingService;
        if (!this.service.stubOriginals.has("maybePostBlockOnChain")) {
            this.service.stubOriginals.set(
                "maybePostBlockOnChain",
                posting.maybePostBlockOnChain
            );
        }
        posting.maybePostBlockOnChain = () => {};
        return true;
    }

    public restoreSuppressMaybePostBlockOnChain(): boolean {
        const original = this.service.stubOriginals.get(
            "maybePostBlockOnChain"
        );
        if (original === undefined) return false;
        const posting = this.service.sm.calldataPostingService;
        posting.maybePostBlockOnChain =
            original as typeof posting.maybePostBlockOnChain;
        this.service.stubOriginals.delete("maybePostBlockOnChain");
        return true;
    }

    /**
     * Stop this peer running the participant-timeout check, so a staged
     * scenario is not cut short by a real timeout dispute.
     */
    public stubSuppressTimeoutCheck(): boolean {
        const timeouts = this.service.sm.participantTimeoutService;
        if (!this.service.stubOriginals.has("timeoutCheck")) {
            this.service.stubOriginals.set(
                "timeoutCheck",
                timeouts["tryTimeoutParticipant"]
            );
        }
        timeouts["tryTimeoutParticipant"] = async () => undefined;
        return true;
    }

    public restoreSuppressTimeoutCheck(): boolean {
        const original = this.service.stubOriginals.get("timeoutCheck");
        if (original === undefined) return false;
        const timeouts = this.service.sm.participantTimeoutService;
        timeouts["tryTimeoutParticipant"] =
            original as (typeof timeouts)["tryTimeoutParticipant"];
        this.service.stubOriginals.delete("timeoutCheck");
        return true;
    }

    /**
     * Make this peer reject every ingested block confirmation, as if the
     * queue refused it.
     */
    public stubRejectIngestedConfirmations(): boolean {
        const queue = this.service.sm.blockQueueManager;
        if (!this.service.stubOriginals.has("ingestConfirmations")) {
            this.service.stubOriginals.set(
                "ingestConfirmations",
                queue.ingestBlockConfirmation
            );
        }
        queue.ingestBlockConfirmation = async () => false;
        return true;
    }

    public restoreRejectIngestedConfirmations(): boolean {
        const original = this.service.stubOriginals.get("ingestConfirmations");
        if (original === undefined) return false;
        const queue = this.service.sm.blockQueueManager;
        queue.ingestBlockConfirmation =
            original as typeof queue.ingestBlockConfirmation;
        this.service.stubOriginals.delete("ingestConfirmations");
        return true;
    }

    /**
     * Drop every block confirmation the network delivers to this peer while
     * the harness control port still ingests. The peer stays blind to gossip
     * with every transport live, so a sync probe toward a source can run.
     */
    public stubDropNetworkConfirmations(): boolean {
        const queue = this.service.sm.blockQueueManager;
        if (this.service.stubOriginals.has("networkConfirmations")) return true;
        const original = queue.ingestBlockConfirmation;
        this.service.stubOriginals.set("networkConfirmations", original);
        const context = this.service.controlIngestContext;
        queue.ingestBlockConfirmation = async (blockConfirmation, options) =>
            context.getStore()
                ? await Reflect.apply(original, queue, [
                      blockConfirmation,
                      options
                  ])
                : true;
        return true;
    }

    /**
     * Hold this peer's own sync at its application step, so the sync stays
     * in flight toward its responder after the response arrived.
     */
    public stubHoldSpectateSyncApplication(): boolean {
        this.restoreHoldSpectateSyncApplication();
        const spectate = this.p2pManager.localRpc.spectateService;
        const original = spectate.applySyncResponse;
        this.service.stubOriginals.set("spectateSyncApplication", original);
        const gate = this.service.createGate();
        this.service.spectateSyncApplicationGate = gate;
        Reflect.set(
            spectate,
            "applySyncResponse",
            async (...parameters: unknown[]) => {
                gate.entered += 1;
                await gate.gate;
                return Reflect.apply(original, spectate, parameters);
            }
        );
        return true;
    }

    public getHeldSpectateSyncApplicationCount(): number {
        return this.service.spectateSyncApplicationGate?.entered ?? 0;
    }

    public restoreHoldSpectateSyncApplication(): boolean {
        const original = this.service.stubOriginals.get(
            "spectateSyncApplication"
        );
        this.service.spectateSyncApplicationGate?.release();
        this.service.spectateSyncApplicationGate = undefined;
        if (original === undefined) return false;
        Reflect.set(
            this.p2pManager.localRpc.spectateService,
            "applySyncResponse",
            original
        );
        this.service.stubOriginals.delete("spectateSyncApplication");
        return true;
    }

    public restoreDropNetworkConfirmations(): boolean {
        const original = this.service.stubOriginals.get("networkConfirmations");
        if (original === undefined) return false;
        const queue = this.service.sm.blockQueueManager;
        queue.ingestBlockConfirmation =
            original as typeof queue.ingestBlockConfirmation;
        this.service.stubOriginals.delete("networkConfirmations");
        return true;
    }

    /**
     * Record the label and delay of every scheduled task; tasks whose label
     * starts with `suppressPrefix` are recorded and never run.
     */
    public stubRecordScheduledTasks(suppressPrefix?: string): boolean {
        const timeoutManager = this.service.sm.timeoutManager;
        if (!this.service.stubOriginals.has("scheduledTasks")) {
            this.service.stubOriginals.set(
                "scheduledTasks",
                timeoutManager.scheduleTask.bind(timeoutManager)
            );
        }
        const original = this.service.stubOriginals.get(
            "scheduledTasks"
        ) as typeof timeoutManager.scheduleTask;
        this.service.recordedScheduledTasks.length = 0;
        timeoutManager.scheduleTask = (task, delayMs, taskName = "unnamed") => {
            this.service.recordedScheduledTasks.push({ taskName, delayMs });
            if (suppressPrefix && taskName.startsWith(suppressPrefix)) {
                return {} as ReturnType<typeof setTimeout>;
            }
            return original(task, delayMs, taskName);
        };
        return true;
    }

    public getRecordedScheduledTasks(): {
        tasks: { taskName: string; delayMs: number }[];
    } {
        return {
            tasks: this.service.recordedScheduledTasks.map((entry) => ({
                ...entry
            }))
        };
    }

    public restoreRecordScheduledTasks(): boolean {
        const original = this.service.stubOriginals.get("scheduledTasks");
        if (original === undefined) return false;
        const timeoutManager = this.service.sm.timeoutManager;
        timeoutManager.scheduleTask =
            original as typeof timeoutManager.scheduleTask;
        this.service.stubOriginals.delete("scheduledTasks");
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

    /** Make the fully-signed snapshot path fail so exit falls back to dispute. */
    public failPostStateSnapshotWait(): boolean {
        const snapshotUpdateService = this.service.sm.snapshotUpdateService;
        if (!this.service.stubOriginals.has("postStateSnapshotWait")) {
            this.service.stubOriginals.set(
                "postStateSnapshotWait",
                snapshotUpdateService.postStateSnapshotWait
            );
        }
        snapshotUpdateService.postStateSnapshotWait = async () => {
            throw new Error("injected state snapshot post failure");
        };
        return true;
    }

    public restorePostStateSnapshotWait(): boolean {
        const original = this.service.stubOriginals.get(
            "postStateSnapshotWait"
        );
        if (original === undefined) return false;
        const snapshotUpdateService = this.service.sm.snapshotUpdateService;
        snapshotUpdateService.postStateSnapshotWait =
            original as typeof snapshotUpdateService.postStateSnapshotWait;
        this.service.stubOriginals.delete("postStateSnapshotWait");
        return true;
    }

    /**
     * Wrap `unsafeSetLatestState` so it records when it fires (queried via
     * `wasUnsafeSetLatestStateCalled`) but still runs the original.
     */
    public stubRecordUnsafeSetLatestState(): boolean {
        const stateApplication = this.service.sm.stateApplicationService;
        if (!this.service.stubOriginals.has("unsafeSetLatestState")) {
            this.service.stubOriginals.set(
                "unsafeSetLatestState",
                stateApplication.unsafeSetLatestState
            );
        }
        this.service.unsafeSetLatestStateCalled = false;
        const original = this.service.stubOriginals.get(
            "unsafeSetLatestState"
        ) as typeof stateApplication.unsafeSetLatestState;
        const stubService = this.service;
        stateApplication.unsafeSetLatestState = async (...args) => {
            stubService.unsafeSetLatestStateCalled = true;
            return original.apply(stateApplication, args);
        };
        return true;
    }

    public wasUnsafeSetLatestStateCalled(): boolean {
        return this.service.unsafeSetLatestStateCalled;
    }

    public restoreUnsafeSetLatestState(): boolean {
        const original = this.service.stubOriginals.get("unsafeSetLatestState");
        if (original === undefined) return false;
        const stateApplication = this.service.sm.stateApplicationService;
        stateApplication.unsafeSetLatestState =
            original as typeof stateApplication.unsafeSetLatestState;
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

    /** Delay join-signature replies while still running the real handler. */
    public stubDelayJoinSignatureResponses(delayMs: number): boolean {
        const service = this.p2pManager.localRpc.joinChannelService;
        if (!this.service.stubOriginals.has("joinSignatureCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "joinSignatureCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "joinSignatureCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            const realRequest = methods.requestJoinSignature.bind(methods);
            methods.requestJoinSignature = async (...args) => {
                await sleep(delayMs);
                return realRequest(...args);
            };
            return methods;
        };
        return true;
    }

    /** Make join-signature requests fail at the responder. */
    public stubFailJoinSignatureRequests(): boolean {
        const service = this.p2pManager.localRpc.joinChannelService;
        if (!this.service.stubOriginals.has("joinSignatureCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "joinSignatureCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "joinSignatureCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            methods.requestJoinSignature = async function (
                this: JoinChannelRpcMethods
            ) {
                throw new Error("stubbed join-signature failure");
            };
            return methods;
        };
        return true;
    }

    /** Return the joiner's signature instead of the responder's signature. */
    public stubWrongJoinSignatureSigner(): boolean {
        const service = this.p2pManager.localRpc.joinChannelService;
        if (!this.service.stubOriginals.has("joinSignatureCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "joinSignatureCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        const original = this.service.stubOriginals.get(
            "joinSignatureCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            methods.requestJoinSignature = async (
                encodedSignedJoinChannel: string
            ) => {
                const signedJoinChannel = Codec.decode(
                    encodedSignedJoinChannel,
                    Type.SignedJoinChannel
                );
                return { signature: String(signedJoinChannel.signature) };
            };
            return methods;
        };
        return true;
    }

    /** Count join-signature requests while still running the real handler. */
    public stubCountJoinSignatureRequests(): boolean {
        const service = this.p2pManager.localRpc.joinChannelService;
        if (!this.service.stubOriginals.has("joinSignatureCreateRpcMethods")) {
            this.service.stubOriginals.set(
                "joinSignatureCreateRpcMethods",
                service.createRPCMethods.bind(service)
            );
        }
        this.service.joinSignatureRequestCount = 0;
        const original = this.service.stubOriginals.get(
            "joinSignatureCreateRpcMethods"
        ) as typeof service.createRPCMethods;
        const stubService = this.service;
        service.createRPCMethods = (transport: ATransport) => {
            const methods = original(transport);
            const realRequest = methods.requestJoinSignature.bind(methods);
            methods.requestJoinSignature = (...args) => {
                stubService.joinSignatureRequestCount++;
                return realRequest(...args);
            };
            return methods;
        };
        return true;
    }

    public getJoinSignatureRequestCount(): number {
        return this.service.joinSignatureRequestCount;
    }

    public restoreJoinSignatureRequests(): boolean {
        const original = this.service.stubOriginals.get(
            "joinSignatureCreateRpcMethods"
        );
        if (original === undefined) return false;
        const service = this.p2pManager.localRpc.joinChannelService;
        service.createRPCMethods = original as typeof service.createRPCMethods;
        this.service.stubOriginals.delete("joinSignatureCreateRpcMethods");
        return true;
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

    public async sendSpectateRequestOverCapturedHandshakeTransport(
        channelId: string,
        initTime: number
    ): Promise<string> {
        const transport = this.service.capturedInitHandshakeTransport;
        if (!transport) throw new Error("no captured handshake transport");
        try {
            await this.p2pManager.sendRpcRequest(
                {
                    service: "spectateService",
                    method: "onSpectateRequest",
                    params: [{ channelId, initTime }]
                },
                transport,
                {
                    timeoutMs: protocolEventTimeoutMs(
                        this.p2pManager.stateManager.timeConfig
                    )
                }
            );
            return "resolved";
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    public restoreBlockedHandshake(): boolean {
        const original = this.service.stubOriginals.get("blockedInitHandshake");
        if (original === undefined) return false;
        const service = this.p2pManager.localRpc.initHandshakeService;
        service.initHandshake = original as typeof service.initHandshake;
        this.service.stubOriginals.delete("blockedInitHandshake");
        return true;
    }

    /** Record calls to the runtime abort owner while preserving its behavior. */
    public stubRecordAbort(): boolean {
        const stateManager = this.p2pManager.stateManager;
        if (!this.service.stubOriginals.has("stateManagerAbort")) {
            this.service.stubOriginals.set(
                "stateManagerAbort",
                stateManager.abort.bind(stateManager)
            );
        }
        this.service.abortCalled = false;
        const original = this.service.stubOriginals.get(
            "stateManagerAbort"
        ) as typeof stateManager.abort;
        const stubService = this.service;
        stateManager.abort = () => {
            stubService.abortCalled = true;
            return original();
        };
        return true;
    }

    public wasAbortCalled(): boolean {
        return this.service.abortCalled;
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
     * - `corruptSignature` replaces the signature with undecodable bytes so the
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
                    response.signature = "0x00";
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

    /**
     * Capture timer tasks whose name starts with `prefix` instead of
     * scheduling them. Holds for different prefixes chain; each is released
     * by its own restore call.
     */
    public stubHoldScheduledTasks(prefix: string): boolean {
        const timeoutManager = this.service.sm.timeoutManager;
        if (this.service.heldScheduledTasks.has(prefix)) return false;
        this.service.heldScheduledTasks.set(prefix, []);
        if (this.service.heldScheduledTaskBase) return true;
        // One dispatcher for every active prefix: a task is held by the first
        // prefix it matches, everything else reaches the real scheduler.
        const base = timeoutManager.scheduleTask.bind(timeoutManager);
        this.service.heldScheduledTaskBase = base;
        timeoutManager.scheduleTask = (task, delayMs, taskName = "unnamed") => {
            for (const [held, tasks] of this.service.heldScheduledTasks) {
                if (taskName.startsWith(held)) {
                    tasks.push({ taskName, task });
                    return {} as ReturnType<typeof setTimeout>;
                }
            }
            return base(task, delayMs, taskName);
        };
        return true;
    }

    /** Held task count for `prefix` so far. */
    public getHeldScheduledTaskCount(prefix: string): number {
        return this.service.heldScheduledTasks.get(prefix)?.length ?? 0;
    }

    /**
     * Restore scheduling for `prefix`; optionally run the held tasks
     * (fire-and-forget).
     */
    public restoreHeldScheduledTasks(
        prefix: string,
        runHeld: boolean
    ): boolean {
        const timeoutManager = this.service.sm.timeoutManager;
        const held = this.service.heldScheduledTasks.get(prefix);
        if (held === undefined) return false;
        this.service.heldScheduledTasks.delete(prefix);
        if (
            this.service.heldScheduledTasks.size === 0 &&
            this.service.heldScheduledTaskBase
        ) {
            timeoutManager.scheduleTask = this.service.heldScheduledTaskBase;
            this.service.heldScheduledTaskBase = undefined;
        }
        if (runHeld) for (const { task } of held) void task();
        return true;
    }

    /** Capture `reduction-*` timer tasks instead of scheduling them. */
    public stubHoldReductionTasks(): boolean {
        return this.stubHoldScheduledTasks("reduction-");
    }

    /** Restore scheduling; optionally run the held tasks (fire-and-forget). */
    public restoreReductionTasks(runHeld: boolean): boolean {
        return this.restoreHeldScheduledTasks("reduction-", runHeld);
    }

    // Reduction genesis application control: pause or fail one VM call made by
    // the real reduction-specific application. The wrapped application raises
    // an "active" flag for its duration so the general application path stays
    // untouched; every other collaborator is real.

    public holdReductionGenesisApplication(
        control: ReductionApplicationControl
    ): boolean {
        // The control arrives as JSON over the RPC port; the discriminants
        // are checked here, before any wrapper is restored or installed.
        const keys =
            typeof control === "object" && control !== null
                ? Object.keys(control).sort()
                : [];
        const validAt =
            control?.outcome === "hold"
                ? ["setState", "getParticipants", "getNextToWrite"]
                : control?.outcome === "reject"
                  ? ["getParticipants", "getNextToWrite"]
                  : [];
        if (keys.join(",") !== "at,outcome" || !validAt.includes(control.at)) {
            throw new Error(
                `Invalid reduction application control: ${JSON.stringify(control)}`
            );
        }
        this.service.restoreReductionApplication();
        const sm = this.service.sm;
        const application = sm.stateApplicationService;
        const diamond = sm.diamondStateMachine;
        const gate = this.service.createGate();
        this.service.reductionApplicationGate = gate;
        this.service.reductionApplicationControl = control;
        this.service.reductionApplicationEntered = 0;

        const originalApplication =
            application.unsafeApplyReductionGenesis.bind(application);
        this.service.stubOriginals.set(
            "reductionApplication",
            originalApplication
        );
        const context = this.service.reductionApplicationContext;
        application.unsafeApplyReductionGenesis = (...parameters) =>
            context.run(true, () => originalApplication(...parameters));

        const intercept = async (at: ReductionApplicationControl["at"]) => {
            const active = this.service.reductionApplicationControl;
            if (!context.getStore() || !active || active.at !== at) {
                return;
            }
            gate.entered += 1;
            this.service.reductionApplicationEntered += 1;
            if (active.outcome === "reject") {
                // One-shot: the next call of the same read runs for real.
                this.service.reductionApplicationControl = undefined;
                throw new Error("Stubbed reduction genesis read failure");
            }
            await gate.gate;
        };

        const originalSetState = diamond.setState.bind(diamond);
        this.service.stubOriginals.set(
            "reductionApplicationSetState",
            originalSetState
        );
        diamond.setState = async (...parameters) => {
            const result = await originalSetState(...parameters);
            await intercept("setState");
            return result;
        };
        const originalGetParticipants = diamond.getParticipants.bind(diamond);
        this.service.stubOriginals.set(
            "reductionApplicationGetParticipants",
            originalGetParticipants
        );
        diamond.getParticipants = async () => {
            await intercept("getParticipants");
            return originalGetParticipants();
        };
        const originalGetNextToWrite = diamond.getNextToWrite.bind(diamond);
        this.service.stubOriginals.set(
            "reductionApplicationGetNextToWrite",
            originalGetNextToWrite
        );
        diamond.getNextToWrite = async () => {
            await intercept("getNextToWrite");
            return originalGetNextToWrite();
        };
        return true;
    }

    public getHeldReductionGenesisApplicationCount(): number {
        return this.service.reductionApplicationEntered;
    }

    /** Whether the reduction application wrappers are currently installed. */
    public isReductionGenesisApplicationHeld(): boolean {
        return this.service.stubOriginals.has("reductionApplication");
    }

    public restoreReductionGenesisApplication(): boolean {
        this.service.restoreReductionApplication();
        return true;
    }

    /**
     * Pause one reduction attempt after its completion exists: at the
     * executor attempt (before any executor work) or at candidate computation
     * (before the terminal outbound block is persisted).
     */
    public holdReductionAttempt(
        at: ReductionAttemptHoldPoint,
        resumeWith: ReductionAttemptResume = "original"
    ): boolean {
        this.service.restoreReductionAttempt();
        const manager = this.service.sm.reductionManager;
        const executor = manager["reductionExecutor"];
        const observed = executor.tryReduce;
        this.service.stubOriginals.set("reductionObservedAttempt", observed);
        executor.tryReduce = async (...args) => {
            this.service.reductionAttemptsInFlight += 1;
            try {
                return await observed.apply(executor, args);
            } finally {
                this.service.reductionAttemptsInFlight -= 1;
            }
        };
        const gate = this.service.createGate();
        this.service.reductionAttemptGate = gate;
        const resume = async <T>(original: () => Promise<T>) => {
            gate.entered += 1;
            await gate.gate;
            if (resumeWith === "throw") {
                throw new Error(REDUCTION_ATTEMPT_STUB_FAILURE);
            }
            if (resumeWith === "undefined") return undefined as T;
            return original();
        };
        if (at === "admission") {
            const contract = this.service.sm.stateChannelManagerContract;
            const original = contract.isForkDisputed;
            this.service.stubOriginals.set("reductionAdmission", original);
            Reflect.set(
                contract,
                "isForkDisputed",
                async (...args: unknown[]) => {
                    const result = await Reflect.apply(
                        original,
                        contract,
                        args
                    );
                    // One pending caller is enough; sync verification retains real reads.
                    Reflect.set(contract, "isForkDisputed", original);
                    gate.entered += 1;
                    await gate.gate;
                    return result;
                }
            );
            return true;
        }
        if (at === "attempt") {
            const original = executor.tryReduce.bind(executor);
            this.service.stubOriginals.set("reductionAttempt", original);
            executor.tryReduce = (forkId) => resume(() => original(forkId));
            return true;
        }
        if (at === "disputes") {
            const original = executor.getSyncedForkDisputes.bind(executor);
            this.service.stubOriginals.set("reductionDisputes", original);
            executor.getSyncedForkDisputes = (forkId) =>
                resume(() => original(forkId));
            return true;
        }
        if (at === "submit") {
            const contract = this.service.sm.stateChannelManagerContract;
            const gasLimit = contract.getGasLimit;
            const multicall = contract.multicall;
            this.service.stubOriginals.set("reductionSubmitGasLimit", gasLimit);
            this.service.stubOriginals.set(
                "reductionSubmitMulticall",
                multicall
            );
            this.service.reductionSubmitCalls = 0;
            Reflect.set(contract, "getGasLimit", (...parameters: unknown[]) =>
                resume(() => Reflect.apply(gasLimit, contract, parameters))
            );
            // Count the chain write while keeping the method's static-call
            // and estimation faces for the simulation that precedes it.
            const counted = (...parameters: unknown[]) => {
                this.service.reductionSubmitCalls += 1;
                return Reflect.apply(multicall, contract, parameters);
            };
            for (const key of Object.getOwnPropertyNames(multicall)) {
                if (key in counted) continue;
                Object.defineProperty(
                    counted,
                    key,
                    Object.getOwnPropertyDescriptor(multicall, key)!
                );
            }
            Reflect.set(contract, "multicall", counted);
            return true;
        }
        const computation = manager["reductionComputationService"];
        const original = computation.compute.bind(computation);
        this.service.stubOriginals.set("reductionCompute", original);
        computation.compute = (...parameters) =>
            resume(() => original(...parameters));
        return true;
    }

    /** Make this host deny its writer turn until restored (harness helper staging). */
    public stubDenyTurn(): boolean {
        this.restoreDenyTurn();
        const production = this.service.sm.blockProductionService;
        const original = production["isMyTurn"].bind(production);
        this.service.stubOriginals.set("denyTurn", original);
        production["isMyTurn"] = async () => false;
        return true;
    }

    public restoreDenyTurn(): boolean {
        const production = this.service.sm.blockProductionService;
        const original = this.service.stubOriginals.get("denyTurn");
        if (original) {
            production["isMyTurn"] =
                original as (typeof production)["isMyTurn"];
            this.service.stubOriginals.delete("denyTurn");
        }
        return true;
    }

    public stubRecordForkLeave(forkId: ForkId): boolean {
        this.service.recordForkLeave(forkId);
        return true;
    }

    public getForkLeaveObservation(): {
        scheduled: number;
        cancelled: number;
        settledStateObserved: number;
    } {
        return { ...this.service.forkLeaveObservation };
    }

    public restoreForkLeave(): boolean {
        this.service.restoreForkLeave();
        return true;
    }

    public getCollectedDetachedPromiseCount(): number {
        return DetachedPromises.size();
    }

    public getReductionAttemptsInFlight(): number {
        return this.service.reductionAttemptsInFlight;
    }

    public getHeldReductionAttemptCount(): number {
        return this.service.reductionAttemptGate?.entered ?? 0;
    }

    /** Chain writes attempted by a reduction submission since the submit hold was installed. */
    public getReductionSubmitCallCount(): number {
        return this.service.reductionSubmitCalls;
    }

    public restoreReductionAttempt(): boolean {
        this.service.restoreReductionAttempt();
        return true;
    }

    /** Start a real reduction attempt host-side and keep its outcome. */
    public startTryReduce(forkId: ForkId): boolean {
        const outcome: DetachedCallOutcome = {
            settled: false,
            result: null,
            rejected: null
        };
        this.service.tryReduceOutcome = outcome;
        void this.service.sm.reductionManager.tryReduce(forkId).then(
            (reduction) => {
                outcome.settled = true;
                outcome.result = reduction
                    ? String(reduction.reducedForkId)
                    : null;
            },
            (error) => {
                outcome.settled = true;
                outcome.rejected =
                    error instanceof Error ? error.message : String(error);
            }
        );
        return true;
    }

    public getTryReduceOutcome(): DetachedCallOutcome | null {
        const outcome = this.service.tryReduceOutcome;
        return outcome ? { ...outcome } : null;
    }

    /** Hold the state-manager mutex until released. */
    public holdStateMutex(): boolean {
        this.service.releaseStateMutex();
        const gate = this.service.createGate();
        this.service.stateMutexGate = gate;
        void this.service.sm.withMutex(
            async () => {
                gate.entered += 1;
                await gate.gate;
            },
            { taskName: "stub.holdStateMutex" }
        );
        return true;
    }

    public getStateMutexHeldCount(): number {
        return this.service.stateMutexGate?.entered ?? 0;
    }

    public releaseStateMutex(): boolean {
        this.service.releaseStateMutex();
        return true;
    }

    /**
     * Start a direct `completeWithGenesis` for the current fork host-side,
     * using the fork's own genesis snapshot and state as the reduced genesis,
     * and keep its outcome.
     */
    public startCompleteWithGenesis(reducedForkId: ForkId): boolean {
        const sm = this.service.sm;
        const genesisSnapshot =
            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(sm.forkId);
        if (!genesisSnapshot) {
            throw new Error("No genesis snapshot for the current fork");
        }
        const snapshot = genesisSnapshot.toStruct();
        const encodedState = sm.storage.stateMachineStates.getStateMachineState(
            snapshot.snapshotData.stateMachineStateHash as Hash
        );
        if (!encodedState) {
            throw new Error("No state machine state for the current fork");
        }
        const outcome: DetachedCallOutcome = {
            settled: false,
            result: null,
            rejected: null
        };
        this.service.completeWithGenesisOutcome = outcome;
        void sm.reductionManager
            .completeWithGenesis(sm.forkId, reducedForkId, {
                snapshotData: snapshot.snapshotData,
                encodedState,
                genesisTimestamp: Number(snapshot.timestamp)
            })
            .then(
                (installed) => {
                    outcome.settled = true;
                    outcome.result = String(installed);
                },
                (error) => {
                    outcome.settled = true;
                    outcome.rejected =
                        error instanceof Error ? error.message : String(error);
                }
            );
        return true;
    }

    public getCompleteWithGenesisOutcome(): DetachedCallOutcome | null {
        const outcome = this.service.completeWithGenesisOutcome;
        return outcome ? { ...outcome } : null;
    }

    /** Abort the runtime on the next tick so this request still answers. */
    public abortDetached(): boolean {
        const sm = this.service.sm;
        setTimeout(() => sm.abort(), 0);
        return true;
    }

    /**
     * Stop applying processed inbound messages to the local diamond -> its
     * in-memory EVM falls behind the RPC node while storage stays whole.
     */
    public stubLocalDiamondInboundMessages(): boolean {
        const localDiamond =
            this.service.sm.diamondStateMachine.localDiamondContract;
        if (!this.service.stubOriginals.has("localDiamondInboundMessages")) {
            this.service.stubOriginals.set(
                "localDiamondInboundMessages",
                localDiamond.onInboundMessagesProcessed
            );
        }
        localDiamond.onInboundMessagesProcessed = (async () =>
            undefined) as unknown as typeof localDiamond.onInboundMessagesProcessed;
        return true;
    }

    public restoreLocalDiamondInboundMessages(): boolean {
        const original = this.service.stubOriginals.get(
            "localDiamondInboundMessages"
        );
        if (original === undefined) return false;
        const localDiamond =
            this.service.sm.diamondStateMachine.localDiamondContract;
        localDiamond.onInboundMessagesProcessed =
            original as typeof localDiamond.onInboundMessagesProcessed;
        this.service.stubOriginals.delete("localDiamondInboundMessages");
        return true;
    }

    /** Park the dispute audit at its on-chain-slashes query until released. */
    /** Park every auditing-data rebuild until restored. */
    public stubHoldAuditingDataRebuild(): boolean {
        this.service.installAuditingDataRebuildHold();
        return true;
    }

    /** Release parked rebuilds and restore the real method. */
    public restoreAuditingDataRebuild(): boolean {
        return this.service.releaseAuditingDataRebuildHold();
    }

    /** Resolves once a rebuild is parked at the hold; parked count. */
    public waitForHeldAuditingDataRebuild(): Promise<number> {
        return this.service.waitForHeldAuditingDataRebuild();
    }

    public async joinAndLeavePendingLocalDiscovery(
        topic: string
    ): Promise<boolean> {
        await this.service.joinAndLeavePendingLocalDiscovery(topic);
        return true;
    }

    public getLocalDiscoveryListenerCount(): number {
        return this.service.getLocalDiscoveryListenerCount();
    }

    /** Broadcast a real calldata post with an expired deadline; its receipt reverts. */
    public stubExpireCalldataPost(): boolean {
        this.service.expireCalldataPost();
        return true;
    }

    public restoreCalldataPost(): boolean {
        return this.service.restoreCalldataPost();
    }

    /** Park this peer's snapshot post at its contract send until restored. */
    public stubHoldSnapshotPostSend(): boolean {
        this.service.installSnapshotPostSendHold();
        return true;
    }

    /** Release the parked send and restore the real contract method. */
    public restoreSnapshotPostSend(): boolean {
        return this.service.releaseSnapshotPostSendHold();
    }

    /** Resolves once a post is parked at its send; parked count. */
    public waitForHeldSnapshotPostSend(): Promise<number> {
        return this.service.waitForHeldSnapshotPostSend();
    }

    public stubHoldOnChainSlashesQuery(): boolean {
        this.service.installOnChainSlashesQueryHold();
        return true;
    }

    /** Release parked audits and restore the real query. */
    public restoreOnChainSlashesQuery(): boolean {
        return this.service.releaseOnChainSlashesQueryHold();
    }

    /** Resolves once a caller is parked at the hold; parked count. */
    public waitForHeldOnChainSlashesQuery(): Promise<number> {
        return this.service.waitForHeldOnChainSlashesQuery();
    }

    public getHeldReductionTaskCount(): number {
        return this.getHeldScheduledTaskCount("reduction-");
    }

    public dropHeldReductionTasks(): boolean {
        this.service.heldScheduledTasks.get("reduction-")?.splice(0);
        return true;
    }

    public cancelScheduledReductions(): boolean {
        this.service.sm.reductionManager["cancelScheduledReductions"]();
        return true;
    }

    public async probeDisputeReductionChallenge(
        reducedForkId: ForkId
    ): Promise<ReductionChallengeProbe> {
        return this.service.probeDisputeReductionChallenge(reducedForkId);
    }

    public async probeInboundRunRecovery(
        upperBlockHash: Hash,
        options?: { failChainQueries?: boolean }
    ): Promise<InboundRunRecoveryProbe> {
        return this.service.probeInboundRunRecovery(upperBlockHash, options);
    }

    public async probeBlockCalldataRecovery(options?: {
        failChainQueries?: boolean;
    }): Promise<BlockCalldataRecoveryProbe> {
        return this.service.probeBlockCalldataRecovery(options);
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
    /**
     * Record `dispute()`'s upload without sending it. `holdSubmissions` parks
     * each recorded send until `releaseDisputeSubmissions`; `failure` makes the
     * send (or its `wait()`) fail with a real custom-error revert.
     */
    public stubRecordDisputeSubmissions(
        holdSubmissions: boolean,
        failure?: DisputeSubmissionFailureSpec,
        forward = false
    ): boolean {
        this.service.installDisputeSubmissionRecorder(
            holdSubmissions,
            failure,
            forward
        );
        return true;
    }

    public getRecordedDisputeSubmissions(): {
        submissions: RecordedDisputeSubmission[];
        held: number;
    } {
        return {
            submissions: this.service.recordedDisputeSubmissions.map(
                (submission) => ({ ...submission })
            ),
            held: this.service.disputeSubmissionHold?.held ?? 0
        };
    }

    public releaseDisputeSubmissions(): boolean {
        const hold = this.service.disputeSubmissionHold;
        if (!hold) return false;
        this.service.disputeSubmissionHold = undefined;
        hold.release();
        return true;
    }

    public restoreDisputeSubmissions(): boolean {
        return this.service.restoreDisputeSubmissions();
    }

    /**
     * Record `killDispute`'s on-chain apply and how it settled (the real
     * transaction still runs). `holdApplies` parks each send until
     * `releaseDisputeFraudProofApplies`.
     */
    public stubRecordDisputeFraudProofApplies(
        holdApplies: boolean,
        failure?: DisputeSubmissionFailureSpec
    ): boolean {
        this.service.installDisputeFraudProofApplyRecorder(
            holdApplies,
            failure
        );
        return true;
    }

    public getRecordedDisputeFraudProofApplies(): {
        applies: RecordedFraudProofApply[];
        held: number;
    } {
        return {
            applies: this.service.recordedFraudProofApplies.map((apply) => ({
                ...apply
            })),
            held: this.service.fraudProofApplyHold?.held ?? 0
        };
    }

    public releaseDisputeFraudProofApplies(): boolean {
        const hold = this.service.fraudProofApplyHold;
        if (!hold) return false;
        this.service.fraudProofApplyHold = undefined;
        hold.release();
        return true;
    }

    public restoreDisputeFraudProofApplies(): boolean {
        return this.service.restoreDisputeFraudProofApplies();
    }

    /** Keep this peer out of a kill race (counts the kills it skipped). */
    public stubSuppressDisputeKill(): boolean {
        const disputeManager = this.service.sm.disputeManager;
        if (!this.service.stubOriginals.has("disputeKill")) {
            this.service.stubOriginals.set(
                "disputeKill",
                disputeManager.killDispute.bind(disputeManager)
            );
        }
        this.service.suppressedDisputeKillCount = 0;
        disputeManager.killDispute = (async () => {
            this.service.suppressedDisputeKillCount += 1;
        }) as typeof disputeManager.killDispute;
        return true;
    }

    public getSuppressedDisputeKillCount(): number {
        return this.service.suppressedDisputeKillCount;
    }

    public restoreDisputeKill(): boolean {
        const original = this.service.stubOriginals.get("disputeKill");
        if (original === undefined) return false;
        const disputeManager = this.service.sm.disputeManager;
        disputeManager.killDispute =
            original as typeof disputeManager.killDispute;
        this.service.stubOriginals.delete("disputeKill");
        return true;
    }

    /** Callers queued behind the dispute mutex (its queue is private). */
    public getDisputeMutexWaiterCount(): number {
        return (
            this.service.sm.disputeManager.mutex as unknown as {
                queue: unknown[];
            }
        ).queue.length;
    }

    /**
     * Park `constructDispute` for `forkId` at its `getStateProof` await - the
     * first async boundary inside it, so a construction parked there has
     * started but has not yet read the stored fraud proofs. The park is scoped
     * to a running `constructDispute`, so an unrelated `getStateProof` caller
     * can never take it instead and leave the test's race unstaged.
     */
    public stubPauseConstructDisputeAtStateProof(forkId: ForkId): boolean {
        const agreementManager = this.service.sm.agreementManager;
        const disputeManager = this.service.sm.disputeManager;
        if (!this.service.stubOriginals.has("constructDisputeStateProof")) {
            this.service.stubOriginals.set(
                "constructDisputeStateProof",
                agreementManager.getStateProof.bind(agreementManager)
            );
        }
        if (!this.service.stubOriginals.has("constructDisputeEntry")) {
            this.service.stubOriginals.set(
                "constructDisputeEntry",
                disputeManager.constructDispute.bind(disputeManager)
            );
        }
        const originalStateProof = this.service.stubOriginals.get(
            "constructDisputeStateProof"
        ) as typeof agreementManager.getStateProof;
        const originalConstruct = this.service.stubOriginals.get(
            "constructDisputeEntry"
        ) as typeof disputeManager.constructDispute;

        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const state: PausedConstructDisputeState = {
            targetForkId: forkId,
            entered: 0,
            released: false,
            inside: false,
            gate,
            release
        };
        this.service.pausedConstructDispute = state;

        disputeManager.constructDispute = ((requestedForkId: ForkId) => {
            if (requestedForkId !== state.targetForkId) {
                return originalConstruct(requestedForkId);
            }
            state.inside = true;
            return originalConstruct(requestedForkId).finally(() => {
                state.inside = false;
            });
        }) as typeof disputeManager.constructDispute;

        agreementManager.getStateProof = (async (
            requestedForkId: ForkId,
            blockHeight: number
        ) => {
            if (
                state.inside &&
                requestedForkId === state.targetForkId &&
                !state.released
            ) {
                state.entered += 1;
                await state.gate;
            }
            return originalStateProof(requestedForkId, blockHeight);
        }) as typeof agreementManager.getStateProof;
        return true;
    }

    public releasePausedConstructDispute(): boolean {
        const state = this.service.pausedConstructDispute;
        if (!state) return false;
        state.released = true;
        state.release();
        return true;
    }

    public getPausedConstructDisputeStatus(): PausedConstructDisputeStatus {
        const state = this.service.pausedConstructDispute;
        return {
            entered: state?.entered ?? 0,
            released: state?.released ?? false
        };
    }

    public restorePausedConstructDispute(): boolean {
        this.releasePausedConstructDispute();
        const originalStateProof = this.service.stubOriginals.get(
            "constructDisputeStateProof"
        );
        if (originalStateProof === undefined) return false;
        const agreementManager = this.service.sm.agreementManager;
        agreementManager.getStateProof =
            originalStateProof as typeof agreementManager.getStateProof;
        this.service.stubOriginals.delete("constructDisputeStateProof");

        const originalConstruct = this.service.stubOriginals.get(
            "constructDisputeEntry"
        );
        if (originalConstruct !== undefined) {
            const disputeManager = this.service.sm.disputeManager;
            disputeManager.constructDispute =
                originalConstruct as typeof disputeManager.constructDispute;
            this.service.stubOriginals.delete("constructDisputeEntry");
        }
        this.service.pausedConstructDispute = undefined;
        return true;
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

    /** Hold InboundMessagesProcessed events instead of handling them. */
    public stubHoldInboundMessageEvents(): boolean {
        const eventHandler = this.service.sm.eventHandler;
        if (!this.service.stubOriginals.has("inboundMessageEvents")) {
            this.service.stubOriginals.set(
                "inboundMessageEvents",
                eventHandler.onInboundMessagesProcessed.bind(eventHandler)
            );
        }
        eventHandler.onInboundMessagesProcessed = (async (
            ...args: unknown[]
        ) => {
            this.service.heldInboundMessageArgs.push(args);
        }) as typeof eventHandler.onInboundMessagesProcessed;
        return true;
    }

    /** Restore the handler; optionally replay the held events through it. */
    public restoreInboundMessageEvents(replay: boolean): boolean {
        const eventHandler = this.service.sm.eventHandler;
        const original = this.service.stubOriginals.get("inboundMessageEvents");
        if (original === undefined) return false;
        const restored =
            original as typeof eventHandler.onInboundMessagesProcessed;
        eventHandler.onInboundMessagesProcessed = restored;
        this.service.stubOriginals.delete("inboundMessageEvents");
        const held = this.service.heldInboundMessageArgs.splice(0);
        if (replay) {
            for (const args of held) {
                void (restored as (...a: unknown[]) => Promise<void>)(...args);
            }
        }
        return true;
    }

    public getHeldInboundMessageCount(): number {
        return this.service.heldInboundMessageArgs.length;
    }

    /**
     * Drop selected subscribed logs before the scheduler records their key.
     * Unlike `stubHoldInboundMessageEvents`, which replaces the handler, this
     * only loses the delivery - an explicit query of the same log still reaches
     * the real scheduler, so recovery can heal it. `dropCount` caps how many
     * distinct keys are lost (default: all).
     */
    public stubDropEventLogs(
        eventNames: (
            | "InboundMessagesProcessed"
            | "ChainSlashed"
            | "DisputeKilled"
        )[],
        dropCount?: number
    ): boolean {
        if (
            !Array.isArray(eventNames) ||
            eventNames.some(
                (name) =>
                    ![
                        "InboundMessagesProcessed",
                        "ChainSlashed",
                        "DisputeKilled"
                    ].includes(name)
            )
        )
            throw new Error("Invalid event log drop selection");
        const eventSyncService = this.service.sm.eventSyncService;
        // an omitted arg crosses the port as null -> normalize to "no limit"
        this.service.eventLogDropLimit = dropCount ?? undefined;
        if (!this.service.stubOriginals.has("eventLogs")) {
            this.service.stubOriginals.set(
                "eventLogs",
                eventSyncService.scheduleLog.bind(eventSyncService)
            );
        }
        const original = this.service.stubOriginals.get(
            "eventLogs"
        ) as typeof eventSyncService.scheduleLog;
        eventSyncService.scheduleLog = async (...args) => {
            const parsed =
                this.service.sm.stateChannelManagerContract.interface.parseLog({
                    topics: args[0].topics,
                    data: args[0].data
                });
            if (parsed && eventNames.some((name) => name === parsed.name)) {
                const eventKey = `${args[0].transactionHash}:${args[0].index}`;
                const limit = this.service.eventLogDropLimit;
                const dropped = this.service.droppedEventLogKeys;
                if (
                    !dropped.has(eventKey) &&
                    (limit === undefined || dropped.size < limit)
                ) {
                    dropped.add(eventKey);
                    return;
                }
            }
            return original(...args);
        };
        return true;
    }

    /** Restore scheduling. Dropped subscription payloads are recovered by query. */
    public restoreEventLogs(): boolean {
        const eventSyncService = this.service.sm.eventSyncService;
        const original = this.service.stubOriginals.get("eventLogs");
        if (original === undefined) return false;
        eventSyncService.scheduleLog =
            original as typeof eventSyncService.scheduleLog;
        this.service.stubOriginals.delete("eventLogs");
        this.service.droppedEventLogKeys.clear();
        this.service.eventLogDropLimit = undefined;
        return true;
    }

    public getDroppedEventLogCount(): number {
        return this.service.droppedEventLogKeys.size;
    }

    public stubFailOnChainSlashesRead(): boolean {
        this.service.failOnChainSlashesRead();
        return true;
    }

    public restoreOnChainSlashesRead(): boolean {
        return this.service.restoreOnChainSlashesRead();
    }

    /** Make every provider getLogs throw, so no recovery query can succeed. */
    public stubFailChainLogQueries(): boolean {
        this.service.failChainLogQueries();
        return true;
    }

    /** Record every provider getLogs span and forward it. */
    public stubCountChainLogQueries(): boolean {
        this.service.countChainLogQueries();
        return true;
    }

    public getChainLogQueryCount(): number {
        return this.service.chainLogQueries.length;
    }

    public restoreChainLogQueries(): boolean {
        return this.service.restoreChainLogQueries();
    }

    /** Make onDisputeCommitted throw for every dispatched dispute log. */
    public stubFailDisputeCommittedHandler(): boolean {
        this.service.failDisputeCommittedHandler();
        return true;
    }

    public restoreDisputeCommittedHandler(): boolean {
        return this.service.restoreDisputeCommittedHandler();
    }

    public getFailedDisputeCommittedHandlerCallCount(): number {
        return this.service.failedDisputeCommittedHandlerCalls;
    }

    /** Make the dispute-window creation timestamp read throw. */
    public stubFailDisputeWindowTimestampRead(): boolean {
        this.service.failDisputeWindowTimestampRead();
        return true;
    }

    public restoreDisputeWindowTimestampRead(): boolean {
        return this.service.restoreDisputeWindowTimestampRead();
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

    /** Hold subscribed calldata logs before the scheduler records their key. */
    public stubHoldCalldataPostedEvents(): boolean {
        this.service.holdCalldataPostedEvents();
        return true;
    }

    public restoreCalldataPostedEvents(): boolean {
        return this.service.restoreCalldataPostedEvents();
    }

    /** Resolves once a subscribed calldata log has been held. */
    public waitForHeldCalldataPostedEvent(): Promise<boolean> {
        return this.service.waitForHeldCalldataPostedEvent();
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
        // Built from the error's own ABI fragment, so an error that takes
        // arguments still yields revert data the client can decode. A
        // hand-hashed `Name()` selector decodes to nothing once the error
        // gains a parameter.
        const encodedRevert = encodedCustomErrorRevert(errorName);
        runner.call = async (transaction) => {
            if (!String(transaction.data).startsWith(multicallSelector)) {
                return await original(transaction);
            }
            runner.call = original;
            this.service.stubOriginals.delete("reductionSimulation");
            throw { data: encodedRevert };
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

    /** Count spectate sync requests and record their selected peer. */
    public stubRecordSpectateSync(forward: boolean): boolean {
        const spectate = this.p2pManager.localRpc.spectateService;
        if (!this.service.stubOriginals.has("spectateSync")) {
            this.service.stubOriginals.set(
                "spectateSync",
                spectate.sync.bind(spectate)
            );
        }
        this.service.spectateSyncCallCount = 0;
        this.service.spectateSyncTargets.length = 0;
        const original = this.service.stubOriginals.get(
            "spectateSync"
        ) as typeof spectate.sync;
        spectate.sync = ((...args: Parameters<typeof spectate.sync>) => {
            this.service.recordSpectateSyncCall(String(args[0]));
            if (forward) return original(...args);
            return Promise.resolve(true);
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

    /** Resolves with the sync targets once `count` sync calls have been made. */
    public waitForSpectateSyncCalls(count: number): Promise<string[]> {
        return this.service.waitForSpectateSyncCalls(count);
    }

    /** Run isDisputedFork, counting local-diamond queries. */
    public async probeIsDisputedFork(
        forkId: ForkId,
        markLocallyDisputed: boolean
    ): Promise<IsDisputedForkProbe> {
        return this.service.probeIsDisputedFork(forkId, markLocallyDisputed);
    }

    /** Store a block directly into block storage (dispute-replay fixtures). */
    public storeBlockFixture(encodedBlockConfirmation: string): {
        hash: string;
    } {
        return this.service.storeBlockFixture(encodedBlockConfirmation);
    }

    /** Store a state snapshot directly into snapshot storage. */
    public storeStateSnapshotFixture(encodedSnapshot: string): {
        hash: string;
    } {
        return this.service.storeStateSnapshotFixture(encodedSnapshot);
    }

    /** Stage on-chain calldata for a block at a chosen timestamp. */
    public stageBlockCalldata(
        encodedSignedBlock: string,
        onChainTimestamp: Timestamp
    ): boolean {
        this.service.stageBlockCalldata(encodedSignedBlock, onChainTimestamp);
        return true;
    }

    /** Post a block's calldata on-chain (chain-fallback path). */
    public async postBlockCalldataOnChain(
        encodedSignedBlock: string
    ): Promise<{ blockNumber: number; onChainTimestamp: Timestamp }> {
        return this.service.postBlockCalldataOnChain(encodedSignedBlock);
    }

    public async runBlockValidation(
        encodedBlockConfirmation: string,
        options?: BlockValidationProbeOptions
    ): Promise<BlockValidationProbe> {
        return this.service.runBlockValidation(
            encodedBlockConfirmation,
            options
        );
    }

    public async runBlockIngest(
        encodedBlockConfirmation: string,
        options?: BlockProbeOptions
    ): Promise<BlockIngestProbe> {
        return this.service.runBlockIngest(encodedBlockConfirmation, options);
    }

    public async runStoredBlockMerge(
        encodedBlockConfirmation: string,
        options?: {
            strategy?: "active" | "dispute" | "spectating" | "calldata";
        }
    ): Promise<{
        result: number | null;
        persistedSignatures: string[] | null;
    }> {
        return this.service.runStoredBlockMerge(
            encodedBlockConfirmation,
            options
        );
    }

    /** Staging: force this peer's session status (fault injection). */
    public setPeerStatus(status: Status): boolean {
        this.service.sm.setStatus(status);
        return true;
    }

    public holdLobbyReply(kind: HeldLobbyReplyKind): boolean {
        this.service.holdLobbyReply(kind);
        return true;
    }

    public releaseLobbyReply(): number {
        return this.service.releaseLobbyReply();
    }

    public getHeldLobbyReplyCount(): number {
        return this.service.getHeldLobbyReplyCount();
    }

    public holdNegotiationReply(kind: HeldNegotiationReplyKind): boolean {
        this.service.holdNegotiationReply(kind);
        return true;
    }

    public releaseNegotiationReply(): number {
        return this.service.releaseNegotiationReply();
    }

    public getHeldNegotiationReplyCount(): number {
        return this.service.getHeldNegotiationReplyCount();
    }

    public holdMatchedNegotiation(fail = false): boolean {
        this.service.holdMatchedNegotiation(fail);
        return true;
    }

    public releaseMatchedNegotiation(): number {
        return this.service.releaseMatchedNegotiation();
    }

    public getHeldMatchedNegotiationCount(): number {
        return this.service.getHeldMatchedNegotiationCount();
    }

    public failNextMatchedNegotiation(): boolean {
        this.service.failNextMatchedNegotiation();
        return true;
    }

    public holdSpectateResponses(fail = false): boolean {
        this.service.holdSpectateResponses(fail);
        return true;
    }

    public releaseSpectateResponses(): number {
        return this.service.releaseSpectateResponses();
    }

    public getHeldSpectateResponseCount(): number {
        return this.service.getHeldSpectateResponseCount();
    }

    public holdPostMatchTargetRefresh(): boolean {
        this.service.holdPostMatchTargetRefresh();
        return true;
    }

    public releasePostMatchTargetRefresh(): number {
        return this.service.releasePostMatchTargetRefresh();
    }

    public getHeldPostMatchTargetRefreshCount(): number {
        return this.service.getHeldPostMatchTargetRefreshCount();
    }

    public holdMembershipReceipt(
        kind: HeldMembershipReceiptKind,
        fail = false
    ): boolean {
        this.service.holdMembershipReceipt(kind, fail);
        return true;
    }

    public holdMembershipSubmission(kind: HeldMembershipReceiptKind): boolean {
        this.service.holdMembershipSubmission(kind);
        return true;
    }

    public countInitHandshakeCalls(): boolean {
        this.service.countInitHandshakeCalls();
        return true;
    }

    public getInitHandshakeCallCount(): number {
        return this.service.getInitHandshakeCallCount();
    }

    public failMembershipReceipt(kind: HeldMembershipReceiptKind): boolean {
        this.service.failMembershipReceipt(kind);
        return true;
    }

    public failMembershipSubmissionUncertain(
        kind: HeldMembershipReceiptKind
    ): boolean {
        this.service.failMembershipSubmissionUncertain(kind);
        return true;
    }

    public releaseMembershipReceipt(): number {
        return this.service.releaseMembershipReceipt();
    }

    public getHeldMembershipReceiptCount(): number {
        return this.service.getHeldMembershipReceiptCount();
    }

    public holdSetChannelId(): boolean {
        this.service.holdSetChannelId();
        return true;
    }

    public releaseSetChannelId(): number {
        return this.service.releaseSetChannelId();
    }

    public getHeldSetChannelIdCount(): number {
        return this.service.getHeldSetChannelIdCount();
    }

    public overrideLobbyRoleDuration(durationMs: number): boolean {
        this.service.overrideLobbyRoleDuration(durationMs);
        return true;
    }

    public restoreLobbyRoleDuration(): boolean {
        return this.service.restoreLobbyRoleDuration();
    }
}

export default StubRpcMethods;
