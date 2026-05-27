// W2 - orchestrator-side handle. spawns a node worker_thread, talks to it
// over the worker's built-in parentPort (one port total per D-21). exposes
// an RpcClient for the W1 sub-handle surface to ride.
//
// D-19 - throws UnsupportedInWorkerMode if customPrecompiles/rpcServiceFactories
// arrive non-empty.
// D-20 - bootstrap is two phases ('boot' + 'p2pSetup'); p2pSetup is W5-deferred.
// D-21 - one MessagePort, lifecycle frames ride W3's {kind} envelope.

import * as path from "node:path";
import { Worker } from "node:worker_threads";

import { RpcClient } from "./rpc/rpc-client";
import { RpcServer } from "./rpc/rpc-server";
import type { RpcPort } from "./rpc/rpc-types";
import {
    LIFECYCLE_PUSH,
    LIFECYCLE_RPC,
    type CrashPayload,
    type DetachedRejectionPayload,
    type ReadyPayload,
    type SerializableHarnessConfig
} from "./worker/types";

export type PeerWorkerSpawnArgs = {
    index: number;
    signerPk: string;
    channelId: string;
    discoveryRegistryPort: number;
    channelManagerAddress: string;
    deploymentName: string;
    harnessConfig: SerializableHarnessConfig;
    logConfig: {
        level: "debug" | "verbose" | "info" | "warn" | "error";
        peerIndex: number;
    };
    testTitle: string;
    // step 1 - bundle manifest. W2 §4.5 - import paths for per-suite
    // deployments / op tables. worker imports each at boot via dynamic import.
    bundleManifest: string[];
    // step 2 - D-19 unsupported-in-worker probes. spawn throws if either is
    // set; orchestrator-side caller validates against options up front.
    customPrecompilesNonEmpty?: boolean;
    rpcServiceFactoriesNonEmpty?: boolean;
    // step 3 - W6 loop-delay guard threshold. default 1000ms per D-9. one knob,
    // session-wide. forwarded into the worker via workerData.
    loopDelayMaxMs?: number;
    // W5 - chain provider URL for the worker. JsonRpcProvider against an
    // HTTP-served chain (e.g. `hardhat node`). when undefined the worker stops
    // after `boot` (no chain -> no p2pSetup). hre.ethers.provider is per-isolate
    // and cannot be shared across worker boundaries -> requires an HTTP endpoint
    // or a chain-proxy seam (see docs/parallel-plan-v2/W5-evm-in-thread-seam.md).
    chainProviderUrl?: string;
};

export type SpawnOpts = {
    bootTimeoutMs?: number;
};

export type DisposeResult =
    | { kind: "graceful"; durationMs: number }
    | { kind: "forced"; reason: "timeout" | "crashed" | "exited" };

export class UnsupportedInWorkerMode extends Error {
    constructor(field: string) {
        super(
            `PeerWorker: '${field}' is not supported in worker mode (D-19). ` +
                `add a string-keyed registry mirroring deploymentRegistry and ` +
                `remove this throw when a real test demands it.`
        );
        this.name = "UnsupportedInWorkerMode";
    }
}

// step 1 - boot timeout defaults. first spawn pays ts-node cold compile.
// see W2-review-r2 N-2 (IOU on citing v1 values); 60s is conservative.
const DEFAULT_BOOT_TIMEOUT_MS = 60_000;

type PeerWorkerEvent =
    | "exit"
    | "error"
    | "crash"
    | "detached-rejection"
    | "log";
type Listener = (...args: unknown[]) => void;

export class PeerWorker {
    readonly index: number;
    readonly peerAddress: string;

    private listeners = new Map<PeerWorkerEvent, Set<Listener>>();
    private disposed = false;

    private constructor(
        index: number,
        peerAddress: string,
        private readonly worker: Worker,
        private readonly rpc: RpcClient,
        // step 1 - bidirectional. orchestrator-side server handles req frames
        // initiated by the worker (e.g. tamper-bridge callbacks). registered
        // handlers live in the PeerTestHarness layer.
        private readonly server: RpcServer
    ) {
        this.index = index;
        this.peerAddress = peerAddress;

        // step 1 - worker process events -> orchestrator listeners
        this.worker.on("exit", (code) => this.emit("exit", code));
        this.worker.on("error", (err) => this.emit("error", err));
    }

