import * as path from "node:path";
import { Worker } from "node:worker_threads";

import { PeerCaller } from "./rpc/PeerCaller";
import { PeerHandler } from "./rpc/PeerHandler";
import type { RpcPort } from "./rpc/rpc-types";
import { ROUTES } from "./worker/routeNames";
import {
    type CrashPayload,
    type DetachedRejectionPayload,
    type WorkerData
} from "./worker/types";

type DisposeResult =
    | { kind: "graceful"; durationMs: number }
    | { kind: "forced"; reason: "timeout" | "crashed" | "exited" };

type PeerWorkerEvent = "exit" | "error" | "crash" | "detached-rejection";
type Listener = (...args: unknown[]) => void;

const DEFAULT_BOOT_TIMEOUT_MS = 60_000;

const WORKER_PUSH = {
    ready: "lifecycle.ready",
    crash: "lifecycle.crash",
    detachedRejection: "lifecycle.detachedRejection"
} as const;

export class PeerWorker {
    readonly index: number;
    readonly peerAddress: string;

    private listeners = new Map<PeerWorkerEvent, Set<Listener>>();
    private disposed = false;

    private constructor(
        index: number,
        peerAddress: string,
        private readonly worker: Worker,
        private readonly rpc: PeerCaller,
        private readonly server: PeerHandler
    ) {
        this.index = index;
        this.peerAddress = peerAddress;
        this.worker.on("exit", (code) => this.emit("exit", code));
        this.worker.on("error", (err) => this.emit("error", err));
    }

    static async spawn(
        args: WorkerData,
        opts?: { bootTimeoutMs?: number }
    ): Promise<PeerWorker> {
        const entry = path.join(__dirname, "worker", "entry.ts");
        const worker = new Worker(entry, {
            execArgv: [
                "--require",
                "ts-node/register",
                "--require",
                "tsconfig-paths/register"
            ],
            workerData: args
        });

        const rpcPort = PeerWorker.workerToRpcPort(worker);
        const rpc = new PeerCaller(rpcPort);
        const server = new PeerHandler(rpcPort);

        let ready: { peerAddress: string };
        try {
            ready = await PeerWorker.waitForReady(
                rpc,
                worker,
                opts?.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS
            );
        } catch (e) {
            rpc.dispose();
            server.dispose();
            await worker.terminate().catch(() => undefined);
            throw e;
        }

        const instance = new PeerWorker(
            args.index,
            ready.peerAddress,
            worker,
            rpc,
            server
        );

        rpc.on(WORKER_PUSH.crash, (payload) =>
            instance.emit("crash", payload as CrashPayload)
        );
        rpc.on(WORKER_PUSH.detachedRejection, (payload) =>
            instance.emit(
                "detached-rejection",
                payload as DetachedRejectionPayload
            )
        );

        return instance;
    }

    getRpcClient(): PeerCaller {
        return this.rpc;
    }
    getRpcServer(): PeerHandler {
        return this.server;
    }

    on(event: PeerWorkerEvent, listener: Listener): this {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener);
        return this;
    }

    async dispose(opts?: { graceMs?: number }): Promise<DisposeResult> {
        if (this.disposed) return { kind: "forced", reason: "exited" };
        this.disposed = true;
        const graceMs = opts?.graceMs ?? 5_000;
        const start = Date.now();

        let timedOut = false;
        try {
            await Promise.race([
                this.rpc.call(ROUTES.lifecycle.dispose, {}),
                new Promise<never>((_, reject) =>
                    setTimeout(() => {
                        timedOut = true;
                        reject(new Error("dispose timeout"));
                    }, graceMs)
                )
            ]);
        } catch {
            this.rpc.dispose();
            this.server.dispose();
            await this.worker.terminate().catch(() => undefined);
            return { kind: "forced", reason: timedOut ? "timeout" : "crashed" };
        }

        this.rpc.dispose();
        this.server.dispose();
        await this.worker.terminate().catch(() => undefined);
        return { kind: "graceful", durationMs: Date.now() - start };
    }

    private emit(event: PeerWorkerEvent, ...args: unknown[]): void {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const listener of set) {
            try {
                listener(...args);
            } catch {
                /* listener errors don't propagate */
            }
        }
    }

    // close() is a no-op — PeerWorker.dispose() owns worker.terminate().
    private static workerToRpcPort(worker: Worker): RpcPort {
        return {
            postMessage: (v) => worker.postMessage(v),
            close: () => {},
            on(event, listener) {
                if (event === "message")
                    worker.on("message", listener as (v: unknown) => void);
                else worker.on("exit", listener as () => void);
            },
            off(event, listener) {
                if (event === "message")
                    worker.off("message", listener as (v: unknown) => void);
                else worker.off("exit", listener as () => void);
            }
        };
    }

    private static waitForReady(
        rpc: PeerCaller,
        worker: Worker,
        timeoutMs: number
    ): Promise<{ peerAddress: string }> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (
                err: Error | null,
                payload?: { peerAddress: string }
            ): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                rpc.off(WORKER_PUSH.ready, onReady);
                rpc.off(WORKER_PUSH.crash, onCrash);
                worker.off("exit", onExit);
                if (err) reject(err);
                else resolve(payload!);
            };

            const timer = setTimeout(
                () =>
                    settle(
                        new Error(
                            `PeerWorker.spawn boot-timeout after ${timeoutMs}ms`
                        )
                    ),
                timeoutMs
            );
            const onReady = (p: unknown) =>
                settle(null, p as { peerAddress: string });
            const onCrash = (p: unknown) => {
                const c = p as CrashPayload;
                const err = new Error(
                    `worker crash in phase '${c.phase ?? "<unknown>"}': ${c.message}`
                );
                err.name = c.name;
                if (c.stack) err.stack = c.stack;
                settle(err);
            };
            const onExit = (code: number) =>
                settle(
                    new Error(
                        `worker exited (code ${code}) before lifecycle.ready`
                    )
                );

            rpc.on(WORKER_PUSH.ready, onReady);
            rpc.on(WORKER_PUSH.crash, onCrash);
            worker.on("exit", onExit);
        });
    }
}
