import type P2PManager from "@/P2PManager";
import { DebugProxy } from "@/utils";

import { config } from "@/utils/config";
import {
    InitHandshakeService,
    StateTransitionService,
    WebRTCSetupService,
    SpectateService,
    IsForkDisputedService
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

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        this.initHandshakeService = new InitHandshakeService(this.p2pManager);
        this.webRTCSetupService = new WebRTCSetupService(this.p2pManager);
        this.stateTransitionService = new StateTransitionService(
            this.p2pManager
        );
        this.spectateService = new SpectateService(this.p2pManager);
        this.isForkDisputedService = new IsForkDisputedService(this.p2pManager);
        return this.self;
    }
}
export default MainRpcService;