    static async spawn(
        args: PeerWorkerSpawnArgs,
        opts?: SpawnOpts
    ): Promise<PeerWorker> {
        // step 1 - D-19 guard before we burn worker spawn cost on a config that
        // can't run.
        if (args.customPrecompilesNonEmpty) {
            throw new UnsupportedInWorkerMode("customPrecompiles");
        }
        if (args.rpcServiceFactoriesNonEmpty) {
            throw new UnsupportedInWorkerMode("rpcServiceFactories");
        }

        // step 1 - ts-node shim re-registers per-isolate (W2 §8).
        const entry = path.join(__dirname, "worker", "entry.js");

        const worker = new Worker(entry, {
            workerData: {
                index: args.index,
                signerPk: args.signerPk,
                channelId: args.channelId,
                discoveryRegistryPort: args.discoveryRegistryPort,
                channelManagerAddress: args.channelManagerAddress,
                deploymentName: args.deploymentName,
                harnessConfig: args.harnessConfig,
                logConfig: args.logConfig,
                testTitle: args.testTitle,
                bundleManifest: args.bundleManifest,
                // step 1 - W6 - default 1000ms per D-9; orchestrator overrides
                // via harnessConfig.loopDelayMaxMs (one knob, session-wide).
                loopDelayMaxMs: args.loopDelayMaxMs ?? 1000,
                chainProviderUrl: args.chainProviderUrl
            }
        });

        // step 1 - rpc rides the worker's built-in parentPort. one port total
        // per D-21. orchestrator-side surface is Worker.postMessage / on('close').
        // bidirectional - client handles res/push (worker -> orch), server handles
        // req frames the worker initiates (tamper-bridge callbacks).
        const rpcPort = workerToRpcPort(worker);
        const rpc = new RpcClient(rpcPort);
        const server = new RpcServer(rpcPort);

        const bootTimeoutMs = opts?.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;

        let ready: ReadyPayload;
        try {
            ready = await waitForReady(rpc, worker, bootTimeoutMs);
        } catch (e) {
            // step 1 - boot failure: tear down everything we created
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

        // step 1 - wire post-ready push topics
        rpc.on(LIFECYCLE_PUSH.crash, (payload) => {
            instance.emit("crash", payload as CrashPayload);
        });
        rpc.on(LIFECYCLE_PUSH.detachedRejection, (payload) => {
            instance.emit(
                "detached-rejection",
                payload as DetachedRejectionPayload
            );
        });
        rpc.on(LIFECYCLE_PUSH.log, (payload) => {
            instance.emit("log", payload);
        });

        return instance;
    }

    // step 1 - exposed for W1's WorkerPeer to ride sub-handle rpc surface.
    getRpcClient(): RpcClient {
        return this.rpc;
    }

    // step 1 - orchestrator-side rpc server. handles req frames the worker
    // initiates (tamper-bridge callback hooks). harness registers handlers.
    getRpcServer(): RpcServer {
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

    async drainDetached(opts?: { timeoutMs?: number }): Promise<void> {
        const timeoutMs = opts?.timeoutMs ?? 5_000;
        await Promise.race([
            this.rpc.call(LIFECYCLE_RPC.drainDetached, {}),
            new Promise((resolve) => setTimeout(resolve, timeoutMs))
        ]);
    }

    async dispose(opts?: { graceMs?: number }): Promise<DisposeResult> {
        if (this.disposed) {
            return { kind: "forced", reason: "exited" };
        }
        this.disposed = true;
        const graceMs = opts?.graceMs ?? 5_000;
        const start = Date.now();

        let timedOut = false;
        try {
            await Promise.race([
                this.rpc.call(LIFECYCLE_RPC.dispose, {}),
                new Promise<never>((_, reject) =>
                    setTimeout(() => {
                        timedOut = true;
                        reject(new Error("dispose timeout"));
                    }, graceMs)
                )
            ]);
        } catch {
            // step 1 - timeout or crash -> force-terminate
            this.rpc.dispose();
            this.server.dispose();
            await this.worker.terminate().catch(() => undefined);
            const reason = timedOut ? "timeout" : "crashed";
            return { kind: "forced", reason };
        }

        // step 1 - graceful path
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
                // listener errors are not the orchestrator's problem
            }
        }
    }
}

// step 1 - adapt Worker's built-in port (orchestrator side) to the kernel's
// structural RpcPort. close() is a soft no-op so RpcClient.dispose() doesn't
// terminate the worker; dispose() owns terminate.
function workerToRpcPort(worker: Worker): RpcPort {
    return {
        postMessage(value: unknown): void {
            worker.postMessage(value);
        },
        close(): void {
            // step 1 - PeerWorker.dispose() owns worker.terminate(). intentional no-op.
        },
        on(
            event: "message" | "close",
            listener: ((value: unknown) => void) | (() => void)
        ): void {
            if (event === "message") {
                worker.on("message", listener as (value: unknown) => void);
            } else {
                // step 1 - map "close" -> worker exit. rpc client triggers its own
                // dispose() on this event, which is what we want.
                worker.on("exit", listener as () => void);
            }
        },
        off(
            event: "message" | "close",
            listener: ((value: unknown) => void) | (() => void)
        ): void {
            if (event === "message") {
                worker.off("message", listener as (value: unknown) => void);
            } else {
                worker.off("exit", listener as () => void);
            }
        }
    };
}

async function waitForReady(
    rpc: RpcClient,
    worker: Worker,
    timeoutMs: number
): Promise<ReadyPayload> {
    return new Promise<ReadyPayload>((resolve, reject) => {
        let settled = false;
        const settle = (err: Error | null, payload?: ReadyPayload): void => {
            // step 1 - crash push + exit event race. settle once; drop the rest.
            if (settled) return;
            settled = true;
            cleanup();
            if (err) reject(err);
            else resolve(payload!);
        };

        const timer = setTimeout(() => {
            settle(
                new Error(`PeerWorker.spawn boot-timeout after ${timeoutMs}ms`)
            );
        }, timeoutMs);

        const onReady = (payload: unknown) => {
            settle(null, payload as ReadyPayload);
        };

        const onCrash = (payload: unknown) => {
            const c = payload as CrashPayload;
            const err = new Error(
                `worker crash in phase '${c.phase ?? "<unknown>"}': ${c.message}`
            );
            err.name = c.name;
            if (c.stack) err.stack = c.stack;
            settle(err);
        };

        const onExit = (code: number) => {
            settle(
                new Error(`worker exited (code ${code}) before lifecycle.ready`)
            );
        };

        function cleanup() {
            clearTimeout(timer);
            rpc.off(LIFECYCLE_PUSH.ready, onReady);
            rpc.off(LIFECYCLE_PUSH.crash, onCrash);
            worker.off("exit", onExit);
        }

        rpc.on(LIFECYCLE_PUSH.ready, onReady);
        rpc.on(LIFECYCLE_PUSH.crash, onCrash);
        worker.on("exit", onExit);
    });
}
