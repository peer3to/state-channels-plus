import ATransport from "@/transport/ATransport";
import { Logger } from "@/utils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

type AnyFn = (...args: any[]) => any;

type ServiceWithCreateRPCMethods = {
    createRPCMethods: (transport: ATransport) => unknown;
};

type RpcMethodsOf<TService extends ServiceWithCreateRPCMethods> = ReturnType<
    TService["createRPCMethods"]
> &
    object;

type MethodKeys<T> = {
    [K in keyof T]-?: T[K] extends AnyFn ? K : never;
}[keyof T];

export class RpcStubActions {
    private rpcMethodStubRestorers = new Map<string, () => void>();

    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    private getLocalRpc(peerIndex: number) {
        const peer = this.harness.getPeer(peerIndex);
        return peer.stateManager.p2pManager.localRpc;
    }

    private getStubKey(
        peerIndex: number,
        serviceName: string,
        methodName: string
    ): string {
        return `${peerIndex}:${serviceName}:${methodName}`;
    }

    /**
     * Wrap service.createRPCMethods(), call original first, then replace one method
     * on the returned RPC methods instance.
     */
    stubServiceCreateRpcMethod<
        TServiceName extends keyof ReturnType<RpcStubActions["getLocalRpc"]> &
            string,
        TMethodName extends MethodKeys<
            RpcMethodsOf<
                Extract<
                    ReturnType<RpcStubActions["getLocalRpc"]>[TServiceName],
                    ServiceWithCreateRPCMethods
                >
            >
        > &
            string
    >(options: {
        peerIndex: number;
        serviceName: TServiceName;
        methodName: TMethodName;
        stubbedMethod: Extract<
            RpcMethodsOf<
                Extract<
                    ReturnType<RpcStubActions["getLocalRpc"]>[TServiceName],
                    ServiceWithCreateRPCMethods
                >
            >[TMethodName],
            AnyFn
        >;
    }): () => void {
        const { peerIndex, serviceName, methodName, stubbedMethod } = options;

        const localRpc = this.getLocalRpc(peerIndex) as unknown as Record<
            string,
            unknown
        >;
        const service = localRpc[serviceName];

        if (!service) {
            throw new Error(
                `Cannot stub RPC method: service '${serviceName}' not found on peer ${peerIndex}`
            );
        }

        if (
            typeof service !== "object" ||
            service === null ||
            !("createRPCMethods" in service) ||
            typeof (service as ServiceWithCreateRPCMethods).createRPCMethods !==
                "function"
        ) {
            throw new Error(
                `Cannot stub RPC method: service '${serviceName}' on peer ${peerIndex} does not expose createRPCMethods()`
            );
        }

        const typedService = service as ServiceWithCreateRPCMethods;
        const originalCreateRPCMethods =
            typedService.createRPCMethods.bind(typedService);
        const key = this.getStubKey(peerIndex, serviceName, String(methodName));

        this.rpcMethodStubRestorers.get(key)?.();

        typedService.createRPCMethods = ((transport: ATransport) => {
            const methods = originalCreateRPCMethods(transport) as Record<
                string,
                unknown
            >;

            if (!(methodName in methods)) {
                throw new Error(
                    `Stubbed RPC method '${String(methodName)}' missing in created RPC methods for service '${serviceName}' on peer ${peerIndex}`
                );
            }

            methods[methodName] = stubbedMethod;
            return methods;
        }) as ServiceWithCreateRPCMethods["createRPCMethods"];

        const restore = () => {
            typedService.createRPCMethods = originalCreateRPCMethods;
            this.rpcMethodStubRestorers.delete(key);
        };

        this.rpcMethodStubRestorers.set(key, restore);

        this.logger.debug(
            `Stubbed RPC method '${String(methodName)}' on service '${serviceName}' for peer ${peerIndex}`
        );

        return restore;
    }

    restoreStubbedServiceCreateRpcMethod<
        TServiceName extends keyof ReturnType<RpcStubActions["getLocalRpc"]> &
            string,
        TMethodName extends MethodKeys<
            RpcMethodsOf<
                Extract<
                    ReturnType<RpcStubActions["getLocalRpc"]>[TServiceName],
                    ServiceWithCreateRPCMethods
                >
            >
        > &
            string
    >(options: {
        peerIndex: number;
        serviceName: TServiceName;
        methodName: TMethodName;
    }): void {
        const { peerIndex, serviceName, methodName } = options;
        const key = this.getStubKey(peerIndex, serviceName, String(methodName));
        const restore = this.rpcMethodStubRestorers.get(key);
        restore?.();
    }

    restoreAllStubbedServiceCreateRpcMethods(): void {
        for (const restore of this.rpcMethodStubRestorers.values()) {
            restore();
        }
        this.rpcMethodStubRestorers.clear();
    }
}
