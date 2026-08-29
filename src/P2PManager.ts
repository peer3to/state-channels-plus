import IOnMessage from "@/IOnMessage";
import type StateManager from "@/stateManager";
import Rpc from "@/rpc/Rpc";
import ARpcRouter from "@/rpc/ARpcRouter";
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
import type { CustomRpcConstructor } from "./rpc/registry";
import { LoggerUtils } from "@/utils/LoggerUtils";

/** the peers' router: one for the realm, one transport per connected peer */
class P2PManager<TCustomRpc extends MainRpcService = MainRpcService>
    extends ARpcRouter<TCustomRpc>
    implements IOnMessage
{
    stateManager: StateManager<TCustomRpc>;
    readonly logger: Logger;
    p2pSigner: P2pSigner<TCustomRpc>;
    profileManager = new ProfileManager();
    /** In-process transport used for "send to self" (no-target) delivery. */
    loopbackTransport: LoopbackTransport;
    // TODO - route WebRTCSetupService and LocalDiscoveryServer scans through ProfileManager
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = config.DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;
    private disposalPromise?: Promise<void>;

    constructor(
        stateManager: StateManager<TCustomRpc>,
        signer: ethers.Signer,
        customRpc?: CustomRpcConstructor<TCustomRpc, any>,
        customRpcOptions?: any
    ) {
        super();
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
            this.attachRoot(
                new customRpc(this.self, customRpcOptions) as TCustomRpc
            );
        } else {
            if (customRpcOptions !== undefined) {
                throw new Error(
                    "customRpcOptions requires customRpc to be configured"
                );
            }
            this.attachRoot(new MainRpcService(this.self) as TCustomRpc);
        }
        this.loopbackTransport = new LoopbackTransport(this.self);
        this.holepunch = new Holepunch(this.self);
        return this.self;
    }
    //Mark resources for garbage collection
    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }

        this.disconnectAll();
        this.disposalPromise = this.holepunch.dispose();
        return this.disposalPromise;
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

    // ----- ARpcRouter hooks: peer policy -----

    protected scheduleTimeout(
        fn: () => void,
        ms: number,
        label: string
    ): unknown {
        return this.stateManager.timeoutManager.scheduleTask(fn, ms, label);
    }

    protected cancelTimeout(handle: unknown): void {
        this.stateManager.timeoutManager.cancelTask(
            handle as Parameters<
                StateManager["timeoutManager"]["cancelTask"]
            >[0]
        );
    }

    // `agreementTime` is in seconds; the RPC timeout is in milliseconds.
    protected defaultRequestTimeoutMs(): number {
        return this.stateManager.timeConfig.agreementTime * 1000;
    }

    // Only the peer we sent the request to may settle it. Compare by peer
    // identity (not transport object) so a transport upgrade for the same
    // peer (e.g. HOLEPUNCH -> WEBRTC) still settles the pending request.
    protected isResponseFromRequestee(
        expected: ATransport,
        actual: ATransport
    ): boolean {
        return ATransport.isSamePeer(expected, actual);
    }

    protected onForeignResponse(transport: ATransport): void {
        this.disconnectAndBlacklistPeer(transport);
    }

    public resolveTransport(address: Address): ATransport | undefined {
        return (
            this.profileManager.getTransportByEvmAddress(address) ?? undefined
        );
    }

    public onTransportClosed(transport: ATransport, isExpected: boolean): void {
        if (!isExpected) {
            this.stateManager.p2pEventHooks?.onDisconnection?.(
                transport.peerAddress as Address
            );
        }
        this.disconnectConnection(transport);
    }

    /** a peer whose frame or handler failed is disconnected */
    public onServiceFailure(transport: ATransport, _error: unknown): void {
        this.disconnectConnection(transport);
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
}

export default P2PManager;
