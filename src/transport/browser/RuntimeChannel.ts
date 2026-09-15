import type { RuntimeChannel, RuntimePort } from "../RuntimePort";

/**
 * Adapt a browser {@link MessagePort} to the platform-neutral
 * {@link RuntimePort} surface used by the p2p runtime protocol.
 */
export function adaptPort(port: unknown): RuntimePort {
    // The same adapter receives a transferred MessagePort or the worker global scope.
    const browserPort = port as Pick<
        MessagePort,
        "postMessage" | "addEventListener" | "removeEventListener"
    > &
        Partial<Pick<MessagePort, "start" | "close">>;
    return {
        post(message: unknown, transfer?: unknown[]) {
            browserPort.postMessage(
                message,
                (transfer as Transferable[]) ?? []
            );
        },
        onMessage(handler: (message: unknown) => void) {
            const listener = (event: MessageEvent) => handler(event.data);
            browserPort.addEventListener("message", listener);
            browserPort.start?.();
            return () => browserPort.removeEventListener("message", listener);
        },
        start() {
            browserPort.start?.();
        },
        onClose(handler: () => void) {
            // Best-effort: the 'close' event isn't supported everywhere.
            browserPort.addEventListener("close", handler);
            return () => browserPort.removeEventListener("close", handler);
        },
        close() {
            browserPort.close?.();
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
