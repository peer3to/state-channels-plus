import IOnMessage from "@/IOnMessage";
import { deserializeRpc } from "@/rpc/Rpc";
import MainRpcService from "@/rpc/MainRpcService";
import { P2pSigner } from "@/evm";
import { ATransport, TransportType } from "@/transport";
import ProfileManager from "@/ProfileManager";
import Holepunch from "@/Holepunch";
import { ethers } from "ethers";
import { DebugProxy, LocalDiscoveryServer } from "@/utils";
import { RpcHandleMethods } from "@/rpc/RpcProxy";
import { Buffer } from "buffer";
import { DEBUG_P2P_MANAGER, DEBUG_LOCAL_TRANSPORT } from "@/utils/config";
import { inject, ServiceNames } from "@/container";

class P2PManager implements IOnMessage {
    private get p2pSigner() {
        return inject(ServiceNames.P2P_SIGNER);
    }
    profileManager = new ProfileManager();
    localRpcService: MainRpcService;
    rpcProxy: RpcHandleMethods<MainRpcService>;
    //TODO - map EVM address to websocket
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;
    preferredTransport: TransportType = TransportType.HOLEPUNCH;

    constructor() {
        this.localRpcService = new MainRpcService(this.self);
        this.rpcProxy = this.localRpcService.rpcProxy;
        this.holepunch = new Holepunch(this.self);
        return this.self;
        // BroadcastLocal.register(this.p2pSigner.signerAddress, this);
    }
    //Mark resources for garbage collection
    public async dispose() {
        await this.holepunch.dispose();
        this.disconnectAll();
    }
    public broadcastRpc(serializedRPC: string) {
        // BroadcastLocal.broadcast(serializedRPC);
        for (let transport of this.openConnections) {
            transport.send(serializedRPC);
        }
    }
    public onRpc(serializedRpc: string) {
        try {
            let rpc = deserializeRpc(serializedRpc);
            if (!rpc) {
                //TODO!Disconnect
                return;
            }
            if (!hasMethod(this.localRpcService, rpc.method)) {
                //TODO!Disconnect
                return;
            }
            //TODO! set context - calling socket/profile (ATransport)!
            this.localRpcService[rpc.method](...rpc.params);
        } catch (e) {
            //TODO - disconnect from peer
            console.error(e);
        }
    }
    public async tryOpenConnectionToChannel(channelId: string) {
        if (DEBUG_LOCAL_TRANSPORT || process.env.DEBUG_LOCAL_TRANSPORT) {
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
        this.localRpcService.initHandshakeService.initHandshake(transport);
    }
    public removeConnection(transport: ATransport) {
        this.openConnections = this.openConnections.filter(
            (t) => t !== transport
        );
        let profile = this.profileManager.getProfileByTransport(transport);
        profile && this.profileManager.removeTransport(transport);
    }
    public disconnectAll() {
        for (let transport of this.openConnections) {
            this.removeConnection(transport);
        }
    }
}

/**
 * Type guard to check if an object has a certain property.
 */
function hasProperty<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, unknown> {
    return typeof obj === "object" && obj !== null && prop in obj;
}

/**
 * Type guard to check if an object has a certain method.
 */
function hasMethod<T, P extends string>(
    obj: T,
    prop: P
): obj is T & Record<P, (...params: any[]) => any> {
    return hasProperty(obj, prop) && typeof obj[prop] === "function";
}

export default P2PManager;
