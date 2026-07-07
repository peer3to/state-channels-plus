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
import { Address } from "./types/types";
import { isInstanceOfRpcService } from "./utils/ObjectChecks";
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
    //TODO - map EVM address to websocket
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
    public async dispose() {
        this.rejectAllPendingRpcRequests(
            new Error("P2PManager disposed before RPC response arrived")
        );
        await this.holepunch.dispose();
        this.disconnectAll();
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

    private rejectAllPendingRpcRequests(reason: Error): void {
        for (const [, pending] of this.pendingRpcRequests) {
            this.stateManager.timeoutManager.cancelTask(pending.timeout);
            pending.reject(reason);
        }
        this.pendingRpcRequests.clear();
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
}

export default P2PManager;
