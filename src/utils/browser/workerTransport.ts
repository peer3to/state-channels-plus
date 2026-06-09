import type { Neighbour } from "@/utils/GossipNode";
import type {
    WorkerClientTransport,
    WorkerHostTransport,
    WorkerResult
} from "@/utils/worker/types";

export type GossipInitMessage = { __gossipInit: true; port: MessagePort };

// Spawn a module worker; gossip port transferred via a sentinel init message (no transferList in the browser Worker ctor).
export function createWorkerClientTransport(entry: {
    url: URL;
}): WorkerClientTransport {
    const worker = new Worker(entry.url, { type: "module" });

    const gossip = new MessageChannel();
    const init: GossipInitMessage = { __gossipInit: true, port: gossip.port2 };
    worker.postMessage(init, [gossip.port2]);

    let errorHandler: ((e: Error) => void) | undefined;
    worker.onerror = (event: ErrorEvent) => {
        errorHandler?.(new Error(event.message || "Worker failed"));
    };
    worker.onmessageerror = () => {
        errorHandler?.(new Error("Worker message could not be cloned"));
    };

    const port1 = gossip.port1;
    const gossipNeighbour: Neighbour = {
        post: (msg) => port1.postMessage(msg),
        subscribe: (handler) => {
            const listener = (event: MessageEvent) => handler(event.data);
            // addEventListener (vs onmessage=) is removable; start() is required as it doesn't auto-start.
            port1.addEventListener("message", listener);
            port1.start();
            return () => port1.removeEventListener("message", listener);
        }
    };

    return {
        post: (envelope) => worker.postMessage(envelope),
        onMessage: (handler) => {
            worker.onmessage = (event: MessageEvent<WorkerResult<unknown>>) =>
                handler(event.data);
        },
        onError: (handler) => {
            errorHandler = handler;
        },
        terminate: () => {
            port1.close();
            return worker.terminate();
        },
        gossipNeighbour
    };
}

// Host entry peels the gossip port off its first message and passes it here.
export function createWorkerHostTransport(
    gossipPort: MessagePort
): WorkerHostTransport {
    const gossipNeighbour: Neighbour = {
        post: (msg) => gossipPort.postMessage(msg),
        subscribe: (handler) => {
            const listener = (event: MessageEvent) => handler(event.data);
            gossipPort.addEventListener("message", listener);
            gossipPort.start();
            return () => gossipPort.removeEventListener("message", listener);
        }
    };
    return {
        post: (result) => globalThis.postMessage(result),
        onMessage: (handler) => {
            globalThis.onmessage = (event: MessageEvent) => handler(event.data);
        },
        gossipNeighbour
    };
}
