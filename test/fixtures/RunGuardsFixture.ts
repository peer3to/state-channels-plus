import { withRuntimeRpc } from "./RpcRouterFixture";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
// @spec-test-coverage-ignore: concrete guard collaborators for runGuards component tests
import type ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { AGuard } from "@/rpc/network/guards/AGuard";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";

class RecordingGuard extends AGuard {
    constructor(
        private readonly label: string,
        private readonly passes: boolean,
        private readonly events: string[],
        service: ANetworkRpcService<ANetworkRpcMethods>
    ) {
        super(service);
    }

    public check(): boolean {
        this.events.push(`check:${this.label}`);
        return this.passes;
    }

    public onFailure(): void {
        this.events.push(`failure:${this.label}`);
    }
}

export class RunGuardsFixture {
    public readonly rpc: Rpc = {
        service: "guardProbe",
        method: "run",
        params: []
    };
    public readonly events: string[] = [];

    constructor(
        public readonly transport: NetworkTransport,
        private readonly service: ANetworkRpcService<ANetworkRpcMethods>
    ) {}

    public static async with(
        operation: (fixture: RunGuardsFixture) => void
    ): Promise<void> {
        await withRuntimeRpc(async (sdk) => {
            const host = [...sdk.roots].find(
                (root): root is P2pRuntimeHostRoot =>
                    root instanceof P2pRuntimeHostRoot
            );
            if (!host) throw new Error("Expected inline SDK host");
            const manager = host.hostRpc.requireManager();
            operation(
                new RunGuardsFixture(
                    manager.loopbackTransport,
                    manager.localRpc.initHandshakeService
                )
            );
        });
    }

    public guards(...passes: boolean[]): AGuard[] {
        return passes.map(
            (pass, index) =>
                new RecordingGuard(
                    String(index + 1),
                    pass,
                    this.events,
                    this.service
                )
        );
    }
}
