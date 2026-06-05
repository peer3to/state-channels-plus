import { GossipNode } from "@/utils/GossipNode";
import type { Logger, LoggerOp } from "@/utils/logging/Logger";
import type { WorkerEnvelope, WorkerHostTransport } from "./types";

// Worker-side base: envelope framing (receive → handle → reply), a GossipNode
// (neighbour = parent port), logger, and the ready post. Subclasses implement
// `handle`. Posts {type:"ready"} at end of construction, so construction must be sync.
export abstract class AWorkerHost<TRequest, TResult> {
    private readonly transport: WorkerHostTransport;
    private readonly gossip: GossipNode;
    private logger?: Logger;

    constructor(transport: WorkerHostTransport) {
        this.transport = transport;
        this.gossip = new GossipNode((op) =>
            this.logger?.applyOp(op as LoggerOp)
        );
        this.gossip.addNeighbour(transport.gossipNeighbour);
        transport.onMessage((envelope) => {
            void this.dispatch(envelope as WorkerEnvelope<TRequest>);
        });
        transport.post({ type: "ready" });
    }

    // Subclasses call this once their real logger exists (e.g. after init).
    protected attachLogger(logger: Logger): void {
        this.logger = logger;
        logger.setGossipNode(this.gossip);
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
