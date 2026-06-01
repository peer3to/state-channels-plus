// Wire format: req, res, and push frames share one envelope on a single channel.

export type SerializedError = {
    name: string;
    message: string;
    stack?: string;
    // Preserve CustomEvmError fields so isCustomEvmError still works after a wire round-trip.
    isCustomError?: boolean;
    customError?: {
        name: string;
        args: readonly unknown[];
        signature?: string;
        selector?: string;
    };
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

// Structural port type covering node and lib.dom MessagePort.
export interface RpcPort {
    postMessage(value: unknown): void;
    close(): void;
    on(event: "message", listener: (value: unknown) => void): void;
    on(event: "close", listener: () => void): void;
    off(event: "message", listener: (value: unknown) => void): void;
    off(event: "close", listener: () => void): void;
}
