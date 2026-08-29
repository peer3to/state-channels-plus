import { expect } from "chai";
import { Buffer } from "buffer";
import Holepunch from "@/Holepunch";
import type P2PManager from "@/P2PManager";
import { createLogger } from "@/utils";

// Holepunch's node path picks up an already-constructed swarm via
// `global.Hyperswarm` (Holepunch.ts ensureNodeSwarm, `global.Hyperswarm ||
// new Hyperswarm()`) - this stand-in mirrors that shape (join/leave/on/
// removeAllListeners) without touching the real Hyperswarm/DHT machinery.
// It is a factory-built domain-shaped double, not a mock of an SDK class.
function createFakeSwarm() {
    const joinCalls: Buffer[] = [];
    const leaveCalls: Buffer[] = [];
    return {
        joinCalls,
        leaveCalls,
        on: () => undefined,
        removeAllListeners: () => undefined,
        join: (topic: Buffer) => {
            joinCalls.push(topic);
        },
        leave: (topic: Buffer) => {
            leaveCalls.push(topic);
        }
    };
}

// Holepunch only reaches `p2pManager.logger` on the node path exercised
// here (the browser branch, guarded by `isBrowserRuntime`, is not taken in
// this Mocha/node environment). A real Logger is used so debug calls
// exercise real logging code, not a hand-rolled stub.
function createP2pManagerStub(): P2PManager {
    return {
        logger: createLogger({}, {}, { level: "error" })
    } as unknown as P2PManager;
}

describe("Holepunch.leave", function () {
    const originalGlobalHyperswarm = (global as any).Hyperswarm;

    afterEach(() => {
        (global as any).Hyperswarm = originalGlobalHyperswarm;
    });

    it("removes the topic from `topics` and calls swarm.leave; a second leave is a no-op", async function () {
        const fakeSwarm = createFakeSwarm();
        (global as any).Hyperswarm = fakeSwarm;
        const holepunch = new Holepunch(createP2pManagerStub());
        const topic = Buffer.from("topic-a");

        await holepunch.join(topic);
        expect(holepunch.topics.some((t) => t.equals(topic))).to.equal(true);

        // Callers derive topics independently - hand back a distinct Buffer
        // instance with the same bytes to prove removal is by value.
        await holepunch.leave(Buffer.from("topic-a"));

        expect(holepunch.topics.some((t) => t.equals(topic))).to.equal(false);
        expect(fakeSwarm.leaveCalls.length).to.equal(1);

        await holepunch.leave(Buffer.from("topic-a"));
        expect(fakeSwarm.leaveCalls.length).to.equal(1);
    });

    it("is a no-op, not a throw, for a topic that was never joined", async function () {
        const fakeSwarm = createFakeSwarm();
        (global as any).Hyperswarm = fakeSwarm;
        const holepunch = new Holepunch(createP2pManagerStub());

        await holepunch.join(Buffer.from("topic-a"));

        await holepunch.leave(Buffer.from("never-joined"));

        expect(fakeSwarm.leaveCalls.length).to.equal(0);
        expect(holepunch.topics.length).to.equal(1);
    });

    it("does not throw when the node swarm was never lazily created", async function () {
        delete (global as any).Hyperswarm;
        const holepunch = new Holepunch(createP2pManagerStub());

        await holepunch.leave(Buffer.from("topic-a"));

        expect(holepunch.topics.length).to.equal(0);
    });

    it("does not re-announce a left topic on a rejoin cycle", async function () {
        const fakeSwarm = createFakeSwarm();
        (global as any).Hyperswarm = fakeSwarm;
        const holepunch = new Holepunch(createP2pManagerStub());
        const topicA = Buffer.from("topic-a");
        const topicB = Buffer.from("topic-b");

        await holepunch.join(topicA);
        await holepunch.join(topicB);
        await holepunch.leave(topicA);

        fakeSwarm.joinCalls.length = 0;
        // Simulate a rejoin cycle (browser relay reconnect path calls this
        // via rejoinTopics(); reached directly here since the node path
        // under test does not itself trigger a reconnect).
        (holepunch as any).rejoinTopics();

        expect(fakeSwarm.joinCalls.length).to.equal(1);
        expect(fakeSwarm.joinCalls[0].equals(topicB)).to.equal(true);
    });
});
