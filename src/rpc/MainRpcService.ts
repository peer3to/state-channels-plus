import { SignedJoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import P2PManager from "@/P2PManager";
import { DebugProxy } from "@/utils";

import { DEBUG_RPC } from "@/utils/config";
import { Signature } from "@/types/types";
import {
    DHTDiscoveryService,
    InitHandshakeService,
    StateTransitionService,
    WebRTCSetupService,
    SpectateService,
    IsForkDisputedService,
    JoinChannelService,
    TESTJoinChannelService
} from "./services";

//TODO! refactor this
type JoinChannelConfirmation = {
    signedJoinChannel: SignedJoinChannelStruct;
    confirmationSignatures: Signature[];
};

class MainRpcService {
    p2pManager: P2PManager;
    // rpcProxy = RpcProxy.createProxy(this);

    self = DEBUG_RPC ? DebugProxy.createProxy(this) : this;

    //RPC Services
    initHandshakeService: InitHandshakeService;
    webRTCSetupService: WebRTCSetupService;
    stateTransitionService: StateTransitionService;
    testJoinChannelService: TESTJoinChannelService;
    dhtDiscoveryService: DHTDiscoveryService;
    joinChannelService: JoinChannelService;
    spectateService: SpectateService;
    isForkDisputedService: IsForkDisputedService;

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        this.initHandshakeService = new InitHandshakeService(this.p2pManager);
        this.webRTCSetupService = new WebRTCSetupService(this.p2pManager);
        this.dhtDiscoveryService = new DHTDiscoveryService(this.p2pManager);
        this.stateTransitionService = new StateTransitionService(
            this.p2pManager
        );
        this.spectateService = new SpectateService(this.p2pManager);
        this.isForkDisputedService = new IsForkDisputedService(this.p2pManager);
        this.joinChannelService = new JoinChannelService(this.p2pManager);
        this.testJoinChannelService = new TESTJoinChannelService(
            this.p2pManager
        );
        return this.self;
    }
}
export default MainRpcService;
