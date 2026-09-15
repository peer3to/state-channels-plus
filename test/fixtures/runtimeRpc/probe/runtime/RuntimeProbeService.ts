// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { RuntimeProbeRpcMethods } from "./RuntimeProbeRpcMethods";
import { RuntimeRpcControl } from "../../RuntimeRpcControl";
import type {
    AInternalRpcRoot,
    RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type InternalTransport from "@/transport/InternalTransport";
import type { RuntimePort } from "@/transport/RuntimePort";
import { DetachedPromises } from "@/utils/DetachedPromises";
import { adaptPort } from "@platform/p2pRuntimeChannel";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";

type InvocationKey = string;
export class RuntimeProbeService extends AInternalRpcService<RuntimeProbeRpcMethods> {
    public mode: "ordinary" | "accessor" | "nonFunction" | "capture" =
        "ordinary";
    public accessorReads = 0;
    public identity = "unset";
    public readonly entered: InvocationKey[] = [];
    public readonly notifications: unknown[] = [];
    private readonly held = new Map<
        InvocationKey,
        { release: () => void; promise: Promise<void> }
    >();
    constructor(public readonly root: AInternalRpcRoot) {
        super(root.router);
    }
    public createRPCMethods(sender: InternalTransport) {
        const methods = new RuntimeProbeRpcMethods(this, sender);
        // Stage own data properties to test descriptor dispatch, not class-field endpoints.
        Object.defineProperty(methods, "own", {
            value: methods.own,
            configurable: true
        });
        Object.defineProperty(methods, "captured", {
            value: methods.captured,
            writable: true,
            configurable: true
        });
        if (this.mode === "accessor")
            Object.defineProperty(methods, "shadowed", {
                get: () => {
                    this.accessorReads++;
                    return () => "accessor";
                }
            });
        if (this.mode === "nonFunction")
            Object.defineProperty(methods, "shadowed", {
                value: "not callable"
            });
        if (this.mode !== "capture") return methods;
        return new Proxy(methods, {
            getOwnPropertyDescriptor(target, property) {
                const descriptor = Reflect.getOwnPropertyDescriptor(
                    target,
                    property
                );
                if (property === "captured" && descriptor)
                    target.captured = () => "replacement";
                return descriptor;
            }
        });
    }
    public async disposeDomain() {
        if (!(this.root instanceof P2pRuntimeHostRoot))
            throw new Error("Expected host root");
        const manager = this.root.hostRpc.requireManager();
        const domain = manager.localRpc;
        const dispose = domain.dispose;
        let calls = 0;
        let managerWasDisposed = true;
        domain.dispose = async () => {
            calls++;
            managerWasDisposed = manager.isDisposed;
            await dispose.call(domain);
        };
        let message = "";
        try {
            await manager.stateManager.dispose();
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        } finally {
            domain.dispose = dispose;
        }
        return {
            calls,
            managerWasDisposed,
            managerIsDisposed: manager.isDisposed,
            connectionsAfter: manager.getConnectedPeers().size,
            message
        };
    }
    public postFrame(sender: InternalTransport, frame: unknown): void {
        // Fault frames still cross the actual SDK port and its production listener.
        const port = Reflect.get(sender, "port") as RuntimePort;
        port.post(frame);
    }
    public sendOnTransferredPort(rawPort: unknown, value: unknown): void {
        const port = adaptPort(rawPort as Parameters<typeof adaptPort>[0]);
        try {
            port.post(value);
        } finally {
            port.close();
        }
    }
    public hold(key: InvocationKey): Promise<void> {
        if (this.held.has(key))
            throw new Error(`Duplicate held invocation: ${key}`);
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.held.set(key, { promise, release });
        this.entered.push(key);
        return promise;
    }
    public release(key: InvocationKey): void {
        const invocation = this.held.get(key);
        if (!invocation) throw new Error(`No held invocation: ${key}`);
        this.held.delete(key);
        invocation.release();
    }
    public detachFailure(key: InvocationKey, drainOnly = false): void {
        const pending = this.hold(key).then(() => {
            throw new Error(`detached ${key}`);
        });
        // Drain-only staging must not also trigger the process unhandled-error observer.
        if (drainOnly) void pending.catch(() => undefined);
        DetachedPromises.collect(pending);
    }
    public releaseAll(): void {
        for (const key of this.held.keys()) this.release(key);
    }
    public childConnection(): RuntimeConnection<RuntimeProbeRoot> {
        const child = [...this.root.connections.values()].find(
            (connection) => connection.remoteRelation === "child"
        );
        if (!child) throw new Error("Runtime probe has no child connection");
        return child.rpc as RuntimeConnection<RuntimeProbeRoot>;
    }
    public connection(
        sender: InternalTransport
    ): RuntimeConnection<RuntimeProbeRoot> {
        const connection = this.root.connections.get(sender);
        if (!connection) throw new Error("Invoking connection has closed");
        return connection.rpc as RuntimeConnection<RuntimeProbeRoot>;
    }
}
export type RuntimeProbeRoot = AInternalRpcRoot & {
    runtimeProbe: RuntimeProbeService;
};
export function installRuntimeProbe(root: AInternalRpcRoot): void {
    for (const transport of root.connections.keys())
        RuntimeRpcControl.attach(transport);
    RootCreationControl.connections(root, (connection) => {
        RuntimeRpcControl.attachTo(connection);
    });
    Object.assign(root, { runtimeProbe: new RuntimeProbeService(root) });
}
