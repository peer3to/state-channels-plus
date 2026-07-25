import { expect } from "chai";

import { InMemoryPersistencePort } from "@/storage/persistence/InMemoryPersistencePort";
import {
    NamespacedOp,
    PersistRecord
} from "@/storage/persistence/PersistencePort";
import {
    DurabilityState,
    PersistenceEngine
} from "@/storage/persistence/PersistenceEngine";
import { PersistenceSchema } from "@/storage/persistence/PersistenceSchema";

// --- helpers ---------------------------------------------------------------

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitUntil(cond: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitUntil timed out");
        }
        await delay(2);
    }
}

async function isPending(p: Promise<unknown>): Promise<boolean> {
    const sentinel = Symbol("pending");
    const res = await Promise.race([
        p.then(
            () => "settled",
            () => "settled"
        ),
        delay(25).then(() => sentinel)
    ]);
    return res === sentinel;
}

async function collect(
    iterable: AsyncIterable<PersistRecord>
): Promise<PersistRecord[]> {
    const out: PersistRecord[] = [];
    for await (const r of iterable) out.push(r);
    return out;
}

const noop = () => undefined;

// --- test ports ------------------------------------------------------------

/** Records every commit and can gate each commit until explicitly released. */
class GatedPort extends InMemoryPersistencePort {
    readonly commits: NamespacedOp[][] = [];
    gated = false;
    private readonly gates: Array<() => void> = [];

    async commit(ops: NamespacedOp[]): Promise<void> {
        this.commits.push(ops);
        if (this.gated) {
            await new Promise<void>((res) => this.gates.push(res));
        }
        await super.commit(ops);
    }

    closeCount = 0;

    get commitCount(): number {
        return this.commits.length;
    }

    releaseNext(): void {
        const g = this.gates.shift();
        if (g) g();
    }

    async close(): Promise<void> {
        this.closeCount++;
    }
}

/** Rejects every commit with the injected error while `fail` is set. */
class FailingPort extends InMemoryPersistencePort {
    fail = true;
    attempts = 0;
    private readonly err: unknown;

    constructor(err: unknown) {
        super();
        this.err = err;
    }

    async commit(ops: NamespacedOp[]): Promise<void> {
        this.attempts++;
        if (this.fail) throw this.err;
        await super.commit(ops);
    }
}

// --- test schema -----------------------------------------------------------

type SigValue = { key: string; sigs: string[] };

const enc = (v: SigValue): string =>
    JSON.stringify({ key: v.key, sigs: [...v.sigs].sort() });

/**
 * A set-valued schema whose changeKey hashes set CONTENT (sorted members), not
 * cardinality - mirrors a signature set that can shrink then regrow.
 */
function sigSchema(
    id: string,
    map: Map<string, SigValue>
): PersistenceSchema<SigValue> {
    return {
        id,
        entries: () => map.entries(),
        changeKey: (v) => `${v.key}|${[...v.sigs].sort().join(",")}`,
        encode: enc,
        decode: (e) => JSON.parse(e) as SigValue,
        replay: (e) => {
            const decoded = JSON.parse(e) as SigValue;
            const existing = map.get(decoded.key);
            if (!existing) {
                map.set(decoded.key, {
                    key: decoded.key,
                    sigs: [...decoded.sigs]
                });
            } else {
                existing.sigs = [
                    ...new Set([...existing.sigs, ...decoded.sigs])
                ];
            }
        }
    };
}

/** Like sigSchema but its encode throws - models the stray-bigint backstop. */
function throwingEncodeSchema(
    id: string,
    map: Map<string, SigValue>
): PersistenceSchema<SigValue> {
    return {
        ...sigSchema(id, map),
        encode: () => {
            throw new Error("encode boom");
        }
    };
}

// --- tests -----------------------------------------------------------------

