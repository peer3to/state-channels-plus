import type {
    RpcStubInterface,
    RpcStubHandlerFn
} from "../interfaces/RpcStubInterface";
import type {
    RestoreToken,
    RpcStubSlotKey,
    StubCallbackId
} from "../interfaces/common";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import type { StubCallbackRegistry } from "../StubCallbackRegistry";
import { ROUTES } from "@test/harness/threaded/worker/routeNames";

export class WorkerRpcStubHandle implements RpcStubInterface {
    // per-handle live ids -> lets restoreAll drop orchestrator-side closures
    // even when the test only restores via restoreCreateRpcMethodStub (one-slot key).
    private readonly liveCallbackIds = new Map<
        RpcStubSlotKey,
        StubCallbackId
    >();

    constructor(
        private readonly rpc: PeerCaller,
        private readonly registry: StubCallbackRegistry
    ) {}

    async installCreateRpcMethodStub(
        serviceName: string,
        methodName: string,
        handler: RpcStubHandlerFn
    ): Promise<RestoreToken> {
        const key = `${serviceName}:${methodName}` as RpcStubSlotKey;
        const prior = this.liveCallbackIds.get(key);
        if (prior) this.registry.unregisterStub(prior);
        const id = this.registry.registerStub((args) =>
            (handler as (...a: unknown[]) => unknown)(...args)
        );
        this.liveCallbackIds.set(key, id);
        return (await this.rpc.call(ROUTES.rpcStub.installCreateRpcMethodStub, {
            serviceName,
            methodName,
            callbackId: id
        })) as RestoreToken;
    }

    async restoreCreateRpcMethodStub(
        serviceName: string,
        methodName: string
    ): Promise<void> {
        const key = `${serviceName}:${methodName}` as RpcStubSlotKey;
        const id = this.liveCallbackIds.get(key);
        if (id) {
            this.registry.unregisterStub(id);
            this.liveCallbackIds.delete(key);
        }
        await this.rpc.call(ROUTES.rpcStub.restoreCreateRpcMethodStub, {
            serviceName,
            methodName
        });
    }

    async restoreAll(): Promise<void> {
        for (const id of this.liveCallbackIds.values()) {
            this.registry.unregisterStub(id);
        }
        this.liveCallbackIds.clear();
        await this.rpc.call(ROUTES.rpcStub.restoreAll, {});
    }
}
