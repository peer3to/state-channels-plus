import { expect } from "chai";
import { LogStore } from "@/utils/logging/logStore";
import { LogEntry } from "@/utils/logging/Logger";

function entry(message: string): LogEntry {
    return {
        time: "t",
        level: "warn",
        context: {},
        sharedContext: {},
        message,
        meta: [],
        stack: ""
    };
}

describe("LogStore seq + getLogsSince", () => {
    it("assigns contiguous seqs and returns only entries after the cursor", () => {
        const store = new LogStore(10 * 1024 * 1024, true); // big: no eviction
        for (let i = 0; i < 5; i++) store.store(entry(`m${i}`));

        const all = store.getLogsSince(-1);
        expect(all.fromSeq).to.equal(0);
        expect(all.toSeq).to.equal(4);
        expect(all.entries.map((e) => e.message)).to.deep.equal([
            "m0",
            "m1",
            "m2",
            "m3",
            "m4"
        ]);

        const delta = store.getLogsSince(2);
        expect(delta.fromSeq).to.equal(3);
        expect(delta.toSeq).to.equal(4);
        expect(delta.entries.map((e) => e.message)).to.deep.equal(["m3", "m4"]);
    });

    it("returns an empty range when nothing is newer than the cursor", () => {
        const store = new LogStore(10 * 1024 * 1024, true);
        store.store(entry("only"));
        const r = store.getLogsSince(0);
        expect(r.entries).to.deep.equal([]);
        expect(r.fromSeq).to.equal(1);
        expect(r.toSeq).to.equal(0); // empty: from > to
    });

    it("reports a gap (fromSeq jumps) when eviction outran the cursor", () => {
        // Small cap forces eviction of the oldest entries.
        const store = new LogStore(2000, true);
        for (let i = 0; i < 100; i++) store.store(entry(`big-message-${i}`));

        const r = store.getLogsSince(-1);
        expect(r.toSeq).to.equal(99); // newest is always retained
        expect(r.fromSeq).to.be.greaterThan(0); // oldest entries evicted
        expect(r.entries.length).to.equal(r.toSeq - r.fromSeq + 1); // contiguous
    });
});
