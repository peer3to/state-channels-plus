import { GossipNode } from "@/utils/GossipNode";
import type { Logger, LoggerOp } from "@/utils/logging/Logger";
import type { WorkerClientTransport, WorkerResult } from "./types";

// Main-side base for a worker runtime: owns the ready handshake, requestId/pending
// request-response correlation, a GossipNode (its sole neighbour is the worker's
// gossip port), logger attachment, and dispose. Concrete and composed (the EVM
// executor already extends AContractExecutor, so it holds a WorkerClient).
export class WorkerClient<TRequest, TResult> {
    private nextRequestId = 1;
    private readonly pending = new Map<
        number,
        { resolve: (result: TResult) => void; reject: (error: Error) => void }
    >();
    private readonly transport: WorkerClientTransport;
    private readonly gossip: GossipNode;
    private logger?: Logger;
    private readonly ready: Promise<void>;
    private resolveReady!: () => void;
    private rejectReady!: (error: Error) => void;

    constructor(transport: WorkerClientTransport) {
        this.transport = transport;
        this.gossip = new GossipNode((op) =>
            this.logger?.applyOp(op as LoggerOp)
        );
        this.gossip.addNeighbour(transport.gossipNeighbour);
        this.ready = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        transport.onMessage((result) =>
            this.handleResult(result as WorkerResult<TResult>)
        );
        transport.onError((error) => {
            this.rejectReady(error);
            this.rejectAll(error);
        });
    }

    // Wire a logger's gossip into this client's node (main-side composition root).
    attachLogger(logger: Logger): void {
        this.logger = logger;
        logger.setGossipNode(this.gossip);
    }

    // Send a request and resolve with the worker's result. Waits for the worker's
    // ready handshake first, so callers never sequence it manually.
    async request(payload: TRequest): Promise<TResult> {
        await this.ready;
        const requestId = this.nextRequestId++;
        return new Promise<TResult>((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            try {
                this.transport.post({ requestId, payload });
            } catch (error) {
                this.pending.delete(requestId);
                reject(
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        });
    }

    async dispose(): Promise<void> {
        const error = new Error("Worker client disposed");
        this.rejectReady(error);
        this.rejectAll(error);
        await this.transport.terminate();
    }

    private handleResult(result: WorkerResult<TResult>): void {
        if ("type" in result) {
            this.resolveReady();
            return;
        }
        const pending = this.pending.get(result.requestId);
        if (!pending) return;
        this.pending.delete(result.requestId);
        if (result.ok) {
            pending.resolve(result.result);
            return;
        }
        const error = new Error(result.error.message);
        error.name = result.error.name || error.name;
        error.stack = result.error.stack || error.stack;
        (error as { data?: string }).data = result.error.data;
        pending.reject(error);
    }

    private rejectAll(error: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}
