import {
    MessageChannel,
    parentPort,
    type MessagePort
} from "node:worker_threads";
import type { RuntimeChannel, RuntimePort } from "../types";

/**
 * Adapt a Node `worker_threads` {@link MessagePort} to the platform-neutral
 * {@link RuntimePort} surface used by the p2p runtime protocol.
 */
export function adaptPort(port: MessagePort): RuntimePort {
    return {
        post(message: unknown, transfer?: unknown[]) {
            port.postMessage(message, transfer as readonly MessagePort[]);
        },
        onMessage(handler: (message: unknown) => void) {
            // Attaching a 'message' listener implicitly starts the port.
            port.on("message", handler);
        },
        start() {
            port.start?.();
        },
        onClose(handler: () => void) {
            // Node fires 'close' on a port once either side disconnects.
            port.on("close", handler);
        },
        close() {
            port.close();
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

/** this worker's parent port, for an entry that serves the thread above it */
export function adaptWorkerScope(): RuntimePort {
    if (!parentPort) {
        throw new Error(
            "adaptWorkerScope must be executed inside a worker thread"
        );
    }
    return adaptPort(parentPort);
}
