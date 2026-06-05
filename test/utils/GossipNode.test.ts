import { expect } from "chai";
import { GossipNode, type Neighbour } from "@/utils/GossipNode";

// A fake neighbour: records what it was told to post, and lets the test push
// inbound messages by capturing the subscribe handler.
function fakeNeighbour() {
    const posted: unknown[] = [];
    let handler: ((msg: unknown) => void) | undefined;
    const neighbour: Neighbour = {
        post: (msg) => posted.push(msg),
        subscribe: (h) => {
            handler = h;
        }
    };
    return {
        neighbour,
        posted,
        deliver: (msg: unknown) => handler?.(msg)
    };
}

// Wire two real GossipNodes with a synchronous in-memory edge so a broadcast
// cascades deterministically (no event-loop yield).
function wire(x: GossipNode, y: GossipNode): void {
    let xInbound: ((m: unknown) => void) | undefined;
    let yInbound: ((m: unknown) => void) | undefined;
    x.addNeighbour({
        post: (m) => yInbound?.(m),
        subscribe: (h) => {
            xInbound = h;
        }
    });
    y.addNeighbour({
        post: (m) => xInbound?.(m),
        subscribe: (h) => {
            yInbound = h;
        }
    });
}

describe("GossipNode", function () {
    it("broadcast posts to every neighbour", function () {
        const node = new GossipNode();
        const a = fakeNeighbour();
        const b = fakeNeighbour();
        node.addNeighbour(a.neighbour);
        node.addNeighbour(b.neighbour);

        node.broadcast({ type: "flush" });

        expect(a.posted).to.deep.equal([{ type: "flush" }]);
        expect(b.posted).to.deep.equal([{ type: "flush" }]);
    });

    it("broadcast(exclude) skips the excluded neighbour", function () {
        const node = new GossipNode();
        const a = fakeNeighbour();
        const b = fakeNeighbour();
        node.addNeighbour(a.neighbour);
        node.addNeighbour(b.neighbour);

        node.broadcast("x", a.neighbour);

        expect(a.posted).to.deep.equal([]);
        expect(b.posted).to.deep.equal(["x"]);
    });

    it("inbound message is delivered locally and forwarded to all OTHER neighbours", function () {
        const seen: unknown[] = [];
        const node = new GossipNode((msg) => seen.push(msg));
        const a = fakeNeighbour();
        const b = fakeNeighbour();
        const c = fakeNeighbour();
        node.addNeighbour(a.neighbour);
        node.addNeighbour(b.neighbour);
        node.addNeighbour(c.neighbour);

        a.deliver("hello"); // arrives from a

        expect(seen).to.deep.equal(["hello"]); // delivered locally
        expect(a.posted).to.deep.equal([]); // never back to sender (skip-sender)
        expect(b.posted).to.deep.equal(["hello"]); // forwarded
        expect(c.posted).to.deep.equal(["hello"]);
    });

    it("no local handler still forwards inbound to other neighbours", function () {
        const node = new GossipNode(); // no handler
        const a = fakeNeighbour();
        const b = fakeNeighbour();
        node.addNeighbour(a.neighbour);
        node.addNeighbour(b.neighbour);

        a.deliver(42);

        expect(b.posted).to.deep.equal([42]);
    });

    it("single-neighbour node delivers inbound locally and never echoes back to the sender", function () {
        const seen: unknown[] = [];
        const node = new GossipNode((msg) => seen.push(msg));
        const only = fakeNeighbour();
        node.addNeighbour(only.neighbour);

        only.deliver({ type: "flush" });

        expect(seen).to.deep.equal([{ type: "flush" }]); // delivered locally
        expect(only.posted).to.deep.equal([]); // no echo back to the only neighbour
    });

    // Loop-freedom on a real 3-node tree A—B—C: synchronous wiring means a routing
    // loop would hang/overflow rather than pass.
    it("middle-node origin reaches both leaves exactly once, no loop", function () {
        const aSeen: unknown[] = [];
        const bSeen: unknown[] = [];
        const cSeen: unknown[] = [];
        const a = new GossipNode((m) => aSeen.push(m));
        const b = new GossipNode((m) => bSeen.push(m));
        const c = new GossipNode((m) => cSeen.push(m));
        wire(a, b);
        wire(b, c);

        b.broadcast({ type: "flush" }); // origin at the middle

        expect(aSeen).to.deep.equal([{ type: "flush" }]); // leaf applied once
        expect(cSeen).to.deep.equal([{ type: "flush" }]); // far leaf applied once
        expect(bSeen).to.deep.equal([]); // originator doesn't self-apply via gossip
    });

    it("leaf origin relays through the middle to the far leaf once, no echo to origin", function () {
        const aSeen: unknown[] = [];
        const bSeen: unknown[] = [];
        const cSeen: unknown[] = [];
        const a = new GossipNode((m) => aSeen.push(m));
        const b = new GossipNode((m) => bSeen.push(m));
        const c = new GossipNode((m) => cSeen.push(m));
        wire(a, b);
        wire(b, c);

        a.broadcast("x"); // origin at a leaf; must relay through B to reach C

        expect(bSeen).to.deep.equal(["x"]); // middle applied once
        expect(cSeen).to.deep.equal(["x"]); // far leaf reached via relay, once
        expect(aSeen).to.deep.equal([]); // no echo back to the origin
    });

    it("addNeighbour is idempotent: adding the same neighbour twice delivers inbound once", function () {
        const seen: unknown[] = [];
        const node = new GossipNode((m) => seen.push(m));
        const only = fakeNeighbour();
        node.addNeighbour(only.neighbour);
        node.addNeighbour(only.neighbour); // second add must be a no-op

        only.deliver({ type: "flush" });

        expect(seen).to.deep.equal([{ type: "flush" }]); // delivered once, not twice
    });
});
