// W2 - node:worker_threads MessagePort <-> lib.dom MessagePort cast.
// the two structural types overlap but TypeScript treats them as distinct.
// kernel uses its own RpcPort structural interface; this helper wraps a node
// MessagePort once at boot so the kernel doesn't see the dom-vs-node mismatch.

import type { MessagePort as NodeMessagePort } from "node:worker_threads";

import type { RpcPort } from "../rpc/rpc-types";

// step 1 - adapt node MessagePort to the kernel's structural RpcPort.
// node MessagePort uses EventEmitter on/off semantics; lib.dom uses addEventListener.
// the rpc kernel uses on/off, so node ports work directly with one wrap to
// satisfy the structural type.
export function nodePortToRpcPort(port: NodeMessagePort): RpcPort {
    return {
        postMessage(value: unknown): void {
            port.postMessage(value);
        },
        close(): void {
            port.close();
        },
        on(event: "message" | "close", listener: never): void {
            port.on(event, listener);
        },
        off(event: "message" | "close", listener: never): void {
            port.off(event, listener);
        }
    };
}
