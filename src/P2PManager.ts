import IOnMessage from "@/IOnMessage";
import type StateManager from "@/stateManager";
import Rpc, { deserializeRpc } from "@/rpc/Rpc";
import MainRpcService from "@/rpc/MainRpcService";
import { P2pSigner } from "@/evm";
import { ATransport, TransportType } from "@/transport";
import ProfileManager from "@/ProfileManager";
import Holepunch from "@/Holepunch";
import { ethers } from "ethers";
import { DebugProxy, getChecksumAddress, LocalDiscoveryServer } from "@/utils";
import type { Logger } from "@/utils";
import { Buffer } from "buffer";
import { config } from "@/utils/config";
import { Address, ChannelId } from "./types/types";
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
    //TODO - map EVM address to websocket
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = config.DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;

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
        this.holepunch = new Holepunch(this.self);
        return this.self;
    }
    //Mark resources for garbage collection
    public async dispose() {
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
    public onRpc(serializedRpc: string, transport: ATransport) {
        try {
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
            console.error(e);
        }
    }
    public async tryOpenConnectionToChannel(channelId: ChannelId) {
        if (config.DEBUG_LOCAL_TRANSPORT) {
            return;
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
