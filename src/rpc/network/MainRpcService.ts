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
import type { ApplicationEventMap, EventBus } from "@/events/EventBus";
import type P2PManager from "@/P2PManager";
import { DebugProxy } from "@/utils";

import { config } from "@/utils/config";

/** Type-only key of the application event map a network root declares. */
declare const applicationEventsType: unique symbol;

/** The application event map a network root class declares (empty for none). */
export type ApplicationEventsOf<TRpc extends MainRpcService> =
    TRpc[typeof applicationEventsType];

/**
 * The network service root. An application extends it with its network
 * services and declares the `application` events its runtime code emits as
 * `TEvents`; the client's events are typed by the same declaration.
 */
class MainRpcService<
    TEvents extends ApplicationEventMap = Record<never, never>
> {
    /** Type-only: carries `TEvents` to the client; never set at runtime. */
    declare readonly [applicationEventsType]: TEvents;
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
     * Runtime-shutdown hook for custom RPC roots. `StateManager.dispose()`
     * awaits it before tearing down the p2p manager, timeout manager, and EVM,
     * so a root can settle waits and drain async work. Overrides must call
     * `super.dispose()` so pending handshake and sync waits settle and active
     * lobby and negotiation work is cancelled.
     */
    async dispose(): Promise<void> {
        this.initHandshakeService.dispose();
        this.spectateService.dispose();
        await this.openChannelNegotiationService.dispose();
        await this.lobbyMatchingService.dispose();
    }

    /**
     * The runtime's one event bus, typed by this application's event map:
     * `applicationEvents.emit("application", name, args)` is checked
     * against `TEvents`.
     */
    protected get applicationEvents(): EventBus<TEvents> {
        // The runtime bus carries whatever this root's application declares.
        return this.p2pManager.stateManager.events as EventBus<TEvents>;
    }
}
export default MainRpcService;
