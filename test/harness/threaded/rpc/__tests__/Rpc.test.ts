// W3 - rpc kernel unit tests. fake in-memory port pair so we don't depend
// on worker_threads; that's W2's surface. focus: correlation-id round trips,
// push delivery, error serialization, dispose semantics, race with late post.

import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";

import { RpcClient } from "../rpc-client";
import { RpcServer } from "../rpc-server";
import { attach } from "../rpc-endpoint";
import type { RpcPort } from "../rpc-types";

type Listener = (value: unknown) => void;
type CloseListener = () => void;

// step 1 - in-memory bidirectional port pair. messages enqueue on the other
// side via setImmediate to mimic real MessagePort async semantics. close() on
// one side triggers close listeners on both.
class FakePort implements RpcPort {
    private msgListeners = new Set<Listener>();
    private closeListeners = new Set<CloseListener>();
    private closed = false;
    other!: FakePort;

    postMessage(value: unknown): void {
        if (this.closed || this.other.closed) {
            throw new Error("port is closed");
        }
        // step 1 - deliver async; structured-clone semantics not modeled but
        // not needed for these tests (all payloads are plain JSON-safe data).
        setImmediate(() => {
            if (this.other.closed) return;
            for (const fn of this.other.msgListeners) {
                fn(value);
            }
        });
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        // step 1 - fire local close listeners (RpcClient/Server self-dispose)
        for (const fn of this.closeListeners) fn();
        // step 2 - propagate to the other side asynchronously
        setImmediate(() => {
            if (!this.other.closed) {
                this.other.closed = true;
                for (const fn of this.other.closeListeners) fn();
            }
        });
    }

    on(event: "message" | "close", listener: Listener | CloseListener): void {
        if (event === "message") this.msgListeners.add(listener as Listener);
        else this.closeListeners.add(listener as CloseListener);
    }

    off(event: "message" | "close", listener: Listener | CloseListener): void {
        if (event === "message") this.msgListeners.delete(listener as Listener);
        else this.closeListeners.delete(listener as CloseListener);
    }
}

function makePair(): [FakePort, FakePort] {
    const a = new FakePort();
    const b = new FakePort();
    a.other = b;
    b.other = a;
    return [a, b];
}

