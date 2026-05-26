// W3 - wire format. three frame shapes, one envelope.
// W0 D-2 - port is orchestrator <-> worker only.
// W0 D-8 - one channel carries req/res + push.

export type SerializedError = {
    name: string;
    message: string;
    stack?: string;
};

export type Req = {
    kind: "req";
    id: number;
    method: string;
    args: unknown;
};

export type Res = {
    kind: "res";
    id: number;
    result?: unknown;
    error?: SerializedError;
};

export type Push = {
    kind: "push";
    topic: string;
    payload: unknown;
};

export type Frame = Req | Res | Push;

// step 1 - structural port type. covers both node:worker_threads MessagePort
// and lib.dom MessagePort. kernel doesn't care which it gets; W2's portCast
// helper hands one in at construction. close() ends both sides; postMessage
// throws synchronously on a closed port, callers wrap in try/catch.
export interface RpcPort {
    postMessage(value: unknown): void;
    close(): void;
    on(event: "message", listener: (value: unknown) => void): void;
    on(event: "close", listener: () => void): void;
    off(event: "message", listener: (value: unknown) => void): void;
    off(event: "close", listener: () => void): void;
}
