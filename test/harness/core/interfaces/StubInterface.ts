import type { RestoreToken } from "./common";

// Dotted-path method replacement. `this` is not bound cross-thread.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StubMethodFn = (...args: any[]) => unknown | Promise<unknown>;

export interface StubInterface {
    stubMethod(path: string, fn: StubMethodFn): Promise<RestoreToken>;
    restoreStubbedMethod(token: RestoreToken): Promise<void>;
    restoreAllStubbedMethods(): Promise<void>;
}
