import { expect } from "chai";
import { MessageChannel } from "node:worker_threads";
import { WorkerClient } from "@/utils/worker/WorkerClient";
import { AWorkerHost } from "@/utils/worker/AWorkerHost";
import type {
    WorkerClientTransport,
    WorkerHostTransport
} from "@/utils/worker/types";
import type { Neighbour } from "@/utils/GossipNode";
import { createLogger } from "@/utils";
import { LogUploader } from "@/utils/logging/LogUploader";
import { LogStore } from "@/utils/logging/logStore";

// Counts uploadLogs() calls without network I/O (mirrors LoggerApplyOp.test.ts).
class FakeUploader extends LogUploader {
    public uploadCount = 0;
    protected attachListeners(): void {}
    protected detachListeners(): void {}
    public async uploadLogs(): Promise<void> {
        this.uploadCount++;
    }
}

function makeRealLogger(threadName: string) {
    const shared = { threadName } as Record<string, unknown>;
    const uploader = new FakeUploader(
        new LogStore(1024, true),
        { uploadEndpoint: "http://example.test", apiToken: "" },
        { component: threadName },
        shared as any
    );
    const logger = createLogger(
        shared as any,
        { component: threadName },
        { logUploader: uploader, level: "info" }
    );
    return { logger, uploader };
}

function portNeighbour(port: {
    postMessage: (m: unknown) => void;
    on: (e: "message", h: (m: unknown) => void) => void;
}): Neighbour {
    return {
        post: (msg) => port.postMessage(msg),
        subscribe: (handler) => port.on("message", handler)
    };
}

// Connect a client and a host over two in-process MessageChannels (RPC + gossip),
// no real worker thread.
function connectInProcess() {
    const rpc = new MessageChannel();
    const gossip = new MessageChannel();
    const clientTransport: WorkerClientTransport = {
        post: (env) => rpc.port1.postMessage(env),
        onMessage: (h) => rpc.port1.on("message", h as any),
        onError: () => {},
        terminate: () => {
            rpc.port1.close();
            rpc.port2.close();
            gossip.port1.close();
            gossip.port2.close();
        },
        gossipNeighbour: portNeighbour(gossip.port1 as any)
    };
    const hostTransport: WorkerHostTransport = {
        post: (res) => rpc.port2.postMessage(res),
        onMessage: (h) => rpc.port2.on("message", h as any),
        gossipNeighbour: portNeighbour(gossip.port2 as any)
    };
    return { clientTransport, hostTransport, gossip };
}

class DoublingHost extends AWorkerHost<number, number> {
    protected async handle(n: number): Promise<number> {
        if (n < 0) throw new Error("negative");
        return n * 2;
    }
}

describe("worker base", function () {
    it("request round-trips through the host's handle", async function () {
        const { clientTransport, hostTransport } = connectInProcess();
        new DoublingHost(hostTransport);
        const client = new WorkerClient<number, number>(clientTransport);
        const result = await client.request(21);
        expect(result).to.equal(42);
        await client.dispose();
    });

    it("a throwing handle rejects the client's request with the error message", async function () {
        const { clientTransport, hostTransport } = connectInProcess();
        new DoublingHost(hostTransport);
        const client = new WorkerClient<number, number>(clientTransport);
        let message = "";
        try {
            await client.request(-1);
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message).to.equal("negative");
        await client.dispose();
    });

    it("inbound gossip from the worker reaches a logger attached on the client", async function () {
        const { clientTransport, gossip } = connectInProcess();
        const client = new WorkerClient<number, number>(clientTransport);

        const applied: unknown[] = [];
        const fakeLogger = {
            applyOp: (op: unknown) => applied.push(op),
            setGossipNode: () => {}
        } as any;
        client.attachLogger(fakeLogger);

        // Simulate the worker side posting a gossip op into the dedicated port; it
        // must reach the client logger's applyOp via the client's GossipNode.
        gossip.port2.postMessage({ type: "flush" });
        await new Promise((r) => setTimeout(r, 30)); // yield to the event loop for async MessagePort delivery

        expect(applied).to.deep.equal([{ type: "flush" }]);
        await client.dispose();
    });

    it("inbound gossip from the parent reaches a logger attached on the host", async function () {
        const { hostTransport, gossip } = connectInProcess();
        const applied: unknown[] = [];
        class AttachableHost extends AWorkerHost<number, number> {
            protected async handle(n: number): Promise<number> {
                return n;
            }
            attachForTest(logger: unknown): void {
                this.attachLogger(logger as any);
            }
        }
        const host = new AttachableHost(hostTransport);
        host.attachForTest({
            applyOp: (op: unknown) => applied.push(op),
            setGossipNode: () => {}
        });

        // Parent posts a gossip op into the host's dedicated port (gossip.port1 →
        // port2, which the host subscribes to).
        gossip.port1.postMessage({ type: "flush" });
        await new Promise((r) => setTimeout(r, 30)); // yield for MessagePort delivery

        expect(applied).to.deep.equal([{ type: "flush" }]);
    });

    // Worker → main report-bug cascade through REAL Loggers: a report-bug on the
    // worker flushes its own store AND reaches the main logger's uploader.
    it("worker-originated report-bug flushes its own store and cascades to the main logger", async function () {
        const { clientTransport, hostTransport } = connectInProcess();

        class AttachableHost extends AWorkerHost<number, number> {
            protected async handle(n: number): Promise<number> {
                return n;
            }
            attachForTest(logger: unknown): void {
                this.attachLogger(logger as any);
            }
        }
        const host = new AttachableHost(hostTransport);
        const client = new WorkerClient<number, number>(clientTransport);

        const worker = makeRealLogger("evm");
        const main = makeRealLogger("sdk");
        host.attachForTest(worker.logger);
        client.attachLogger(main.logger);

        // Originate on the worker side.
        await worker.logger.uploadLogs("worker report-bug");
        await new Promise((r) => setTimeout(r, 30)); // yield for gossip MessagePort delivery

        expect(worker.uploader.uploadCount).to.equal(1); // flushed its own store
        expect(main.uploader.uploadCount).to.equal(1); // cascaded to main
        await client.dispose();
    });
});
