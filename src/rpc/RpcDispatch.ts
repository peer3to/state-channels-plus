import type Rpc from "./Rpc";
import type { RpcResponse } from "./Rpc";

export interface RpcServiceContract<TTransport = any> {
    readonly router: object;
    createRPCMethods(transport: TTransport): object;
    runRPC(rpc: Rpc, transport: TTransport): Promise<boolean>;
}

type RpcEndpoint = (...params: Rpc["params"]) => unknown;

export function resolveRpcEndpoint(
    rpcMethods: object,
    methodName: string,
    basePrototype: object
): RpcEndpoint | undefined {
    if (methodName === "constructor") return undefined;

    let owner: object | null = rpcMethods;
    while (owner && owner !== basePrototype && owner !== Object.prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, methodName);
        if (descriptor) {
            return typeof descriptor.value === "function"
                ? descriptor.value
                : undefined;
        }
        owner = Object.getPrototypeOf(owner);
    }
    return undefined;
}

export function sendRpcResponseSafely<TError>(
    response: RpcResponse<TError>,
    send: (response: RpcResponse<TError>) => void,
    onFailure: (error: unknown) => void
): void {
    try {
        send(response);
    } catch (error: unknown) {
        onFailure(error);
    }
}

export async function invokeRpcEndpoint<TError>(
    rpc: Rpc,
    rpcMethods: object,
    endpoint: RpcEndpoint,
    boundary: {
        invoke?: <T>(invoke: () => T) => T;
        prepareError: (error: unknown) => TError;
        reply: (response: RpcResponse<TError>) => void;
        onAsyncSendError?: (error: unknown) => void;
        onSyncSendError?: (error: unknown) => void;
    }
): Promise<boolean> {
    const invoke = () => Reflect.apply(endpoint, rpcMethods, rpc.params);
    // Request/response: run the handler, then reply with its (awaited) value.
    // Handler errors are reported back to the caller (so its promise rejects)
    // instead of dropping the connection.
    const requestId = rpc.requestId;
    let response: RpcResponse<TError> | undefined;
    // Preserve the network policy distinction between a throw and a rejected promise.
    let endpointReturned = false;
    try {
        const pending = boundary.invoke ? boundary.invoke(invoke) : invoke();
        endpointReturned = true;
        const result = await pending;
        if (requestId !== undefined) {
            response = { rpcResponse: true, requestId, ok: true, result };
        }
    } catch (error: unknown) {
        if (requestId === undefined) {
            const onError = endpointReturned
                ? boundary.onAsyncSendError
                : boundary.onSyncSendError;
            if (!onError) throw error;
            onError(error);
            return endpointReturned;
        }
        response = {
            rpcResponse: true,
            requestId,
            ok: false,
            error: boundary.prepareError(error)
        };
    }
    // A failed reply must never become a second error response.
    if (response) boundary.reply(response);
    return true;
}
