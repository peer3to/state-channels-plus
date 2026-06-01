// Rpc kernel unit tests using an in-memory port pair.

import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";

import { PeerCaller } from "../rpc-client";
import { PeerHandler } from "../rpc-server";
import type { RpcPort } from "../rpc-types";

type Listener = (value: unknown) => void;
type CloseListener = () => void;

// In-memory bidirectional port pair; close on one side triggers close listeners on both.
class FakePort implements RpcPort {
    private msgListeners = new Set<Listener>();
    private closeListeners = new Set<CloseListener>();
    private closed = false;
    other!: FakePort;

    postMessage(value: unknown): void {
        if (this.closed || this.other.closed) {
            throw new Error("port is closed");
        }
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
        for (const fn of this.closeListeners) fn();
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

describe("rpc kernel", () => {
    let client: PeerCaller;
    let server: PeerHandler;

    beforeEach(() => {
        const [portA, portB] = makePair();
        client = new PeerCaller(portA);
        server = new PeerHandler(portB);
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

        const fastResult = await fastP;
        expect(fastResult).to.equal(1);

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
                    // never resolves
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
            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setImmediate(r));
            return "result";
        });
        const callP = client.call("slow", {});
        client.dispose();

        let caught: Error | undefined;
        try {
            await callP;
        } catch (e) {
            caught = e as Error;
        }
        expect(caught?.message).to.include("disposed");

        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
    });

    it("close event on port triggers local dispose -> subsequent calls reject", async () => {
        server.register("noop", () => "ok");
        expect(await client.call("noop", {})).to.equal("ok");

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

describe("rpc kernel - bidirectional endpoints", () => {
    it("orchestrator -> worker call works while worker -> orchestrator call works", async () => {
        const [portA, portB] = makePair();
        const sideA = createBidirectionalEndpoint(portA);
        const sideB = createBidirectionalEndpoint(portB);

        sideB.handler.register("worker.echo", (args) => {
            const { v } = args as { v: number };
            return { echoed: v * 2 };
        });
        sideA.handler.register("orch.lookup", (args) => {
            const { key } = args as { key: string };
            return { value: `orch:${key}` };
        });

        const fromA = (await sideA.caller.call("worker.echo", { v: 21 })) as {
            echoed: number;
        };
        expect(fromA.echoed).to.equal(42);

        const fromB = (await sideB.caller.call("orch.lookup", {
            key: "foo"
        })) as { value: string };
        expect(fromB.value).to.equal("orch:foo");

        sideA.dispose();
        sideB.dispose();
    });

    it("nested callback: worker handler calls back into orchestrator mid-handle", async () => {
        const [portA, portB] = makePair();
        const sideA = createBidirectionalEndpoint(portA);
        const sideB = createBidirectionalEndpoint(portB);

        sideA.handler.register("orch.tamper", async (args) => {
            const { dispute } = args as { dispute: { height: number } };
            return { dispute: { height: dispute.height + 1000 } };
        });
        sideB.handler.register("worker.constructAndTamper", async () => {
            const tampered = (await sideB.caller.call("orch.tamper", {
                dispute: { height: 5 }
            })) as { dispute: { height: number } };
            return tampered.dispute;
        });

        const result = (await sideA.caller.call(
            "worker.constructAndTamper",
            {}
        )) as { height: number };
        expect(result.height).to.equal(1005);

        sideA.dispose();
        sideB.dispose();
    });

    it("push frames still work alongside bidirectional req/res", async () => {
        const [portA, portB] = makePair();
        const sideA = createBidirectionalEndpoint(portA);
        const sideB = createBidirectionalEndpoint(portB);
        const received: unknown[] = [];
        sideA.caller.on("worker.tick", (p) => received.push(p));
        sideB.handler.push("worker.tick", { n: 1 });
        sideB.handler.push("worker.tick", { n: 2 });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(received).to.have.length(2);

        sideA.dispose();
        sideB.dispose();
    });
});

function createBidirectionalEndpoint(port: RpcPort): {
    caller: PeerCaller;
    handler: PeerHandler;
    dispose: () => void;
} {
    const caller = new PeerCaller(port);
    const handler = new PeerHandler(port);
    return {
        caller,
        handler,
        dispose(): void {
            handler.dispose();
            caller.dispose();
        }
    };
}
