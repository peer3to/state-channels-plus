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
    private readonly unsubscribeHandshakeCompleted: () => void;
    private initialSyncStarted = false;
    private initialSyncPromise?: Promise<boolean>;
    private resolveInitialSync?: (success: boolean) => void;

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

        this.unsubscribeHandshakeCompleted = this.stateManager.events.on(
            "p2pEventHooks",
            "handshakeCompleted",
            (peerAddress) => {
                void this.onHandshakeCompleted(peerAddress);
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
        this.resolveInitialSync?.(false);
        this.disconnectAll();
        this.disposalPromise = this.holepunch.dispose();
        return this.disposalPromise;
    }

    public get isDisposed(): boolean {
        return this.disposalPromise !== undefined;
    }

    private async onHandshakeCompleted(peerAddress: Address): Promise<void> {
        const stateManager = this.stateManager;
        if (stateManager.isDisposed) return;

        const transport =
            this.profileManager.getTransportByEvmAddress(peerAddress);
        if (!transport || transport.isClosed) return;

        const status = stateManager.status;
        const isChannelOpened = status === Status.OPENED;
        if (this.localRpc.lobbyMatchingService.rendezvousTopic) {
            // Lobby transports stay outside the ordinary connection set until
            // matching commits one peer. The lobby service owns their complete
            // lifecycle and promotes only the selected profile.
            const profile =
                this.profileManager.getProfileByEvmAddress(peerAddress);
            for (const lobbyTransport of profile?.getLiveTransports() ?? [
                transport
            ]) {
                if (
                    this.localRpc.lobbyMatchingService.isHandedOffTransport(
                        lobbyTransport
                    )
                ) {
                    continue;
                }
                this.localRpc.lobbyMatchingService.onAuthenticatedTransport(
                    lobbyTransport
                );
            }
            return;
        }

        this.addConnection(transport);

        if (isChannelOpened) {
            try {
                const isPeerParticipant =
                    await stateManager.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                        stateManager.channelId,
                        peerAddress
                    );
                if (stateManager.isDisposed || transport.isClosed) return;
                if (isPeerParticipant) {
                    await this.syncConnectedParticipant(peerAddress);
                } else {
                    this.logger.debug(
                        `Skipping sync after handshake with peer ${peerAddress} - not a participant`
                    );
                }
            } catch (error) {
                if (stateManager.isDisposed || transport.isClosed) return;
                this.logger.debug(
                    "Skipping sync after handshake because the participant read failed",
                    {
                        peerAddress,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    }
                );
            }
        }

        stateManager.p2pEventHooks.onConnection?.(peerAddress, isChannelOpened);
    }

    private async syncConnectedParticipant(
        peerAddress: Address
    ): Promise<void> {
        if (this.initialSyncStarted) return;
        this.initialSyncStarted = true;
        const stateManager = this.stateManager;
        const success = await this.localRpc.spectateService.sync(
            peerAddress,
            stateManager.channelId,
            undefined,
            undefined,
            stateManager.timeConfig.agreementTime * 2 * 1000
        );
        if (
            !success &&
            !stateManager.isDisposed &&
            stateManager.status !== Status.PENDING_PARTICIPANT &&
            stateManager.status !== Status.PARTICIPATING
        ) {
            stateManager.abort();
        }
        this.resolveInitialSync?.(success);
    }

    /** Promotes the committed lobby profile into the normal connection set. */
    public promoteLobbyConnections(
        transports: Iterable<ATransport>,
        peerAddress: Address
    ): void {
        let promoted = false;
        for (const transport of transports) {
            if (transport.isClosed) continue;
            this.addConnection(transport);
            promoted = true;
        }
        if (promoted) {
            this.stateManager.p2pEventHooks.onConnection?.(peerAddress, false);
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
        if (!ATransport.isSamePeer(transport, pending.transport)) {
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
                this.logger.warn("Oversized RPC frame; rejecting peer", {
                    bytes: frameBytes,
                    transportType: TransportType[transport.transportType],
                    peerAddress: transport.peerAddress
                });
                this.disconnectAndBlacklistPeer(transport);
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
                this.disconnectAndBlacklistPeer(transport);
                return;
            }
            if (!hasRpcService(this.localRpc, rpc.service)) {
                this.disconnectAndBlacklistPeer(transport);
                return;
            }
            const service = this.localRpc[
                rpc.service
            ] as unknown as ARpcService<any>;
            const success = service.runRPC(rpc, transport);
            if (!success) {
                this.disconnectAndBlacklistPeer(transport);
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
    public async joinDiscoveryKey(discoveryKey: string): Promise<void> {
        if (!ethers.isHexString(discoveryKey, 32)) {
            throw new Error("Discovery key must be exactly 32 bytes");
        }
        const normalizedKey = ethers.hexlify(discoveryKey);
        const waitForInitialSync = this.stateManager.status === Status.OPENED;
        const initialSync = waitForInitialSync
            ? this.getInitialSyncPromise()
            : undefined;
        // TODO: Give Holepunch and LocalDiscoveryServer the same lifecycle API
        // and inject the selected backend so P2PManager does not know which
        // discovery implementation it is using.
        if (config.DEBUG_LOCAL_TRANSPORT) {
            if (isNodeRuntime() || config.LOCAL_DISCOVERY_REGISTRY_URL) {
                await LocalDiscoveryServer.tryStart();
                await LocalDiscoveryServer.connectToPeers(
                    this.self,
                    normalizedKey,
                    this.stateManager.signerAddress.toString()
                );
            }
        } else {
            const topic = Buffer.from(normalizedKey.slice(2), "hex");
            await this.holepunch.join(topic);
        }

        if (!initialSync) return;
        for (const transport of [...this.openConnections]) {
            if (transport.peerAddress && !transport.isClosed) {
                void this.onHandshakeCompleted(transport.peerAddress);
            }
        }
        await initialSync;
    }

    private getInitialSyncPromise(): Promise<boolean> {
        if (!this.initialSyncPromise) {
            this.initialSyncPromise = new Promise<boolean>((resolve) => {
                this.resolveInitialSync = resolve;
            });
        }
        return this.initialSyncPromise;
    }

    public async leaveDiscoveryKey(discoveryKey: string): Promise<void> {
        if (!ethers.isHexString(discoveryKey, 32)) {
            throw new Error("Discovery key must be exactly 32 bytes");
        }
        const normalizedKey = ethers.hexlify(discoveryKey);
        if (config.DEBUG_LOCAL_TRANSPORT) {
            await LocalDiscoveryServer.leave(normalizedKey, this.self);
            return;
        }
        const topic = Buffer.from(normalizedKey.slice(2), "hex");
        await this.holepunch.leave(topic);
    }
    public addConnection(transport: ATransport) {
        // Do not revive a transport that closed while handshake work was pending.
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

    public disconnectAndBlacklistPeer(transport: ATransport) {
        const transportToDisconnect = transport.peerAddress
            ? this.profileManager.blacklistPeer(transport.peerAddress)
            : this.profileManager.blacklistPeer(transport);
        if (transportToDisconnect && transportToDisconnect !== transport) {
            this.disconnectConnection(transportToDisconnect);
        }
        this.disconnectConnection(transport);
    }

    public disconnectAndBlacklistPeerByEvmAddress(evmAddress: Address) {
        const transport = this.profileManager.blacklistPeer(evmAddress);
        if (transport) this.disconnectConnection(transport);
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
        this.collectPeerAddresses(this.openConnections, addresses);
        return addresses;
    }

    /**
     * Resolves each transport's peer address (transport first, falling back to
     * its `ProfileManager` profile) into `addresses`. One owner so the
     * promoted-only and handshake-completed views can never disagree on how an
     * address is resolved or normalized.
     */
    private collectPeerAddresses(
        transports: Iterable<ATransport>,
        addresses: Set<Address>
    ): void {
        for (const transport of transports) {
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
    }
}

export default P2PManager;
