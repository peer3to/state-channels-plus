import type { PeerHandler } from "../rpc/rpc-server";
import type { PeerCaller } from "../rpc/rpc-client";
import type StateManager from "@/stateManager";
import type { P2pInstance } from "@/evm";
import type { AStateMachine } from "@typechain-types";
import { StateRoutes } from "./routes/stateRoutes";
import { ByzantineRoutes } from "./routes/byzantineRoutes";
import { RpcStubRoutes } from "./routes/rpcStubRoutes";
import { QueryInternalsRoutes } from "./routes/queryInternalsRoutes";
import { NetworkRoutes } from "./routes/networkRoutes";
import { StubRoutes } from "./routes/stubRoutes";
import { LifecycleRoutes } from "./routes/lifecycleRoutes";
import { TamperRoutes } from "./routes/tamperRoutes";
import { MathRoutes } from "./routes/mathRoutes";

export class WorkerRoutes {
    private readonly state: StateRoutes;
    private readonly byzantine: ByzantineRoutes;
    private readonly rpcStub: RpcStubRoutes;
    private readonly queryInternals: QueryInternalsRoutes;
    private readonly network: NetworkRoutes;
    private readonly stub: StubRoutes;
    private readonly lifecycle: LifecycleRoutes;
    private readonly tamper: TamperRoutes;
    private readonly math: MathRoutes;

    constructor(server: PeerHandler, rpcClient: PeerCaller, peerIndex: number) {
        this.state = new StateRoutes(server);
        this.byzantine = new ByzantineRoutes(server);
        this.rpcStub = new RpcStubRoutes(server, rpcClient);
        this.queryInternals = new QueryInternalsRoutes(server);
        this.network = new NetworkRoutes(server, rpcClient);
        this.stub = new StubRoutes(server, rpcClient);
        this.lifecycle = new LifecycleRoutes(server);
        this.tamper = new TamperRoutes(server, rpcClient, peerIndex);
        this.math = new MathRoutes(server);
    }

    setRuntime(
        sm: StateManager,
        p2pInstance: P2pInstance<AStateMachine>
    ): void {
        this.state.setStateManager(sm);
        this.byzantine.setStateManager(sm);
        this.rpcStub.setStateManager(sm);
        this.queryInternals.setStateManager(sm);
        this.network.setStateManager(sm);
        this.stub.setStateManager(sm);
        this.lifecycle.setStateManager(sm);
        this.tamper.setStateManager(sm);
        this.math.setP2pInstance(p2pInstance);
    }
}
