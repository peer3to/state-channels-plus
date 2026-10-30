// @spec-test-coverage-ignore: harness service composition exercised by owning mapped tests

import { BalanceService } from "./services/balance/BalanceService";
import { ByzantineService } from "./services/byzantine/ByzantineService";
import { DisputeService } from "./services/dispute/DisputeService";
import { HandshakeService } from "./services/handshake/HandshakeService";
import { LifecycleService } from "./services/lifecycle/LifecycleService";
import { MirrorService } from "./services/mirror/MirrorService";
import { NetworkService } from "./services/network/NetworkService";
import { QueryService } from "./services/query/QueryService";
import { RuntimeRpcControlService } from "./services/runtimeRpc/RuntimeRpcControlService";
import { ScenarioService } from "./services/scenario/ScenarioService";
import { SignerService } from "./services/signer/SignerService";
import { SpectateControlService } from "./services/spectate/SpectateControlService";
import { StubService } from "./services/stub/StubService";
import { TransitionService } from "./services/transition/TransitionService";
import { ValidationProbeService } from "./services/validationProbe/ValidationProbeService";
import type { ApplicationEventMap } from "@/events/EventBus";
import type P2PManager from "@/P2PManager";
import MainRpcService from "@/rpc/network/MainRpcService";
import type { CustomRpcConstructor } from "@/rpc/network/registry";

/**
 * The control services {@link withHarnessControl} adds to a custom RPC.
 */
export interface HarnessControlServices {
    query: QueryService;
    network: NetworkService;
    byzantine: ByzantineService;
    stub: StubService;
    handshake: HandshakeService;
    signer: SignerService;
    spectate: SpectateControlService;
    scenario: ScenarioService;
    dispute: DisputeService;
    transition: TransitionService;
    balance: BalanceService;
    lifecycle: LifecycleService;
    validation: ValidationProbeService;
    runtimeRpc: RuntimeRpcControlService;
    mirror: MirrorService;
}

/**
 * The harness-control surface of a peer's custom RPC: the network root plus
 * the control services. Control services type their `p2pManager` by it, so
 * they work on any custom RPC the mixin extends.
 */
export type HarnessControlRpcShape = MainRpcService & HarnessControlServices;

/**
 * Host-side harness-control RPC.
 *
 * The SDK now runs behind a serializable message-port boundary, so the test
 * harness can no longer reach into `peer.stateManager` by reference. This custom
 * RPC exposes the operations the harness needs — grouped into focused services
 * that execute *host-side*, where the live signer, `p2pManager`, storage and
 * contracts actually are. The harness invokes them via
 * `harness.control(peer).<service>.<method>(...).request()` (no target =
 * loopback to self).
 *
 * Conventions (mirroring `src/rpc/network/services/*`):
 * - each service lives in its own directory with a `*Service` + `*RpcMethods`;
 * - methods return serializable projections (hashes, heights, addresses, plain
 *   structs) — never live `Block`/transport/profile instances;
 * - stub sites are concrete methods (not free-form path strings) so an SDK
 *   rename breaks compilation here instead of failing silently at runtime;
 * - no guards — the harness must be able to query a peer before any handshake.
 *
 * The control services are network services on the custom RPC, added by this
 * mixin, so an application's own custom RPC (`Base`) runs in tests with the
 * full harness-control surface; `Base` keeps its `TEvents` and services.
 * `Base` must be a custom RPC constructor; its options type is its own, so
 * the check takes `never` options and accepts any. The declared return type
 * names the result without the class expression, so declarations emit.
 */
export function withHarnessControl<
    TBase extends new (...args: any[]) => MainRpcService
>(
    Base: TBase & CustomRpcConstructor<InstanceType<TBase>, never>
): TBase & (new (...args: any[]) => HarnessControlServices) {
    // Upcast so the class extends the mixin constructor type alone.
    const MixinBase: TBase = Base;
    return class HarnessControlled
        extends MixinBase
        implements HarnessControlServices
    {
        query: QueryService;
        network: NetworkService;
        byzantine: ByzantineService;
        stub: StubService;
        handshake: HandshakeService;
        signer: SignerService;
        spectate: SpectateControlService;
        scenario: ScenarioService;
        dispute: DisputeService;
        transition: TransitionService;
        balance: BalanceService;
        lifecycle: LifecycleService;
        validation: ValidationProbeService;
        runtimeRpc: RuntimeRpcControlService;
        mirror: MirrorService;

        // TypeScript requires a mixin constructor to take `...args: any[]`. The
        // runtime constructs the custom RPC as `CustomRpcConstructor` does:
        // `args[0]` is the P2PManager built for this RPC, whose `localRpc` is
        // this instance and so carries the control services.
        constructor(...args: any[]) {
            super(...args);
            const p2pManager: P2PManager<HarnessControlRpcShape> = args[0];
            this.query = new QueryService(p2pManager);
            this.network = new NetworkService(p2pManager);
            this.byzantine = new ByzantineService(p2pManager);
            this.stub = new StubService(p2pManager);
            this.handshake = new HandshakeService(p2pManager);
            this.signer = new SignerService(p2pManager);
            this.spectate = new SpectateControlService(p2pManager);
            this.scenario = new ScenarioService(p2pManager);
            this.dispute = new DisputeService(p2pManager, this.signer);
            this.transition = new TransitionService(p2pManager, this.stub);
            this.balance = new BalanceService(p2pManager);
            this.lifecycle = new LifecycleService(p2pManager);
            this.validation = new ValidationProbeService(p2pManager);
            this.runtimeRpc = new RuntimeRpcControlService(p2pManager);
            this.mirror = new MirrorService(p2pManager);
        }

        /**
         * Release every paused host call staged by the stub service before the
         * runtime tears down, so an abort during a staged hold never leaves a
         * paused drain behind.
         */
        override async dispose(): Promise<void> {
            this.stub.releaseReductionHolds();
            // a join collection held mid-way continues into the disposed runtime
            this.stub.releaseJoinThresholdRead();
            this.stub.releaseJoinCollectionResult();
            this.stub.restoreCollectAndJoinEntries();
            await super.dispose();
        }
    };
}

/**
 * The SDK's own network root with the harness-control surface. A test's own
 * custom RPC composes by extending this class, so every peer keeps the full
 * harness-control surface; `TEvents` names the application events it emits.
 */
export class HarnessControlRpc<
    TEvents extends ApplicationEventMap = Record<never, never>
> extends withHarnessControl(MainRpcService)<TEvents> {}

export default HarnessControlRpc;
