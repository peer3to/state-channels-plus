// @spec-test-coverage-ignore: structural values for ObjectChecks component tests
export class StructuralMethodsOwner {
    public callable(): string {
        return "called";
    }
}

export class StructuralMethodsValue extends StructuralMethodsOwner {
    public ownCallable = (): string => "own-called";
    public nonCallable = "value";
}

export function createCallableAccessorValue(onRead: () => void): object {
    return Object.defineProperty({}, "callable", {
        configurable: true,
        get() {
            onRead();
            return () => "called";
        }
    });
}

export function createThrowingMethodAccessor(): object {
    return Object.defineProperty({}, "callable", {
        configurable: true,
        get() {
            throw new Error("method accessor failed");
        }
    });
}

export function createThrowingHasProxy(): object {
    return new Proxy(
        {},
        {
            has() {
                throw new Error("property trap failed");
            }
        }
    );
}

export type RpcServiceShape = {
    createRPCMethods?: unknown;
    p2pManager?: unknown;
    runRPC?: unknown;
};

export function createRpcServiceShape(): RpcServiceShape {
    return {
        createRPCMethods: () => ({}),
        p2pManager: {},
        runRPC: () => true
    };
}

export function createRpcRoot(service: unknown): { service: unknown } {
    return { service };
}

export type ResultMethodName = "getValue" | "toArray" | "toObject";

export function createResultShape(): unknown[] &
    Partial<Record<ResultMethodName, (...params: unknown[]) => unknown>> {
    return Object.assign([1n], {
        getValue: () => 1n,
        toArray: () => [1n],
        toObject: () => ({ value: 1n })
    });
}
