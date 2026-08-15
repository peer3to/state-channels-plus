import type P2PManager from "@/P2PManager";
import { DebugProxy } from "@/utils";

import { config } from "@/utils/config";
import {
    InitHandshakeService,
    StateTransitionService,
    WebRTCSetupService,
    SpectateService,
    IsForkDisputedService,
    JoinChannelService
} from "./services";

class MainRpcService {
    p2pManager: P2PManager;
    // rpcProxy = RpcProxy.createProxy(this);

    self = config.DEBUG_RPC ? DebugProxy.createProxy(this) : this;

    //RPC Services
    initHandshakeService: InitHandshakeService;
    webRTCSetupService: WebRTCSetupService;
    stateTransitionService: StateTransitionService;
    spectateService: SpectateService;
    isForkDisputedService: IsForkDisputedService;
    joinChannelService: JoinChannelService;

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        this.initHandshakeService = new InitHandshakeService(this.p2pManager);
        this.webRTCSetupService = new WebRTCSetupService(this.p2pManager);
        this.stateTransitionService = new StateTransitionService(
            this.p2pManager
        );
        this.spectateService = new SpectateService(this.p2pManager);
        this.isForkDisputedService = new IsForkDisputedService(this.p2pManager);
        this.joinChannelService = new JoinChannelService(this.p2pManager);
        return this.self;
    }

    /** Runtime-startup hook for custom RPC roots. The base is ready immediately. */
    ready(): Promise<void> | void {}

    /**
     * Runtime-shutdown hook for custom RPC roots. `StateManager.dispose()`
     * awaits it before tearing down the p2p manager, timeout manager, and EVM,
     * so a root can settle waits and drain async work. The base is a no-op.
     */
    dispose(): Promise<void> | void {}
}
export default MainRpcService;
