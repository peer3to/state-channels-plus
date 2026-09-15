// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { RuntimeRpcControlRpcMethods } from "./RuntimeRpcControlRpcMethods";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import type P2PManager from "@/P2PManager";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { RuntimeRpcControl } from "@test/fixtures/runtimeRpc/RuntimeRpcControl";

export type RuntimeConnectionKey = "parent" | "executor";

export class RuntimeRpcControlService extends ANetworkRpcService<
    RuntimeRpcControlRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "RuntimeRpcControlService"
            })
        );
    }

    public createRPCMethods(transport: NetworkTransport) {
        return new RuntimeRpcControlRpcMethods(transport, this);
    }

    public connection(key: RuntimeConnectionKey) {
        const root = [...RootCreationControl.roots].find((candidate) => {
            if (!(candidate instanceof P2pRuntimeHostRoot)) return false;
            try {
                return candidate.hostRpc.requireManager() === this.p2pManager;
            } catch {
                return false;
            }
        });
        if (!root) throw new Error("This SDK has no registered runtime root");
        const connections = [...root.connections.values()].filter(
            (entry) =>
                entry.remoteRelation === (key === "parent" ? "parent" : "child")
        );
        if (connections.length !== 1)
            throw new Error(`Expected one ${key} connection on this SDK`);
        const connection = connections[0];
        const control = RuntimeRpcControl.get(connection["transport"]);
        if (!control)
            throw new Error(
                "Runtime controls were not installed by this SDK's construction callback"
            );
        return { transport: connection["transport"], control };
    }

    public state(key: RuntimeConnectionKey) {
        const { transport, control } = this.connection(key);
        return {
            heldCount: control.heldCount,
            pendingCount: transport.router.pendingRequestsFor(transport).length,
            pendingTimers: control.pendingTimers(),
            sent: [...control.sent]
        };
    }
}
