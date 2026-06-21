import type { RuntimeChannel, RuntimePort } from "../types";

/**
 * Adapt a browser {@link MessagePort} to the platform-neutral
 * {@link RuntimePort} surface used by the p2p runtime protocol.
 */
export function adaptPort(port: MessagePort): RuntimePort {
    return {
        post(message: unknown, transfer?: unknown[]) {
            port.postMessage(message, (transfer as Transferable[]) ?? []);
        },
        onMessage(handler: (message: unknown) => void) {
            port.addEventListener("message", (event: MessageEvent) => {
                handler(event.data);
            });
            port.start();
        },
        start() {
            port.start();
        },
        onClose(handler: () => void) {
            // Best-effort: the 'close' event isn't supported everywhere.
            port.addEventListener("close", () => handler());
        },
        close() {
            port.close();
        }
    };
}

/** Create a linked pair of in-process ports backed by a MessageChannel. */
export function createRuntimeChannel(): RuntimeChannel {
    const channel = new MessageChannel();
    return {
        port1: adaptPort(channel.port1),
        port2: adaptPort(channel.port2)
    };
}

/**
 * Create a channel whose local port is adapted for in-process use and whose
 * remote port is returned raw so it can be transferred to a worker.
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
