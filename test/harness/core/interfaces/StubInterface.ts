import type { RestoreToken, StubMethodPath } from "./common";

// Dotted-path method replacement. `this` is not bound cross-thread.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StubMethodFn = (...args: any[]) => unknown | Promise<unknown>;

export interface StubInterface {
    stubMethod(path: StubMethodPath, fn: StubMethodFn): Promise<RestoreToken>;
}
