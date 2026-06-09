import { expect } from "chai";
import { MessageChannel } from "node:worker_threads";
import { WorkerClient } from "@/utils/worker/WorkerClient";
import { AWorkerHost } from "@/utils/worker/AWorkerHost";
import type {
    WorkerClientTransport,
    WorkerHostTransport
} from "@/utils/worker/types";
import { GossipNode, type Neighbour } from "@/utils/GossipNode";
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
    off: (e: "message", h: (m: unknown) => void) => void;
}): Neighbour {
    return {
        post: (msg) => port.postMessage(msg),
        subscribe: (handler) => {
            port.on("message", handler);
            return () => port.off("message", handler);
        }
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

// A host that exposes its gossip node so a test logger can self-wire to it.
class AttachableHost extends AWorkerHost<number, number> {
    protected async handle(n: number): Promise<number> {
        return n;
    }
    attachForTest(logger: unknown): void {
        (logger as any).setGossipNode(this.gossipNode);
    }
}

const yieldGossip = () => new Promise((r) => setTimeout(r, 30));

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
            setGossipNode: (node: GossipNode) =>
                node.setLocalHandler((op) => fakeLogger.applyOp(op))
        } as any;
        fakeLogger.setGossipNode(client.gossipNode);

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
                (logger as any).setGossipNode(this.gossipNode);
            }
        }
        const host = new AttachableHost(hostTransport);
        const fakeLogger = {
            applyOp: (op: unknown) => applied.push(op),
            setGossipNode: (node: GossipNode) =>
                node.setLocalHandler((op) => fakeLogger.applyOp(op))
        };
        host.attachForTest(fakeLogger);

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
                (logger as any).setGossipNode(this.gossipNode);
            }
        }
        const host = new AttachableHost(hostTransport);
        const client = new WorkerClient<number, number>(clientTransport);

        const worker = makeRealLogger("evm");
        const main = makeRealLogger("sdk");
        host.attachForTest(worker.logger);
        main.logger.setGossipNode(client.gossipNode);

        await worker.logger.uploadLogs("worker report-bug");
        await new Promise((r) => setTimeout(r, 30)); // yield for gossip MessagePort delivery

        expect(worker.uploader.uploadCount).to.equal(1); // flushed its own store
        expect(main.uploader.uploadCount).to.equal(1); // cascaded to main
        await client.dispose();
    });

    // Star M → {W1, W2}: one node shared across two clients fans main's flush to both,
    // and relays a worker's flush to main + the sibling (skip-sender), never to itself.
    it("a shared node fans a main flush to both workers and relays worker→worker", async function () {
        const a = connectInProcess();
        const b = connectInProcess();

        const gMain = new GossipNode();
        const client1 = new WorkerClient<number, number>(
            a.clientTransport,
            gMain
        );
        const client2 = new WorkerClient<number, number>(
            b.clientTransport,
            gMain
        );
        const host1 = new AttachableHost(a.hostTransport);
        const host2 = new AttachableHost(b.hostTransport);

        const main = makeRealLogger("main");
        const w1 = makeRealLogger("w1");
        const w2 = makeRealLogger("w2");
        main.logger.setGossipNode(client1.gossipNode); // attach root logger to the shared node once
        host1.attachForTest(w1.logger);
        host2.attachForTest(w2.logger);

        // main-originated flush fans to BOTH workers (and applies on main).
        await main.logger.uploadLogs("main report-bug");
        await yieldGossip();
        expect(main.uploader.uploadCount, "main applies own flush").to.equal(1);
        expect(w1.uploader.uploadCount, "fan to w1").to.equal(1);
        expect(w2.uploader.uploadCount, "fan to w2").to.equal(1);

        // worker1-originated flush relays to main AND to worker2, never back to w1.
        await w1.logger.uploadLogs("w1 report-bug");
        await yieldGossip();
        expect(
            w1.uploader.uploadCount,
            "w1 applies own flush, no echo"
        ).to.equal(2);
        expect(main.uploader.uploadCount, "relayed up to main").to.equal(2);
        expect(w2.uploader.uploadCount, "relayed across to w2").to.equal(2);

        await client1.dispose();
        await client2.dispose();
        gMain.close();
    });

    // Line M–A–B: A shares one node across its host (up to M) and client (down to B),
    // so a flush from either end is applied on A and relayed to the far end, once.
    it("an intermediate thread relays gossip across a shared node (M–A–B line)", async function () {
        const ma = connectInProcess(); // M(client) ↔ A(host)
        const ab = connectInProcess(); // A(client) ↔ B(host)

        const gA = new GossipNode(); // A's single node, shared up + down
        const hostA = new AttachableHost(ma.hostTransport, gA); // up-edge to M
        const clientA = new WorkerClient<number, number>(
            ab.clientTransport,
            gA
        ); // down-edge to B

        const clientM = new WorkerClient<number, number>(ma.clientTransport);
        const hostB = new AttachableHost(ab.hostTransport);

        const M = makeRealLogger("M");
        const A = makeRealLogger("A");
        const B = makeRealLogger("B");
        M.logger.setGossipNode(clientM.gossipNode);
        hostA.attachForTest(A.logger); // sets gA's local handler to A's logger
        hostB.attachForTest(B.logger);

        // flush from B: applied on A, relayed up to M.
        await B.logger.uploadLogs("from B");
        await yieldGossip();
        expect(B.uploader.uploadCount, "B applies own flush").to.equal(1);
        expect(A.uploader.uploadCount, "applied on intermediate A").to.equal(1);
        expect(M.uploader.uploadCount, "relayed up to M").to.equal(1);

        // flush from M: applied on A, relayed down to B.
        await M.logger.uploadLogs("from M");
        await yieldGossip();
        expect(M.uploader.uploadCount, "M applies own flush").to.equal(2);
        expect(A.uploader.uploadCount, "applied on intermediate A").to.equal(2);
        expect(B.uploader.uploadCount, "relayed down to B").to.equal(2);

        await clientM.dispose();
        await clientA.dispose();
        gA.close();
    });
});
