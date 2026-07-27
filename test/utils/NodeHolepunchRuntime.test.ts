import { expect } from "chai";
import { Buffer } from "buffer";
// @ts-expect-error hyperswarm does not publish TypeScript declarations.
import Hyperswarm from "hyperswarm";

import { NodeHolepunchRuntime } from "@/holepunch/node/HolepunchRuntime";
import type { HolepunchSwarm } from "@/holepunch/HolepunchTypes";

describe("NodeHolepunchRuntime", function () {
    const runtimeGlobal = globalThis as typeof globalThis & {
        Hyperswarm?: HolepunchSwarm;
    };
    const swarmsToDestroy = new Set<HolepunchSwarm>();

    afterEach(async function () {
        delete runtimeGlobal.Hyperswarm;
        await Promise.all(
            [...swarmsToDestroy].map((swarm) =>
                Promise.resolve(swarm.destroy())
            )
        );
        swarmsToDestroy.clear();
    });

    it("borrows an injected swarm and preserves its listener on disposal", async function () {
        const borrowed: HolepunchSwarm = new Hyperswarm();
        swarmsToDestroy.add(borrowed);
        runtimeGlobal.Hyperswarm = borrowed;
        const listener = () => undefined;
        borrowed.on("connection", listener);
        let published: HolepunchSwarm | undefined;
        const runtime = new NodeHolepunchRuntime((swarm) => {
            published = swarm;
        });

        runtime.start();
        await runtime.dispose();

        expect(published === borrowed).to.equal(true);
        expect(borrowed.destroyed).to.equal(false);
        expect(borrowed.listenerCount?.("connection")).to.equal(1);
    });

    it("owns and destroys a swarm created without injection", async function () {
        let published: HolepunchSwarm | undefined;
        const runtime = new NodeHolepunchRuntime((swarm) => {
            published = swarm;
        });

        runtime.start();
        expect(published).to.not.be.undefined;
        await runtime.dispose();

        expect(published?.destroyed).to.equal(true);
    });

    it("joins and leaves real content-keyed topics on the published swarm", async function () {
        let published: HolepunchSwarm | undefined;
        const runtime = new NodeHolepunchRuntime((swarm) => {
            published = swarm;
        });
        runtime.start();
        if (!published?.topics) {
            throw new Error("Published Hyperswarm does not expose topics()");
        }
        const first = Buffer.alloc(32, 1);
        const second = Buffer.alloc(32, 2);

        published.join(first, { server: true, client: true });
        published.join(second, { server: true, client: true });
        expect([...published.topics()].length).to.equal(2);
        await Promise.all([
            Promise.resolve(published.leave(first)),
            Promise.resolve(published.leave(second))
        ]);
        expect([...published.topics()].length).to.equal(0);

        await runtime.dispose();
        expect(published.destroyed).to.equal(true);
    });

    it("samples injection only at construction", async function () {
        let published: HolepunchSwarm | undefined;
        const runtime = new NodeHolepunchRuntime((swarm) => {
            published = swarm;
        });
        const lateInjection: HolepunchSwarm = new Hyperswarm();
        swarmsToDestroy.add(lateInjection);
        runtimeGlobal.Hyperswarm = lateInjection;

        runtime.start();

        expect(published === lateInjection).to.equal(false);
        await runtime.dispose();
        expect(published?.destroyed).to.equal(true);
        expect(lateInjection.destroyed).to.equal(false);
    });
});
