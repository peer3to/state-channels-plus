// A single edge to a neighbouring thread in the gossip tree. `post` sends a
// message out over the edge; `subscribe` registers the inbound handler. Both are
// closures over a dedicated MessagePort, built at the @platform entry — the node
// never touches a raw port.
export type Neighbour = {
    post: (msg: unknown) => void;
    subscribe: (handler: (msg: unknown) => void) => void;
};

// A participant in the bidirectional thread-gossip tree. Generic over payload
// (carries `unknown`); knows nothing about logs. Precondition: the thread topology
// is a TREE, which makes skip-sender forwarding provably loop-free with no ids or
// dedupe. Hand it a non-tree and it will loop — out of contract.
export class GossipNode {
    private readonly neighbours = new Set<Neighbour>();
    private readonly onLocal?: (msg: unknown) => void;

    // `onLocal` is the consumer's interpreter for messages that reach this node
    // (e.g. Logger.applyOp). Optional so a pure relay node is possible.
    constructor(onLocal?: (msg: unknown) => void) {
        this.onLocal = onLocal;
    }

    // The ONE routing primitive: forward to every neighbour except `exclude`.
    // Local origin calls it with no exclude (forward to all); inbound forwarding
    // excludes the sender.
    broadcast(msg: unknown, exclude?: Neighbour): void {
        for (const neighbour of this.neighbours) {
            if (neighbour !== exclude) neighbour.post(msg);
        }
    }

    // Registering a neighbour also wires its inbound path: deliver locally, then
    // forward to all OTHER neighbours (skip-sender). There is no separate receive().
    addNeighbour(neighbour: Neighbour): void {
        // Idempotent: Set.add dedupes, but a second subscribe would double-deliver.
        if (this.neighbours.has(neighbour)) return;
        this.neighbours.add(neighbour);
        neighbour.subscribe((msg) => {
            this.onLocal?.(msg);
            this.broadcast(msg, neighbour);
        });
    }
}
