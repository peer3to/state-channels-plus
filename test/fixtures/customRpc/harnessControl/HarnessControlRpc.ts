// @spec-test-coverage-ignore: harness service composition exercised by owning mapped tests
import MainRpcService from "@/rpc/MainRpcService";
import type P2PManager from "@/P2PManager";

import { QueryService } from "./services/query/QueryService";
import { NetworkService } from "./services/network/NetworkService";
import { ByzantineService } from "./services/byzantine/ByzantineService";
import { StubService } from "./services/stub/StubService";
import { HandshakeService } from "./services/handshake/HandshakeService";
import { SignerService } from "./services/signer/SignerService";
import { SpectateControlService } from "./services/spectate/SpectateControlService";
import { ScenarioService } from "./services/scenario/ScenarioService";
import { DisputeService } from "./services/dispute/DisputeService";
import { TransitionService } from "./services/transition/TransitionService";
import { BalanceService } from "./services/balance/BalanceService";
import { LifecycleService } from "./services/lifecycle/LifecycleService";

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
 * Conventions (mirroring `src/rpc/services/*`):
 * - each service lives in its own directory with a `*Service` + `*RpcMethods`;
 * - methods return serializable projections (hashes, heights, addresses, plain
 *   structs) — never live `Block`/transport/profile instances;
 * - stub sites are concrete methods (not free-form path strings) so an SDK
 *   rename breaks compilation here instead of failing silently at runtime;
 * - no guards — the harness must be able to query a peer before any handshake.
 *
 * A test's own custom RPC composes by extending this class, so every peer keeps
 * the full harness-control surface.
 */
export class HarnessControlRpc extends MainRpcService {
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

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(p2pManager);
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
    }

    /**
     * Release every paused host call staged by the stub service before the
     * runtime tears down, so an abort during a staged hold never leaves a
     * paused drain behind.
     */
    override async dispose(): Promise<void> {
        this.stub.releaseReductionHolds();
        await super.dispose();
    }
}

export default HarnessControlRpc;
