import { GossipNode } from "@/utils/GossipNode";
import type { WorkerClientTransport, WorkerResult } from "./types";

// Main-side base for a worker runtime: ready handshake, requestId/pending
// correlation, a GossipNode (neighbour = worker's gossip port), dispose.
export class WorkerClient<TRequest, TResult> {
    private nextRequestId = 1;
    private readonly pending = new Map<
        number,
        { resolve: (result: TResult) => void; reject: (error: Error) => void }
    >();
    private readonly transport: WorkerClientTransport;
    private readonly gossip: GossipNode;
    private readonly ownsGossip: boolean;
    private readonly ready: Promise<void>;
    private resolveReady!: () => void;
    private rejectReady!: (error: Error) => void;

    // `gossip` injected → shared with sibling edges (caller owns lifecycle); omitted → owns a fresh node.
    constructor(transport: WorkerClientTransport, gossip?: GossipNode) {
        this.transport = transport;
        this.ownsGossip = gossip === undefined;
        this.gossip = gossip ?? new GossipNode();
        this.gossip.addNeighbour(transport.gossipNeighbour);
        this.ready = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        // dispose()/onError reject `ready`; mark it handled so a never-awaited
        // rejection can't surface as an unhandledRejection.
        void this.ready.catch(() => {});
        transport.onMessage((result) =>
            this.handleResult(result as WorkerResult<TResult>)
        );
        transport.onError((error) => {
            this.rejectReady(error);
            this.rejectAll(error);
        });
    }

    // Gossip edge to the worker; consumers self-wire (logger.setGossipNode).
    get gossipNode(): GossipNode {
        return this.gossip;
    }

    // Send a request; awaits the ready handshake first so callers needn't sequence it.
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
        // Un-wire this edge before the transport closes the port; a shared node stays up for siblings.
        if (this.ownsGossip) this.gossip.close();
        else this.gossip.removeNeighbour(this.transport.gossipNeighbour);
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
