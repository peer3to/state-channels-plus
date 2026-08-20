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
import { Status } from "@/types";
import { Address } from "./types/types";
import { hasRpcService } from "./utils/ObjectChecks";
import type ARpcService from "@/rpc/ARpcService";
import RemoteRpcProxy, { RemoteRpcProxyType } from "./rpc/RemoteRpcProxy";
import type { CustomRpcConstructor } from "./rpc/registry";
import { LoggerUtils } from "@/utils/LoggerUtils";

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
    // TODO - route WebRTCSetupService and LocalDiscoveryServer scans through ProfileManager
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = config.DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;

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
    // Owns the "channel connection" promotion decision: unsubscribed on
    // dispose() so a disposed P2PManager never promotes a late handshake.
    private readonly unsubscribeHandshakeCompleted: () => void;
    // Re-evaluates deferred promotions (see `reevaluatePendingChannelMembership`)
    // whenever our own status changes; unsubscribed on dispose() alongside the
    // handshake hook.
    private readonly unsubscribeStatusChanged: () => void;
    // Handshaked transports whose peer could not (yet) be resolved as a
    // dispute participant at handshake time - never promoted speculatively.
    // Re-checked by `reevaluatePendingChannelMembership` on every status
    // change (e.g. the channel finally lands on-chain, or we ourselves become
    // a participant) and promoted once/if `canParticipateInDisputes` turns
    // true. Entries are dropped on transport close so this can't grow
    // unbounded.
    private readonly pendingChannelMembershipTransports = new Set<ATransport>();

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

        // Own the promotion decision for every handshake completed on this
        // P2PManager's transports. A transport can now originate from
        // joining THIS channel's topic (`tryOpenConnectionToChannel`) OR
        // from an opt-in `LobbyService` joining its own topic on this SAME
        // shared swarm (`LobbyService.joinLobby` -> `holepunch.join`) - a
        // verified peer here is NOT necessarily a channel peer. The
        // `canParticipateInDisputes` check below is what actually decides:
        // it promotes into `openConnections` only a real dispute
        // participant, so a lobby-only peer's handshake reaches this hook
        // but is deferred (never promoted) - see the method comment.
        this.unsubscribeHandshakeCompleted = this.stateManager.events.on(
            "p2pEventHooks",
            "handshakeCompleted",
            (peerAddress) => {
                void this.onHandshakeCompleted(peerAddress);
            }
        );
        this.unsubscribeStatusChanged = this.stateManager.events.on(
            "p2pEventHooks",
            "onStatusChanged",
            () => {
                void this.reevaluatePendingChannelMembership();
            }
        );
        return this.self;
    }
    //Mark resources for garbage collection
    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }

        this.unsubscribeHandshakeCompleted();
        this.unsubscribeStatusChanged();
        this.disconnectAll();
        this.disposalPromise = this.holepunch.dispose();
        return this.disposalPromise;
    }

    /**
     * Channel-connection promotion, run once a handshake finishes on this
     * P2PManager's transport. `ProfileManager` (updated by
     * `InitHandshakeService` before this hook fires) tracks identity and
     * transport mapping; `openConnections` is the broadcast/
     * `getConnectedPeers`/cleanup set - registering a profile must not by
     * itself grant channel traffic, so promotion happens only here. The hook
     * only carries the address (it crosses the runtime port, which
     * structured-clones every payload, so it can never carry a live
     * transport) - the live transport is resolved host-side, same realm,
     * via `ProfileManager`.
     *
     * Promotion is gated on being part of the channel conversation, not on a
     * successful handshake alone: a verified identity only earns targeted RPC
     * (via `ProfileManager`); `openConnections` is reserved for peers that
     * either are dispute participants, or that we are actively syncing from
     * because they are one (this same `canParticipateInDisputes` check also
     * gates the `spectateService.sync` call below, so "participant" and "peer
     * we sync from" collapse to one condition here). A peer that spectates
     * *us* is promoted separately, in `SpectateRpcMethods.onSpectateRequest`,
     * at the moment we actually accept that relationship (it may complete long
     * after this handshake hook runs).
     *
     * A handshake can (and in the harness routinely does) complete before
     * `canParticipateInDisputes` can resolve true for anyone - e.g. before the
     * `openChannel` transaction lands on-chain. That is NOT treated as
     * license to promote unconditionally (a peer we haven't yet identified as
     * a participant must never be granted broadcast rights just because we
     * can't yet prove otherwise - permanent promotion decided at a single
     * point in time is exactly how a lobby stranger met before we join a
     * channel would keep receiving our channel broadcasts forever after).
     * Instead such a peer is deferred into `pendingChannelMembershipTransports`
     * and re-checked by `reevaluatePendingChannelMembership` whenever our own
     * status changes (e.g. once the channel is actually on-chain) - promoted
     * then if and only if it now resolves as a participant.
     */
    private async onHandshakeCompleted(peerAddress: Address): Promise<void> {
        const stateManager = this.stateManager;
        if (stateManager.isDisposed) return;

        const transport =
            this.profileManager.getTransportByEvmAddress(peerAddress);
        if (!transport) return;

        const isChannelOpenedStatus =
            stateManager.getStatus() === Status.OPENED;
        let isPeerParticipant: boolean;
        try {
            isPeerParticipant =
                await stateManager.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                    stateManager.getChannelId(),
                    peerAddress
                );
        } catch (error) {
            if (stateManager.isDisposed) {
                this.logger.debug(
                    "Skipping finalized handshake after state manager disposal"
                );
                return;
            }
            throw error;
        }
        if (stateManager.isDisposed) return;

        // Only treat the transport as an "open connection" after handshake is
        // final, and only once it resolves as a dispute participant - see the
        // method comment for the deferred (never speculative) fallback.
        if (isPeerParticipant) {
            this.addConnection(transport);
        } else {
            this.pendingChannelMembershipTransports.add(transport);
        }

        if (isChannelOpenedStatus) {
            if (isPeerParticipant) {
                this.logger.debug(
                    `Initiating sync after handshake with peer ${peerAddress}`
                );
                this.localRpc.spectateService.sync(
                    peerAddress,
                    stateManager.getChannelId()
                );
            } else {
                this.logger.debug(
                    `Skipping sync after handshake with peer ${peerAddress} - not a participant`
                );
            }
        }

        stateManager.p2pEventHooks.onConnection?.(
            peerAddress,
            isChannelOpenedStatus
        );
    }

    /**
     * Re-checks every handshaked-but-not-yet-promoted transport whenever our
     * own status changes (subscribed in the constructor). A peer deferred in
     * `onHandshakeCompleted` because `canParticipateInDisputes` couldn't yet
     * resolve true (typically: the channel wasn't on-chain yet) gets promoted
     * here once it does - never before, so a peer that never becomes a
     * participant (a lobby stranger, a fellow spectator we never accepted)
     * stays deferred, and joining a channel later does not retroactively
     * grant it broadcast rights.
     */
    private async reevaluatePendingChannelMembership(): Promise<void> {
        const stateManager = this.stateManager;
        if (stateManager.isDisposed) return;
        if (this.pendingChannelMembershipTransports.size === 0) return;

        const channelId = stateManager.getChannelId();
        const localDiamondContract =
            stateManager.diamondStateMachine.localDiamondContract;

        // Snapshot: promotion/close during iteration must not corrupt the
        // live set this loop is walking.
        for (const transport of [...this.pendingChannelMembershipTransports]) {
            if (stateManager.isDisposed) return;
            const peerAddress = transport.peerAddress;
            if (!peerAddress) {
                this.pendingChannelMembershipTransports.delete(transport);
                continue;
            }

            let isPeerParticipant: boolean;
            try {
                isPeerParticipant =
                    await localDiamondContract.canParticipateInDisputes(
                        channelId,
                        peerAddress
                    );
            } catch (error) {
                if (stateManager.isDisposed) return;
                this.logger.debug(
                    "reevaluatePendingChannelMembership - participant check failed",
                    {
                        peerAddress,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    }
                );
                continue;
            }
            if (stateManager.isDisposed) return;

            if (isPeerParticipant) {
                this.pendingChannelMembershipTransports.delete(transport);
                this.addConnection(transport);
                // Mirror the `onConnection` signal `onHandshakeCompleted`
                // fires on an immediate promotion - a consumer (e.g. a test
                // harness's connectivity barrier) waiting on that hook must
                // learn about a deferred promotion too, not only discover it
                // via its own timeout fallback.
                stateManager.p2pEventHooks.onConnection?.(
                    peerAddress,
                    stateManager.getStatus() === Status.OPENED
                );
            }
        }
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
            const frameBytes = Buffer.byteLength(serializedRpc, "utf8");
            if (frameBytes > MAX_RPC_FRAME_BYTES) {
                this.logger.warn("Oversized RPC frame; disconnecting", {
                    bytes: frameBytes,
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
            if (!hasRpcService(this.localRpc, rpc.service)) {
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
        // TODO: Give Holepunch and LocalDiscoveryServer the same lifecycle API
        // and inject the selected backend so P2PManager does not know which
        // discovery implementation it is using.
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
        // A "connection" only exists after full handshake completion. Every
        // promotion decision (`onHandshakeCompleted`,
        // `reevaluatePendingChannelMembership`, an accepted spectate request)
        // resolves an async check first, so a disconnect/blacklist can land
        // on this same transport while that check is still in flight - never
        // resurrect a transport that already closed in the meantime.
        if (transport.isClosed) return;
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
        // A deferred (never-promoted) transport must not linger past its own
        // close - otherwise the pending set grows unbounded across repeated
        // handshakes from short-lived peers. (removeTransport is handled by
        // the profile branch below.)
        this.pendingChannelMembershipTransports.delete(transport);

        // Case 3 of the Holepunch ban policy: a closing WebRTC transport
        // releases the Holepunch fallback ban (ProfileManager decides based
        // on blacklist status; no-op for a non-WebRTC transport).
        this.profileManager.releaseHolepunchBanOnWebRtcClose(transport);

        try {
            if (profile) {
                this.profileManager.removeTransport(transport);
            } else {
                transport.close();
            }
        } catch {
            // ignore
        }
    }

    public disconnectAndBlacklistPeer(transport: ATransport, cause?: string) {
        const profile = this.profileManager.getProfileByTransport(transport);
        if (profile) this.profileManager.blacklistProfile(profile);

        this.disconnectConnection(transport);
    }

    public disconnectAndBlacklistPeerByEvmAddress(evmAddress: Address) {
        const profile = this.profileManager.getProfileByEvmAddress(evmAddress);
        if (!profile) return;
        this.profileManager.blacklistProfile(profile);
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
     * Every transport that finished the handshake on this P2PManager,
     * whether or not it was promoted into `openConnections`
     * (`getConnectedPeers()`). Read-only introspection - never touches the
     * promotion decision itself. Exists for a consumer that needs "is this
     * peer authenticated at all" rather than "is this peer a dispute
     * participant" (e.g. an opt-in service riding this same shared swarm,
     * like `LobbyService`, discovering a peer whose handshake completed
     * before it was ever asked to look).
     */
    public getHandshakeCompletedPeers(): Set<Address> {
        const addresses = this.getConnectedPeers();
        for (const transport of this.pendingChannelMembershipTransports) {
            const fromTransport = transport.peerAddress;
            if (fromTransport) {
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
}

export default P2PManager;