describe("PersistenceEngine", function () {
    it("flush emits put for changed entries and del for vanished keys", async function () {
        const port = new GatedPort();
        const map = new Map<string, SigValue>();
        map.set("k1", { key: "k1", sigs: ["a"] });
        map.set("k2", { key: "k2", sigs: ["b"] });

        const engine = new PersistenceEngine({ port, onFatal: noop });
        engine.register(sigSchema("s", map));

        await engine.awaitDurable(); // flush 1: put k1, put k2

        map.set("k1", { key: "k1", sigs: ["a", "c"] }); // changed
        map.delete("k2"); // vanished

        await engine.awaitDurable(); // flush 2

        const last = port.commits[port.commits.length - 1];
        expect(last).to.have.deep.members([
            {
                namespace: "s",
                type: "put",
                key: "k1",
                encoded: enc({ key: "k1", sigs: ["a", "c"] })
            },
            { namespace: "s", type: "del", key: "k2" }
        ]);
    });

    it("awaitDurable resolves when a flush started at-or-after the await commits", async function () {
        const port = new GatedPort();
        const map = new Map<string, SigValue>();
        map.set("k", { key: "k", sigs: ["a"] });

        const engine = new PersistenceEngine({ port, onFatal: noop });
        engine.register(sigSchema("s", map));

        await engine.awaitDurable();

        const records = await collect(port.load("s"));
        expect(records).to.deep.equal([
            { key: "k", encoded: enc({ key: "k", sigs: ["a"] }) }
        ]);
    });

    it("a flush started before the mutation does not satisfy the barrier", async function () {
        const port = new GatedPort();
        port.gated = true;
        const map = new Map<string, SigValue>();
        map.set("k0", { key: "k0", sigs: ["a"] });

        const engine = new PersistenceEngine({ port, onFatal: noop });
        engine.register(sigSchema("s", map));

        // F1 schedules and takes its snapshot (commit called, then gated).
        const p1 = engine.awaitDurable();
        await waitUntil(() => port.commitCount === 1);

        // Store an entry AFTER F1's snapshot, then bind a new barrier.
        map.set("k1", { key: "k1", sigs: ["b"] });
        const p2 = engine.awaitDurable();

        // F1 commits: it satisfies p1 but must NOT satisfy p2.
        port.releaseNext();
        await p1;
        expect(await isPending(p2)).to.equal(true);

        // Only the subsequently-started F2 (which sees k1) resolves p2.
        await waitUntil(() => port.commitCount === 2);
        port.releaseNext();
        await p2;

        const records = await collect(port.load("s"));
        expect(records.map((r) => r.key).sort()).to.deep.equal(["k0", "k1"]);
    });

    it("changeKey catches a size-invariant signature-set membership change", async function () {
        const port = new GatedPort();
        const map = new Map<string, SigValue>();
        map.set("k", { key: "k", sigs: ["A", "B", "X"] });

        const engine = new PersistenceEngine({ port, onFatal: noop });
        engine.register(sigSchema("s", map));

        await engine.awaitDurable(); // put {A,B,X}

        // Strip X, add C - same cardinality, different membership.
        map.set("k", { key: "k", sigs: ["A", "B", "C"] });
        await engine.awaitDurable();

        const last = port.commits[port.commits.length - 1];
        expect(last).to.have.deep.members([
            {
                namespace: "s",
                type: "put",
                key: "k",
                encoded: enc({ key: "k", sigs: ["A", "B", "C"] })
            }
        ]);
    });

    it("commit failure keeps the barrier pending, notifies, does not advance shadow or fire onFatal", async function () {
        const err = new Error("commit boom");
        const port = new FailingPort(err);
        const notified: DurabilityState[] = [];
        let fatalCalled = false;

        const map = new Map<string, SigValue>();
        map.set("k", { key: "k", sigs: ["a"] });

        const engine = new PersistenceEngine({
            port,
            onFatal: () => {
                fatalCalled = true;
            },
            notify: (s) => notified.push(s),
            retryBackoffMs: [1000],
            watchdog: { timeoutWindowMs: 100000 } // far beyond this test
        });
        engine.register(sigSchema("s", map));

        const p = engine.awaitDurable();
        await waitUntil(() => notified.some((n) => n.degraded));

        expect(await isPending(p)).to.equal(true);
        expect(notified[0].degraded).to.equal(true);
        expect(notified[0].err).to.equal(err);

        // Shadow not advanced: nothing durable, commit was withheld.
        expect(await collect(port.load("s"))).to.deep.equal([]);
        expect(fatalCalled).to.equal(false);

        // Recover so the barrier resolves and background timers are cleared.
        port.fail = false;
        await engine.awaitDurable();
        await p;
        expect(notified.some((n) => !n.degraded)).to.equal(true);
    });

    it("watchdog fires onFatal at the liveness deadline when commits keep failing", async function () {
        const err = new Error("commit boom");
        const port = new FailingPort(err);
        let fatalCount = 0;
        let fatalErr: unknown;

        const map = new Map<string, SigValue>();
        map.set("k", { key: "k", sigs: ["a"] });

        const engine = new PersistenceEngine({
            port,
            onFatal: (e) => {
                fatalCount++;
                fatalErr = e;
            },
            notify: noop,
            retryBackoffMs: [5],
            watchdog: { timeoutWindowMs: 40, deadlineFraction: 0.5 } // 20ms
        });
        engine.register(sigSchema("s", map));

        // The barrier never resolves (withheld) - deliberately not awaited.
        void engine.awaitDurable();

        await waitUntil(() => fatalCount > 0, 3000);
        expect(fatalErr).to.equal(err);
        expect(port.attempts).to.be.greaterThan(0);

        // Terminal fail-stop: onFatal fires once, background retries stop.
        await delay(60);
        expect(fatalCount).to.equal(1);
    });

    it("hydrate seeds shadow from the durable record so a pre-hydrate mutation is not masked", async function () {
        const port = new GatedPort();
        // Durable state as-written: k -> {A,B}, k2 -> {A,B}.
        await port.commit([
            {
                namespace: "h",
                type: "put",
                key: "k",
                encoded: enc({ key: "k", sigs: ["A", "B"] })
            },
            {
                namespace: "h",
                type: "put",
                key: "k2",
                encoded: enc({ key: "k2", sigs: ["A", "B"] })
            }
        ]);

        const map = new Map<string, SigValue>();
        // Pre-hydrate un-flushed live mutation: k already carries an extra sig.
        map.set("k", { key: "k", sigs: ["A", "B", "C"] });

        const engine = new PersistenceEngine({ port, onFatal: noop });
        engine.register(sigSchema("h", map));

        await engine.hydrateAll();

        // Merge-not-clear: live C survives, durable {A,B} unions in.
        expect([...map.get("k")!.sigs].sort()).to.deep.equal(["A", "B", "C"]);
        expect([...map.get("k2")!.sigs].sort()).to.deep.equal(["A", "B"]);

        port.commits.length = 0; // isolate the post-hydrate flush
        await engine.awaitDurable();

        // Only k (the pre-hydrate mutation) is re-persisted; unchanged k2 is
        // skipped - proving the shadow was seeded pre-merge, not post-merge.
        const puts = port.commits
            .flat()
            .filter((o) => o.type === "put")
            .map((o) => o.key);
        expect(puts).to.deep.equal(["k"]);

        const kRecord = (await collect(port.load("h"))).find(
            (r) => r.key === "k"
        );
        expect(kRecord?.encoded).to.equal(
            enc({ key: "k", sigs: ["A", "B", "C"] })
        );
    });

    it("a diff-phase encode throw degrades, notifies, and fires onFatal at the deadline", async function () {
        const notified: DurabilityState[] = [];
        let fatalCount = 0;
        const map = new Map<string, SigValue>();
        map.set("k", { key: "k", sigs: ["a"] });

        const engine = new PersistenceEngine({
            port: new GatedPort(),
            onFatal: () => {
                fatalCount++;
            },
            notify: (s) => notified.push(s),
            retryBackoffMs: [5],
            watchdog: { timeoutWindowMs: 40, deadlineFraction: 0.5 } // 20ms
        });
        engine.register(throwingEncodeSchema("s", map));

        // The barrier never resolves (diff throws) - deliberately not awaited.
        void engine.awaitDurable();

        await waitUntil(() => notified.some((n) => n.degraded));
        expect(notified[0].degraded).to.equal(true);

        await waitUntil(() => fatalCount > 0, 3000);
        await delay(60);
        expect(fatalCount).to.equal(1);
    });

    it("awaitDurable resolves via an empty-ops flush when nothing was mutated", async function () {
        const port = new GatedPort();
        const map = new Map<string, SigValue>();
        map.set("k", { key: "k", sigs: ["a"] });

        const engine = new PersistenceEngine({ port, onFatal: noop });
        engine.register(sigSchema("s", map));

        await engine.awaitDurable(); // flush 1: one put
        const commitsAfterFirst = port.commitCount;

        // Nothing mutated: the flush produces empty ops but the barrier still
        // resolves - and no redundant commit is issued.
        await engine.awaitDurable();
        expect(port.commitCount).to.equal(commitsAfterFirst);
    });

    it("dispose stops the flush interval and closes the port", async function () {
        const port = new GatedPort();
        const map = new Map<string, SigValue>();
        map.set("k", { key: "k", sigs: ["a"] });

        const engine = new PersistenceEngine({
            port,
            onFatal: noop,
            flushIntervalMs: 10
        });
        engine.register(sigSchema("s", map));

        await waitUntil(() => port.commitCount >= 1); // interval flushed k
        await engine.dispose();
        expect(port.closeCount).to.equal(1);

        // A live interval would flush this mutation; a disposed one must not.
        map.set("k2", { key: "k2", sigs: ["b"] });
        const commitsAtDispose = port.commitCount;
        await delay(40);
        expect(port.commitCount).to.equal(commitsAtDispose);
        expect(
            (await collect(port.load("s"))).some((r) => r.key === "k2")
        ).to.equal(false);
    });

    it("a flush enqueued before dispose does not commit into the closed port", async function () {
        const port = new GatedPort();
        port.gated = true;
        const map = new Map<string, SigValue>();
        map.set("k1", { key: "k1", sigs: ["a"] });

        const engine = new PersistenceEngine({ port, onFatal: noop });
        engine.register(sigSchema("s", map));

        // Flush A starts and blocks mid-commit on the gate.
        const barrierA = engine.awaitDurable();
        await waitUntil(() => port.commitCount === 1);

        // Flush B is enqueued behind A; its snapshot is not yet taken.
        map.set("k2", { key: "k2", sigs: ["b"] });
        void engine.awaitDurable(); // stays pending past dispose - never rejects

        // dispose() marks terminal and closes the port while A is in flight.
        const disposed = engine.dispose();
        port.releaseNext(); // let A finish
        await disposed;
        await barrierA;
        await delay(20);

        // B's runFlush hit the terminal guard: no commit landed after close.
        expect(port.commitCount).to.equal(1);
        expect(port.closeCount).to.equal(1);

        // Double dispose is idempotent.
        await engine.dispose();
        expect(port.closeCount).to.equal(1);
    });

    it("registeredIds reflects every registered schema", function () {
        const engine = new PersistenceEngine({
            port: new GatedPort(),
            onFatal: noop
        });
        engine.register(sigSchema("a", new Map()));
        engine.register(sigSchema("b", new Map()));

        expect([...engine.registeredIds()].sort()).to.deep.equal(["a", "b"]);
    });
});
