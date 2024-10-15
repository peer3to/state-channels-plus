import { AddressLike, ethers } from "ethers";
import BroadcastLocal from "./utils/BroadcastLocal";
import IOnMessage from "./IOnMessage";
import StateManager from "./StateManager";
import { deserializeRpc } from "./rpc/Rpc";
import MainRpcService from "./rpc/MainRpcService";
import P2pSigner from "./evm/P2pSigner";
import ATransport from "./transport/ATransport";
import ProfileManager from "./ProfileManager";
import Clock from "./Clock";
import Holepunch from "./Holepunch";
import PeerProfile from "./PeerProfile";
// import dotenv from "dotenv";
import DebugProxy from "./utils/DebugProxy";
import { RpcHandleMethods } from "./rpc/RpcProxy";
import LocalDiscoveryServer from "./utils/LocalDiscoveryServer";

let DEBUG_P2P_MANAGER = false;
let DEBUG_LOCAL_TRANSPORT = false;
// dotenv.config();
// DEBUG_P2P_MANAGER = process.env.DEBUG_P2P_MANAGER === "true";
// DEBUG_LOCAL_TRANSPORT= process.env.DEBUG_LOCAL_TRANSPORT === "true";

class P2PManager implements IOnMessage {
    stateManager: StateManager;
    p2pSigner: P2pSigner;
    profileManager = new ProfileManager();
    localRpcService: MainRpcService;
    rpcProxy: RpcHandleMethods<MainRpcService>;
    //TODO - map EVM address to websocket
    openConnections: ATransport[] = [];
    holepunch: Holepunch;
    self = DEBUG_P2P_MANAGER ? DebugProxy.createProxy(this) : this;

    constructor(stateManager: StateManager, signer: ethers.Signer) {
        this.stateManager = stateManager;
        this.p2pSigner = new P2pSigner(
            signer,
            stateManager.signerAddress,
            this.self
        );
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
        let peerProfile = new PeerProfile(transport);
        this.profileManager.registerProfile(peerProfile);
        this.openConnections.push(transport);
        this.initHandshake(transport);
    }
    public removeConnection(transport: ATransport) {
        this.openConnections = this.openConnections.filter(
            (t) => t !== transport
        );
        let profile = this.profileManager.getProfileByTransport(transport);
        profile && this.profileManager.unregisterProfile(profile);
        transport.close();
    }
    public disconnectAll() {
        for (let transport of this.openConnections) {
            this.removeConnection(transport);
        }
    }
    private initHandshake(transport: ATransport) {
        console.log("initHandshake !");
        let randomChallengeHash = ethers.keccak256(ethers.randomBytes(32));
        let time = Clock.getTimeInSeconds();
        let profile = this.profileManager.getProfileByTransport(transport);
        profile?.setChallenge({ randomChallengeHash, initTime: time });
        this.rpcProxy
            .onInitHandshakeRequest(randomChallengeHash, time)
            .sendOne(transport);
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
