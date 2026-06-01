import type { PeerHandler } from "../../rpc/rpc-server";
import type { PeerCaller } from "../../rpc/rpc-client";
import { ROUTES } from "../routeNames";
import type StateManager from "@/stateManager";

export class RpcStubRoutes {
    private stateManager?: StateManager;
    private readonly rpcStubRestores = new Map<string, () => void>();

    constructor(
        server: PeerHandler,
        private readonly rpcClient: PeerCaller
    ) {
        this.register(server);
    }

    setStateManager(sm: StateManager): void {
        this.stateManager = sm;
    }

    private get sm(): StateManager {
        if (!this.stateManager)
            throw new Error(
                "stateManager not initialized: p2pSetup has not completed"
            );
        return this.stateManager;
    }

    private register(server: PeerHandler): void {
        server.register(
            ROUTES.rpcStub.installCreateRpcMethodStub,
            async (args) => {
                const { serviceName, methodName, callbackId } = (args ??
                    {}) as {
                    serviceName?: string;
                    methodName?: string;
                    callbackId?: string;
                };
                if (!serviceName)
                    throw new Error(
                        "rpcStub.installCreateRpcMethodStub: missing 'serviceName'"
                    );
                if (!methodName)
                    throw new Error(
                        "rpcStub.installCreateRpcMethodStub: missing 'methodName'"
                    );
                if (!callbackId)
                    throw new Error(
                        "rpcStub.installCreateRpcMethodStub: missing 'callbackId'"
                    );

                const localRpc = this.sm.p2pManager
                    .localRpc as unknown as Record<string, unknown>;
                const service = localRpc[serviceName] as
                    | { createRPCMethods: (t: unknown) => unknown }
                    | undefined;
                if (!service)
                    throw new Error(
                        `rpcStub: service '${serviceName}' not found on localRpc`
                    );
                if (typeof service.createRPCMethods !== "function")
                    throw new Error(
                        `rpcStub: service '${serviceName}' has no createRPCMethods()`
                    );

                const originalCreate = service.createRPCMethods.bind(service);
                const key = `${serviceName}:${methodName}`;
                this.rpcStubRestores.get(key)?.();

                const rpcClient = this.rpcClient;
                service.createRPCMethods = (transport: unknown) => {
                    const methods = originalCreate(transport) as Record<
                        string,
                        unknown
                    >;
                    if (!(methodName in methods))
                        throw new Error(
                            `rpcStub: method '${methodName}' missing on createRPCMethods() result for '${serviceName}'`
                        );
                    methods[methodName] = async function (
                        this: unknown,
                        ...callArgs: unknown[]
                    ) {
                        return await rpcClient.call(
                            "harness.invokeStubCallback",
                            { id: callbackId, args: callArgs }
                        );
                    };
                    return methods;
                };

                const restore = () => {
                    service.createRPCMethods = originalCreate;
                    this.rpcStubRestores.delete(key);
                };
                this.rpcStubRestores.set(key, restore);
                return { id: key };
            }
        );

        server.register(
            ROUTES.rpcStub.restoreCreateRpcMethodStub,
            async (args) => {
                const { serviceName, methodName } = (args ?? {}) as {
                    serviceName?: string;
                    methodName?: string;
                };
                if (!serviceName || !methodName)
                    throw new Error(
                        "rpcStub.restoreCreateRpcMethodStub: missing 'serviceName' or 'methodName'"
                    );
                this.rpcStubRestores.get(`${serviceName}:${methodName}`)?.();
                return {};
            }
        );

        server.register(ROUTES.rpcStub.restoreAll, async () => {
            for (const restore of this.rpcStubRestores.values()) restore();
            this.rpcStubRestores.clear();
            return {};
        });
    }
}
