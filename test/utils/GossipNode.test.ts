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
});
