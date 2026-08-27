// @spec-test-coverage-ignore: developer diagnostics tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";

import { LogStore } from "@/utils/logging/logStore";
import type { LogEntry } from "@/utils/logging/Logger";

function entry(message: string): LogEntry {
    return {
        time: "1",
        wallTimeMs: 1,
        level: "info",
        context: { component: "LogStoreTest" },
        sharedContext: { threadName: "main" },
        message,
        meta: [],
        stack: "stack"
    };
}

// a few hundred bytes per entry -> this store holds a handful, so eviction is
// reachable without thousands of writes
const SMALL_STORE_BYTES = 2000;

describe("LogStore", function () {
    it("keeps sequence numbers monotonic across eviction", function () {
        const store = new LogStore(SMALL_STORE_BYTES, true);
        for (let i = 0; i < 40; i++) store.store(entry(`entry ${i}`));

        const delta = store.getLogsSince(-1);

        expect(delta.entries.length).to.be.lessThan(40);
        expect(delta.toSeq).to.equal(39);
        expect(delta.fromSeq).to.equal(40 - delta.entries.length);
        expect(delta.entries[delta.entries.length - 1].message).to.equal(
            "entry 39"
        );
    });

    it("returns only entries after the cursor", function () {
        const store = new LogStore(1024 * 1024, true);
        for (let i = 0; i < 5; i++) store.store(entry(`entry ${i}`));

        const delta = store.getLogsSince(1);

        expect(delta.fromSeq).to.equal(2);
        expect(delta.toSeq).to.equal(4);
        expect(delta.entries.map((item) => item.message)).to.deep.equal([
            "entry 2",
            "entry 3",
            "entry 4"
        ]);
    });

    it("reports an empty delta without moving the cursor", function () {
        const store = new LogStore(1024 * 1024, true);
        for (let i = 0; i < 3; i++) store.store(entry(`entry ${i}`));

        const delta = store.getLogsSince(2);

        expect(delta.entries).to.have.length(0);
        expect(delta.fromSeq).to.equal(3);
        expect(delta.toSeq).to.equal(2);
    });

    it("reports a gap when eviction outran the cursor", function () {
        const store = new LogStore(SMALL_STORE_BYTES, true);
        for (let i = 0; i < 40; i++) store.store(entry(`entry ${i}`));

        const delta = store.getLogsSince(0);

        // eviction outran the cursor -> the jump is the gap
        expect(delta.fromSeq).to.be.greaterThan(1);
        expect(delta.toSeq).to.equal(39);
        expect(delta.entries).to.have.length(delta.toSeq - delta.fromSeq + 1);
    });
});
