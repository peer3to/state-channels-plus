import type {
    RpcStubInterface,
    RpcStubHandlerFn
} from "../interfaces/RpcStubInterface";
import type { RestoreToken } from "../interfaces/common";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import type { StubCallbackRegistry } from "../StubCallbackRegistry";

export class WorkerRpcStubHandle implements RpcStubInterface {
    // per-handle live ids -> lets restoreAll drop orchestrator-side closures
    // even when the test only restores via restoreCreateRpcMethodStub (one-slot key).
    private readonly liveCallbackIds = new Map<string, string>();

    constructor(
        private readonly rpc: PeerCaller,
        private readonly registry: StubCallbackRegistry
    ) {}

    async installCreateRpcMethodStub(
        serviceName: string,
        methodName: string,
        handler: RpcStubHandlerFn
    ): Promise<RestoreToken> {
        const key = `${serviceName}:${methodName}`;
        const prior = this.liveCallbackIds.get(key);
        if (prior) this.registry.unregisterStub(prior);
        const id = this.registry.registerStub((args) =>
            (handler as (...a: unknown[]) => unknown)(...args)
        );
        this.liveCallbackIds.set(key, id);
        return (await this.rpc.call("rpcStub.installCreateRpcMethodStub", {
            serviceName,
            methodName,
            callbackId: id
        })) as RestoreToken;
    }

    async restoreCreateRpcMethodStub(
        serviceName: string,
        methodName: string
    ): Promise<void> {
        const key = `${serviceName}:${methodName}`;
        const id = this.liveCallbackIds.get(key);
        if (id) {
            this.registry.unregisterStub(id);
            this.liveCallbackIds.delete(key);
        }
        await this.rpc.call("rpcStub.restoreCreateRpcMethodStub", {
            serviceName,
            methodName
        });
    }

    async restoreAll(): Promise<void> {
        for (const id of this.liveCallbackIds.values()) {
            this.registry.unregisterStub(id);
        }
        this.liveCallbackIds.clear();
        await this.rpc.call("rpcStub.restoreAll", {});
    }
}