describe("rpc kernel (W3)", () => {
    let client: RpcClient;
    let server: RpcServer;

    beforeEach(() => {
        const [portA, portB] = makePair();
        client = new RpcClient(portA);
        server = new RpcServer(portB);
    });

    it("req/res round trip resolves with handler return value", async () => {
        server.register("add", async (args) => {
            const { a, b } = args as { a: number; b: number };
            return a + b;
        });
        const result = await client.call("add", { a: 2, b: 3 });
        expect(result).to.equal(5);
    });

    it("missing handler rejects with a clear error", async () => {
        let caught: Error | undefined;
        try {
            await client.call("unknown.method", {});
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.include("no handler");
        expect(caught!.message).to.include("unknown.method");
    });

    it("handler throw surfaces as rejection with name/message/stack preserved", async () => {
        class CustomError extends Error {
            constructor(msg: string) {
                super(msg);
                this.name = "CustomError";
            }
        }
        server.register("boom", () => {
            throw new CustomError("payload exploded");
        });
        let caught: Error | undefined;
        try {
            await client.call("boom", {});
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.name).to.equal("CustomError");
        expect(caught!.message).to.equal("payload exploded");
        expect(caught!.stack).to.be.a("string");
    });

    it("correlation ids do not cross calls (interleaved resolution)", async () => {
        let resolveSlow!: (v: number) => void;
        server.register(
            "slow",
            () =>
                new Promise<number>((r) => {
                    resolveSlow = r;
                })
        );
        server.register("fast", () => 1);

        const slowP = client.call("slow", {});
        const fastP = client.call("fast", {});

        // step 1 - fast resolves first even though slow was issued first
        const fastResult = await fastP;
        expect(fastResult).to.equal(1);

        // step 2 - now release slow
        resolveSlow(42);
        const slowResult = await slowP;
        expect(slowResult).to.equal(42);
    });

    it("push frames deliver to subscribed topic listeners only", async () => {
        const received: unknown[] = [];
        client.on("spy", (payload) => received.push(payload));
        client.on("other", () => {
            throw new Error("should not fire");
        });
        server.push("spy", { name: "onTurn", count: 1 });
        server.push("spy", { name: "onSetState", count: 2 });
        // step 1 - drain the async queue
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(received).to.have.length(2);
        expect((received[0] as { count: number }).count).to.equal(1);
        expect((received[1] as { count: number }).count).to.equal(2);
    });

    it("duplicate handler register throws", () => {
        server.register("dup", () => 1);
        expect(() => server.register("dup", () => 2)).to.throw(
            /duplicate handler/
        );
    });

    it("dispose rejects all in-flight calls with a clear error", async () => {
        server.register(
            "slow",
            () =>
                new Promise<number>(() => {
                    // step 1 - never resolves; dispose must wake the parked promise
                })
        );

        const p1 = client.call("slow", {});
        const p2 = client.call("slow", {});

        client.dispose();

        let e1: Error | undefined, e2: Error | undefined;
        try {
            await p1;
        } catch (e) {
            e1 = e as Error;
        }
        try {
            await p2;
        } catch (e) {
            e2 = e as Error;
        }
        expect(e1?.message).to.include("disposed");
        expect(e2?.message).to.include("disposed");
    });

    it("server postMessage on a closed port is swallowed (no throw)", async () => {
        server.register("slow", async () => {
            // step 1 - sleep a bit so client closes before we respond
            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setImmediate(r));
            return "result";
        });
        const callP = client.call("slow", {});
        // step 1 - immediately dispose; in-flight handler will try to post late
        client.dispose();

        let caught: Error | undefined;
        try {
            await callP;
        } catch (e) {
            caught = e as Error;
        }
        expect(caught?.message).to.include("disposed");

        // step 2 - give the handler a chance to try posting; should not throw
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        // step 3 - no unhandled exception means the safePost guard worked
    });

    it("close event on port triggers local dispose -> subsequent calls reject", async () => {
        server.register("noop", () => "ok");
        // step 1 - happy path first to prove the link works
        expect(await client.call("noop", {})).to.equal("ok");

        // step 2 - close from the server side; client's close listener fires
        server.dispose();
        await new Promise((r) => setImmediate(r));

        let caught: Error | undefined;
        try {
            await client.call("noop", {});
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.include("disposed");
    });

    it("dispose is idempotent (safe to call twice)", () => {
        client.dispose();
        expect(() => client.dispose()).to.not.throw();
        server.dispose();
        expect(() => server.dispose()).to.not.throw();
    });
});

// step 1 - bidirectional endpoints. both sides attach client+server to the
// same port; req/res frames flow in both directions; push frames keep working.
describe("rpc kernel (W3) - bidirectional endpoints", () => {
    it("orchestrator -> worker call works while worker -> orchestrator call works", async () => {
        const [portA, portB] = makePair();
        const sideA = attach(portA);
        const sideB = attach(portB);

        sideB.server.register("worker.echo", (args) => {
            const { v } = args as { v: number };
            return { echoed: v * 2 };
        });
        sideA.server.register("orch.lookup", (args) => {
            const { key } = args as { key: string };
            return { value: `orch:${key}` };
        });

        const fromA = (await sideA.client.call("worker.echo", { v: 21 })) as {
            echoed: number;
        };
        expect(fromA.echoed).to.equal(42);

        const fromB = (await sideB.client.call("orch.lookup", {
            key: "foo"
        })) as { value: string };
        expect(fromB.value).to.equal("orch:foo");

        sideA.dispose();
        sideB.dispose();
    });

    it("nested callback: worker handler calls back into orchestrator mid-handle", async () => {
        const [portA, portB] = makePair();
        const sideA = attach(portA);
        const sideB = attach(portB);

        sideA.server.register("orch.tamper", async (args) => {
            const { dispute } = args as { dispute: { height: number } };
            return { dispute: { height: dispute.height + 1000 } };
        });
        sideB.server.register("worker.constructAndTamper", async () => {
            const tampered = (await sideB.client.call("orch.tamper", {
                dispute: { height: 5 }
            })) as { dispute: { height: number } };
            return tampered.dispute;
        });

        const result = (await sideA.client.call(
            "worker.constructAndTamper",
            {}
        )) as { height: number };
        expect(result.height).to.equal(1005);

        sideA.dispose();
        sideB.dispose();
    });

    it("push frames still work alongside bidirectional req/res", async () => {
        const [portA, portB] = makePair();
        const sideA = attach(portA);
        const sideB = attach(portB);
        const received: unknown[] = [];
        sideA.client.on("worker.tick", (p) => received.push(p));
        sideB.server.push("worker.tick", { n: 1 });
        sideB.server.push("worker.tick", { n: 2 });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(received).to.have.length(2);

        sideA.dispose();
        sideB.dispose();
    });
});
