import IOnMessage from "@/IOnMessage";
import type StateManager from "@/stateManager";
import { deserializeRpc } from "@/rpc/Rpc";
import MainRpcService from "@/rpc/MainRpcService";
import { P2pSigner } from "@/evm";
import { ATransport, TransportType } from "@/transport";
import ProfileManager from "@/ProfileManager";
import Holepunch from "@/Holepunch";
import { ethers } from "ethers";
import { DebugProxy, LocalDiscoveryServer } from "@/utils";
import type { Logger } from "@/utils/PeerLogger";
import { Buffer } from "buffer";
import { config } from "@/utils/config";
import { Address } from "./types/types";
import { isInstanceOfRpcService } from "./utils/ObjectChecks";
import type ARpcService from "@/rpc/ARpcService";
import RemoteRpcProxy, { RemoteRpcProxyType } from "./rpc/RemoteRpcProxy";
import type { RpcServiceFactoryMap, RpcServiceInstances } from "./rpc/registry";

type LocalRpcRoot<TFactories extends RpcServiceFactoryMap> = MainRpcService &
    RpcServiceInstances<TFactories>;

type RemoteRpcRoot<TFactories extends RpcServiceFactoryMap> =
    RemoteRpcProxyType<MainRpcService> &
        RemoteRpcProxyType<RpcServiceInstances<TFactories>>;

class P2PManager<TFactories extends RpcServiceFactoryMap = {}>
    implements IOnMessage
{
    stateManager: StateManager;
    logger: Logger;
    p2pSigner: P2pSigner<TFactories>;
    profileManager = new ProfileManager();
    localRpc: LocalRpcRoot<TFactories>;
    remoteRpc: RemoteRpcRoot<TFactories>;
    //TODO - map EVM address to websocket
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = config.DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;

    constructor(
        stateManager: StateManager,
        signer: ethers.Signer,
        rpcServiceFactories?: TFactories
    ) {
        this.stateManager = stateManager;
        this.logger = stateManager.logger.child({ component: "P2PManager" });
        this.p2pSigner = new P2pSigner(
            signer,
            stateManager.signerAddress,
            this.self
        );

        const builtInRoot = new MainRpcService(this.self);
        const customServices: Partial<RpcServiceInstances<TFactories>> = {};

        if (rpcServiceFactories) {
            for (const [serviceName, factory] of Object.entries(
                rpcServiceFactories
            )) {
                if (typeof factory !== "function") continue;
                (customServices as any)[serviceName] = (factory as any)(
                    this.self
                );
            }
        }

        this.localRpc = Object.assign(
            builtInRoot,
            customServices
        ) as LocalRpcRoot<TFactories>;

        this.remoteRpc = RemoteRpcProxy.createProxy(
            this.localRpc
        ) as unknown as RemoteRpcRoot<TFactories>;
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
        const debugConnections = this.openConnections.map((transport) => {
            return {
                transportType: transport.transportType,
                peerAddress: transport.peerAddress
            };
        });
        this.logger.debug("broadcastRpc", { serializedRPC, debugConnections });
        for (const transport of this.openConnections) {
            transport.send(serializedRPC);
        }
    }
    public onRpc(serializedRpc: string, transport: ATransport) {
        try {
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
        if (config.DEBUG_LOCAL_TRANSPORT) {
            await LocalDiscoveryServer.tryStart();
            await LocalDiscoveryServer.connectToPeers(
                this.self,
                channelId,
                this.stateManager.signerAddress.toString()
            );
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

        try {
            const disconnectedPeer =
                transport.peerAddress || profile?.getEvmAddress() || "unknown";
            const stack = new Error("Disconnecting connection").stack;
            this.logger.warn("disconnectConnection", {
                disconnectedPeer,
                transportType: transport.transportType,
                stack
            });
        } catch {
            // ignore logging errors
        }

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

    /**
     * Returns a snapshot of currently connected peer identities (EVM addresses).
     */
    public getConnectedPeers(): Set<string> {
        const addresses = new Set<string>();
        for (const transport of this.openConnections) {
            const fromTransport = transport.peerAddress;
            if (fromTransport) {
                addresses.add(
                    this.profileManager.normalizeEvmAddress(fromTransport)
                );
                continue;
            }

            const profile =
                this.profileManager.getProfileByTransport(transport);
            const fromProfile = profile?.getEvmAddress();
            if (fromProfile) {
                addresses.add(
                    this.profileManager.normalizeEvmAddress(fromProfile)
                );
            }
        }
        return addresses;
    }
}

export default P2PManager;
