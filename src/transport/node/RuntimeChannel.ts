import type { RuntimeChannel, RuntimePort } from "../RuntimePort";
import { MessageChannel, type MessagePort } from "node:worker_threads";

/**
 * Adapt a Node `worker_threads` {@link MessagePort} to the platform-neutral
 * {@link RuntimePort} surface used by the p2p runtime protocol.
 */
export function adaptPort(
    port:
        | (Pick<MessagePort, "postMessage"> & {
              on(event: string, listener: (...args: any[]) => void): unknown;
              off(event: string, listener: (...args: any[]) => void): unknown;
              start?(): void;
              close?(): void;
          })
        | globalThis.MessagePort
): RuntimePort {
    if (!("on" in port)) throw new Error("Expected a Node MessagePort");
    return {
        post(message: unknown, transfer?: unknown[]) {
            port.postMessage(message, transfer as readonly MessagePort[]);
        },
        onMessage(handler: (message: unknown) => void) {
            // Attaching a 'message' listener implicitly starts the port.
            port.on("message", handler);
            return () => {
                port.off("message", handler);
            };
        },
        start() {
            port.start?.();
        },
        onClose(handler: () => void) {
            // Node fires 'close' on a port once either side disconnects.
            port.on("close", handler);
            return () => {
                port.off("close", handler);
            };
        },
        close() {
            port.close?.();
        }
    };
}

/** Create a linked pair of in-process ports backed by a Node MessageChannel. */
export function createRuntimeChannel(): RuntimeChannel {
    const channel = new MessageChannel();
    return {
        port1: adaptPort(channel.port1),
        port2: adaptPort(channel.port2)
    };
}

/**
 * Create a channel whose local port is adapted for in-process use and whose
 * remote port is returned raw so it can be transferred to a worker thread.
 */
export function createTransferableChannel(): {
    localPort: RuntimePort;
    transferablePort: unknown;
} {
    const channel = new MessageChannel();
    return {
        localPort: adaptPort(channel.port1),
        transferablePort: channel.port2
    };
}
