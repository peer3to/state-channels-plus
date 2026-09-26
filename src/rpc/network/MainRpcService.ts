import {
    InitHandshakeService,
    StateTransitionService,
    WebRTCSetupService,
    SpectateService,
    IsForkDisputedService,
    JoinChannelService,
    LobbyMatchingService,
    OpenChannelNegotiationService
} from "./services";
import type P2PManager from "@/P2PManager";
import { DebugProxy } from "@/utils";

import { config } from "@/utils/config";

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
    lobbyMatchingService: LobbyMatchingService;
    openChannelNegotiationService: OpenChannelNegotiationService;

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
        this.lobbyMatchingService = new LobbyMatchingService(this.p2pManager);
        this.openChannelNegotiationService = new OpenChannelNegotiationService(
            this.p2pManager
        );
        return this.self;
    }

    /** Runtime-startup hook for custom RPC roots. The base is ready immediately. */
    ready(): Promise<void> | void {}

    /**
     * Channel-reset hook for custom RPC roots. `StateManager.resetChannel()`
     * awaits it while the runtime gives up one channel to serve another, so a
     * root can drop channel-scoped state it would otherwise carry over.
     * Overrides must call `super.resetChannel()` so lobby, negotiation,
     * fork-acknowledgement, and spectate state is cleared.
     */
    async resetChannel(): Promise<void> {
        await this.openChannelNegotiationService.reset();
        await this.lobbyMatchingService.reset();
        this.isForkDisputedService.reset();
        this.spectateService.reset();
    }

    /**
     * Runtime-shutdown hook for custom RPC roots. `StateManager.dispose()`
     * awaits it before tearing down the p2p manager, timeout manager, and EVM,
     * so a root can settle waits and drain async work. Overrides must call
     * `super.dispose()` so active lobby and negotiation work is cancelled.
     */
    async dispose(): Promise<void> {
        await this.openChannelNegotiationService.dispose();
        await this.lobbyMatchingService.dispose();
    }
}
export default MainRpcService;
