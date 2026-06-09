import { GossipNode } from "@/utils/GossipNode";
import type { Logger, LoggerOp } from "@/utils/logging/Logger";
import type { WorkerEnvelope, WorkerHostTransport } from "./types";

// Worker-side base: envelope framing (receive → handle → reply), a GossipNode, logger,
// ready post. Subclasses implement `handle`. Posts {type:"ready"} in ctor, so ctor must be sync.
export abstract class AWorkerHost<TRequest, TResult> {
    private readonly transport: WorkerHostTransport;
    private readonly gossip: GossipNode;
    private readonly ownsGossip: boolean;

    // `gossip` injected → shared with sibling edges (caller owns lifecycle); omitted → owns a fresh node.
    constructor(transport: WorkerHostTransport, gossip?: GossipNode) {
        this.transport = transport;
        this.ownsGossip = gossip === undefined;
        this.gossip = gossip ?? new GossipNode();
        this.gossip.addNeighbour(transport.gossipNeighbour);
        transport.onMessage((envelope) => {
            void this.dispatch(envelope as WorkerEnvelope<TRequest>);
        });
        transport.post({ type: "ready" });
    }

    // Subclasses call this once their real logger exists (e.g. after init).
    protected attachLogger(logger: Logger): void {
        this.gossip.setLocalHandler((op) => logger.applyOp(op as LoggerOp));
        logger.setGossipNode(this.gossip);
    }

    // Symmetric with the client end; a shared node stays up for siblings.
    dispose(): void {
        if (this.ownsGossip) this.gossip.close();
        else this.gossip.removeNeighbour(this.transport.gossipNeighbour);
    }

    protected abstract handle(payload: TRequest): Promise<TResult>;

    private async dispatch(envelope: WorkerEnvelope<TRequest>): Promise<void> {
        const { requestId, payload } = envelope;
        try {
            const result = await this.handle(payload);
            this.transport.post({ requestId, ok: true, result });
        } catch (error) {
            const err =
                error instanceof Error ? error : new Error(String(error));
            this.transport.post({
                requestId,
                ok: false,
                error: {
                    message: err.message,
                    name: err.name,
                    stack: err.stack,
                    data: (err as { data?: string }).data
                }
            });
        }
    }
}
