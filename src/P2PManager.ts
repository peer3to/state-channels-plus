import IOnMessage from "@/IOnMessage";
import StateManager from "@/stateManager";
import { deserializeRpc } from "@/rpc/Rpc";
import MainRpcService from "@/rpc/MainRpcService";
import { P2pSigner } from "@/evm";
import { ATransport, TransportType } from "@/transport";
import ProfileManager from "@/ProfileManager";
import Holepunch from "@/Holepunch";
import { ethers } from "ethers";
import { DebugProxy, LocalDiscoveryServer } from "@/utils";
import { RpcHandleMethods } from "@/rpc/RpcHandleProxy";
import { Buffer } from "buffer";
import { DEBUG_P2P_MANAGER, DEBUG_LOCAL_TRANSPORT } from "@/utils/config";
import { Address } from "./types/types";
import {
    outboundRateLimiter,
    inboundRateLimiterManager
} from "@/utils/RateLimiter";
import {
    hasMethod,
    hasProperty,
    isInstanceOfRpcService
} from "./utils/ObjectChecks";
import { ARpcService } from "./rpc";
import RemoteRpcProxy, { RemoteRpcProxyType } from "./rpc/RemoteRpcProxy";

class P2PManager implements IOnMessage {
    stateManager: StateManager;
    p2pSigner: P2pSigner;
    profileManager = new ProfileManager();
    localRpc: MainRpcService;
    remoteRpc: RemoteRpcProxyType<MainRpcService>;
    //TODO - map EVM address to websocket
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;

    constructor(stateManager: StateManager, signer: ethers.Signer) {
        this.stateManager = stateManager;
        this.p2pSigner = new P2pSigner(
            signer,
            stateManager.signerAddress,
            this.self
        );
        this.localRpc = new MainRpcService(this.self);
        this.remoteRpc = RemoteRpcProxy.createProxy(this.localRpc);
        this.holepunch = new Holepunch(this.self);
        return this.self;
    }
    //Mark resources for garbage collection
    public async dispose() {
        const remoteRpc = RemoteRpcProxy.createProxy(this.localRpc);
        await this.holepunch.dispose();
        this.disconnectAll();
    }
    public broadcastRpc(serializedRPC: string) {
        for (const transport of this.openConnections) {
            transport.send(serializedRPC);
        }
    }
    public onRpc(serializedRpc: string, transport: ATransport) {
        try {
            // Check inbound rate limiting first (per-connection)
            if (inboundRateLimiterManager) {
                const dataSizeBytes = Buffer.byteLength(serializedRpc, "utf8");

                // Check if message should be allowed
                if (
                    !inboundRateLimiterManager.checkInboundMessage(
                        transport,
                        dataSizeBytes
                    )
                ) {
                    console.warn(
                        `[INBOUND RATE LIMIT] Exceeded from connection - Size: ${dataSizeBytes} bytes, disconnecting peer`
                    );
                    this.disconnectAndBlacklistPeer(transport);
                    return;
                }
            }

            const rpc = deserializeRpc(serializedRpc);
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
            console.error(e);
        }
    }
    public async tryOpenConnectionToChannel(channelId: string) {
        if (DEBUG_LOCAL_TRANSPORT) {
            console.log("************ USING LOCAL TRANSPORT ************");
            LocalDiscoveryServer.tryStart();
            LocalDiscoveryServer.connectToPeers(this.self, channelId);
            return;
        }
        const topic = Buffer.alloc(32).fill(channelId);
        await this.holepunch.join(topic);
    }
    public addConnection(transport: ATransport) {
        this.openConnections.push(transport);
        this.localRpc.initHandshakeService.initHandshake(transport);
    }
    public disconnectConnection(transport: ATransport) {
        this.openConnections = this.openConnections.filter(
            (t) => t !== transport
        );
        const profile = this.profileManager.getProfileByTransport(transport);
        profile && this.profileManager.removeTransport(transport);
    }

    public disconnectAndBlacklistPeer(transport: ATransport) {
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
}

export default P2PManager;
