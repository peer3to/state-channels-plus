import type { RpcStubHandle, RpcStubHandlerFn } from "../handles/RpcStubHandle";
import type { RestoreToken } from "../handles/common";
import type { TestPeer } from "../types";

export class InlineRpcStubHandle implements RpcStubHandle {
    private readonly restoresByKey = new Map<string, () => void>();

    constructor(private readonly peer: TestPeer) {}

    async installCreateRpcMethodStub(
        serviceName: string,
        methodName: string,
        handler: RpcStubHandlerFn
    ): Promise<RestoreToken> {
        const localRpc = (
            this.peer.stateManager.p2pManager as unknown as {
                localRpc: Record<string, unknown>;
            }
        ).localRpc;
        const service = localRpc[serviceName] as
            | { createRPCMethods: (t: unknown) => unknown }
            | undefined;
        if (!service)
            throw new Error(
                `InlineRpcStubHandle: service '${serviceName}' not found on localRpc`
            );
        if (typeof service.createRPCMethods !== "function")
            throw new Error(
                `InlineRpcStubHandle: service '${serviceName}' has no createRPCMethods()`
            );

        const originalCreate = service.createRPCMethods.bind(service);
        const key = `${serviceName}:${methodName}`;
        this.restoresByKey.get(key)?.();

        service.createRPCMethods = (transport: unknown) => {
            const methods = originalCreate(transport) as Record<
                string,
                unknown
            >;
            if (!(methodName in methods))
                throw new Error(
                    `InlineRpcStubHandle: method '${methodName}' missing on createRPCMethods() result for '${serviceName}'`
                );
            methods[methodName] = handler;
            return methods;
        };

        const restore = () => {
            service.createRPCMethods = originalCreate;
            this.restoresByKey.delete(key);
        };
        this.restoresByKey.set(key, restore);
        return { id: key };
    }

    async restoreCreateRpcMethodStub(req: {
        serviceName: string;
        methodName: string;
    }): Promise<void> {
        this.restoresByKey.get(`${req.serviceName}:${req.methodName}`)?.();
    }

    async restoreAll(): Promise<void> {
        for (const restore of this.restoresByKey.values()) restore();
        this.restoresByKey.clear();
    }
}
