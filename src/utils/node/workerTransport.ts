import type { Neighbour } from "@/utils/GossipNode";
import type {
    WorkerClientTransport,
    WorkerEnvelope,
    WorkerHostTransport,
    WorkerResult
} from "@/utils/worker/types";

// Spawn a worker from dir + basename (.js/.ts + ts-node resolution mirrors the prior
// runtime); its gossip port is transferred via workerData.
export function createWorkerClientTransport(entry: {
    dir: string;
    basename: string;
}): WorkerClientTransport {
    const nodeRequire = typeof require === "function" ? require : undefined;
    if (!nodeRequire) {
        throw new Error("Node worker_threads require() is unavailable");
    }
    const path = nodeRequire("node:path") as typeof import("node:path");
    const fs = nodeRequire("node:fs") as typeof import("node:fs");
    const { Worker, MessageChannel } = nodeRequire(
        "node:worker_threads"
    ) as typeof import("node:worker_threads");

    const jsPath = path.join(entry.dir, `${entry.basename}.js`);
    const tsPath = path.join(entry.dir, `${entry.basename}.ts`);
    const workerPath = fs.existsSync(jsPath) ? jsPath : tsPath;
    const execArgv = workerPath.endsWith(".ts")
        ? ["-r", "ts-node/register", "-r", "tsconfig-paths/register"]
        : undefined;

    const gossip = new MessageChannel();
    const worker = new Worker(workerPath, {
        execArgv,
        workerData: { gossipPort: gossip.port2 },
        transferList: [gossip.port2]
    });

    let messageHandler: ((r: WorkerResult<unknown>) => void) | undefined;
    let errorHandler: ((e: Error) => void) | undefined;
    worker.on("message", (m) => messageHandler?.(m as WorkerResult<unknown>));
    worker.on("error", (e) => errorHandler?.(e));
    worker.on("exit", (code: number) => {
        if (code !== 0) {
            errorHandler?.(new Error(`Worker exited with ${code}`));
        }
    });

    const port1 = gossip.port1;
    const gossipNeighbour: Neighbour = {
        post: (msg) => port1.postMessage(msg),
        subscribe: (handler) => port1.on("message", handler)
    };

    return {
        post: (envelope) => worker.postMessage(envelope),
        onMessage: (handler) => {
            messageHandler = handler;
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

export function createWorkerHostTransport(): WorkerHostTransport {
    const nodeRequire = typeof require === "function" ? require : undefined;
    if (!nodeRequire) {
        throw new Error("Node worker_threads require() is unavailable");
    }
    const { parentPort, workerData } = nodeRequire(
        "node:worker_threads"
    ) as typeof import("node:worker_threads");
    if (!parentPort) {
        throw new Error("Worker host requires a parent port");
    }
    const rpc = parentPort;
    const gossipPort = (
        workerData as { gossipPort: import("node:worker_threads").MessagePort }
    ).gossipPort;
    const gossipNeighbour: Neighbour = {
        post: (msg) => gossipPort.postMessage(msg),
        subscribe: (handler) => gossipPort.on("message", handler)
    };
    let messageHandler:
        | ((envelope: WorkerEnvelope<unknown>) => void)
        | undefined;
    rpc.on("message", (m) => messageHandler?.(m as WorkerEnvelope<unknown>));
    return {
        post: (result) => rpc.postMessage(result),
        onMessage: (handler) => {
            messageHandler = handler;
        },
        gossipNeighbour
    };
}
