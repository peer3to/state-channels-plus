/**
 * The capacity driver's peer threads (capacityPeers.ts), on this machine or on
 * other hosts. Both answer the same messages: `add`, `take` and `stop`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { Worker } from "node:worker_threads";

/** A thread hosting peers, wherever it runs. */
export type PeerThread = {
    ask<T>(message: unknown): Promise<T>;
    close(): Promise<void>;
};

/** The prefix of the lines a peer host answers with on its standard output. */
export const PEER_HOST_LINE = "@@peer ";

/** A worker thread hosting peers, and a way to wait for its next answer. */
export class PeerWorker implements PeerThread {
    readonly worker: Worker;
    private readonly waiting: ((message: { type: string }) => void)[] = [];

    constructor(nodeUrl: string) {
        this.worker = new Worker(require.resolve("./capacityPeers.ts"), {
            workerData: { nodeUrl },
            execArgv: [
                "-r",
                "ts-node/register/transpile-only",
                "-r",
                "tsconfig-paths/register"
            ],
            env: { ...process.env, TS_NODE_PROJECT: "tsconfig.json" }
        });
        this.worker.on("message", (message: { type: string }) =>
            this.waiting.shift()?.(message)
        );
    }

    ask<T>(message: unknown): Promise<T> {
        return new Promise((resolve) => {
            this.waiting.push((answer) => resolve(answer as T));
            this.worker.postMessage(message);
        });
    }

    async close(): Promise<void> {
        await this.ask({ type: "stop" });
        await this.worker.terminate();
    }
}

/**
 * Peer threads on another host: `capacityPeerHost.ts` started there over ssh,
 * which relays each message to its thread and the answer back as a line.
 */
export class PeerHost {
    readonly threads: PeerThread[];
    private readonly child: ChildProcessWithoutNullStreams;
    // request id -> what waits for its answer
    private readonly waiting = new Map<
        number,
        { resolve: (answer: unknown) => void; reject: (error: Error) => void }
    >();
    private nextId = 0;
    private readonly exited: Promise<void>;

    private constructor(
        host: string,
        { dir, node, nodeUrl, threads }: PeerHostOptions
    ) {
        this.child = spawn("ssh", [
            "-o",
            "BatchMode=yes",
            host,
            `cd ${dir} && ulimit -n 65536 && TS_NODE_PROJECT=tsconfig.json exec ${node} ` +
                "-r ts-node/register/transpile-only -r tsconfig-paths/register " +
                `scripts/bench/capacityPeerHost.ts ${nodeUrl} ${threads}`
        ]);
        this.child.stderr.pipe(process.stderr);
        this.exited = new Promise((resolve) =>
            this.child.once("exit", (code) => {
                // a host that died answers nothing more: fail what waits
                for (const { reject } of this.waiting.values())
                    reject(new Error(`peer host ${host} exited with ${code}`));
                this.waiting.clear();
                resolve();
            })
        );
        createInterface({ input: this.child.stdout }).on("line", (line) => {
            if (!line.startsWith(PEER_HOST_LINE)) return;
            const { id, answer } = JSON.parse(
                line.slice(PEER_HOST_LINE.length)
            ) as { id: number; answer: unknown };
            const waiter = this.waiting.get(id);
            this.waiting.delete(id);
            waiter?.resolve(answer);
        });
        this.threads = Array.from({ length: threads }, (_, thread) => ({
            ask: <T>(message: unknown) => this.ask<T>(thread, message),
            close: async () => {
                await this.ask(thread, { type: "stop" });
            }
        }));
    }

    static start(host: string, options: PeerHostOptions): PeerHost {
        return new PeerHost(host, options);
    }

    /** Ends the host's process once its threads stopped. */
    async close(): Promise<void> {
        this.child.stdin.end();
        await this.exited;
    }

    private ask<T>(thread: number, message: unknown): Promise<T> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.waiting.set(id, {
                resolve: (answer) => resolve(answer as T),
                reject
            });
            this.child.stdin.write(
                JSON.stringify({ id, thread, message }) + "\n"
            );
        });
    }
}

type PeerHostOptions = {
    /** The state-channels-plus checkout on the host. */
    dir: string;
    /** The host's node.js binary. */
    node: string;
    /** The RPC node as the host reaches it. */
    nodeUrl: string;
    threads: number;
};
