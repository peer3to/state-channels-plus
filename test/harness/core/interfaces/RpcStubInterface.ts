import type { RestoreToken } from "./common";

// Inline: installed on the rpc-methods object with `this` bound.
// Worker: closure runs orchestrator-side via tamper-bridge callback.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcStubHandlerFn = (
    this: any,
    ...args: any[]
) => unknown | Promise<unknown>;

export interface RpcStubInterface {
    installCreateRpcMethodStub(
        serviceName: string,
        methodName: string,
        handler: RpcStubHandlerFn
    ): Promise<RestoreToken>;

    restoreCreateRpcMethodStub(
        serviceName: string,
        methodName: string
    ): Promise<void>;

    restoreAll(): Promise<void>;
}
