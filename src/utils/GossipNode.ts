// One edge to a neighbouring thread: `post` = outbound, `subscribe` = inbound handler.
export type Neighbour = {
    post: (msg: unknown) => void;
    subscribe: (handler: (msg: unknown) => void) => void;
};

// A node in the thread-gossip tree, generic over payload. Precondition: topology is
// a TREE — skip-sender forwarding is then loop-free with no ids/dedupe; a non-tree loops.
export class GossipNode {
    private readonly neighbours = new Set<Neighbour>();
    private readonly onLocal?: (msg: unknown) => void;

    // `onLocal` interprets messages reaching this node (e.g. Logger.applyOp); optional for a pure relay.
    constructor(onLocal?: (msg: unknown) => void) {
        this.onLocal = onLocal;
    }

    // Forward to every neighbour except `exclude` (the sender on inbound; none on local origin).
    broadcast(msg: unknown, exclude?: Neighbour): void {
        for (const neighbour of this.neighbours) {
            if (neighbour !== exclude) neighbour.post(msg);
        }
    }

    // Wire inbound: deliver locally, then forward to all OTHER neighbours (skip-sender).
    addNeighbour(neighbour: Neighbour): void {
        // Idempotent: a second subscribe would double-deliver.
        if (this.neighbours.has(neighbour)) return;
        this.neighbours.add(neighbour);
        neighbour.subscribe((msg) => {
            this.onLocal?.(msg);
            this.broadcast(msg, neighbour);
        });
    }
}
