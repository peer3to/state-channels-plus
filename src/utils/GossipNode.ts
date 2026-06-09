// One edge to a neighbouring thread: `post` = outbound, `subscribe` = inbound handler
// returning its own unsubscribe (the transport still owns the port; gossip only un-wires).
export type Neighbour = {
    post: (msg: unknown) => void;
    subscribe: (handler: (msg: unknown) => void) => () => void;
};

// A node in the thread-gossip tree, generic over payload. Precondition: topology is
// a TREE — skip-sender forwarding is then loop-free with no ids/dedupe; a non-tree loops.
export class GossipNode {
    // neighbour → its unsubscribe, so removal can un-wire the inbound listener.
    private readonly neighbours = new Map<Neighbour, () => void>();
    private onLocal?: (msg: unknown) => void;

    // `onLocal` interprets messages reaching this node (e.g. Logger.applyOp); optional for a pure relay.
    constructor(onLocal?: (msg: unknown) => void) {
        this.onLocal = onLocal;
    }

    // Point local delivery at the thread's one root logger (a node may be shared across edges).
    setLocalHandler(onLocal: (msg: unknown) => void): void {
        this.onLocal = onLocal;
    }

    // Forward to every neighbour except `exclude` (the sender on inbound; none on local origin).
    broadcast(msg: unknown, exclude?: Neighbour): void {
        for (const neighbour of this.neighbours.keys()) {
            if (neighbour !== exclude) neighbour.post(msg);
        }
    }

    // Wire inbound: deliver locally, then forward to all OTHER neighbours (skip-sender).
    addNeighbour(neighbour: Neighbour): void {
        // Idempotent: a second subscribe would double-deliver.
        if (this.neighbours.has(neighbour)) return;
        const unsubscribe = neighbour.subscribe((msg) => {
            this.onLocal?.(msg);
            this.broadcast(msg, neighbour);
        });
        this.neighbours.set(neighbour, unsubscribe);
    }

    // Inverse of addNeighbour: un-wire the inbound listener and drop the edge. Idempotent.
    removeNeighbour(neighbour: Neighbour): void {
        const unsubscribe = this.neighbours.get(neighbour);
        if (!unsubscribe) return;
        unsubscribe();
        this.neighbours.delete(neighbour);
    }

    // Tear down every edge, leaving the node inert and reusable. Snapshot keys: removeNeighbour mutates.
    close(): void {
        for (const neighbour of [...this.neighbours.keys()]) {
            this.removeNeighbour(neighbour);
        }
    }
}
