import { LogStore } from "@/utils/logging/logStore";
import { logStoreEntry as entry } from "@test/fixtures/logging/LogStoreFixture";
import { expect } from "chai";

// a few hundred bytes per entry -> this store holds a handful, so eviction is
// reachable without thousands of writes
const SMALL_STORE_BYTES = 2000;

describe("LogStore", function () {
    it("rejects an infinite storage limit", function () {
        expect(() => new LogStore(Infinity, true)).to.throw("must be finite");
    });
    it("rejects a NaN storage limit", function () {
        expect(() => new LogStore(NaN, true)).to.throw("must be finite");
    });
    it("rejects a negative storage limit", function () {
        expect(() => new LogStore(-1, true)).to.throw("must be finite");
    });
    it("evicts an entry larger than the entire storage limit", function () {
        const store = new LogStore(1, true);
        store.store(entry("oversized entry"));
        expect(store.getAllLogs()).to.have.length(0);
    });
    it("retains no entries with a zero storage limit", function () {
        const store = new LogStore(0, true);
        store.store(entry("zero capacity"));
        expect(store.getAllLogs()).to.have.length(0);
    });
    it("draws a 64-bit store id that no two stores share", function () {
        const ids = new Set(
            Array.from(
                { length: 200 },
                () => new LogStore(SMALL_STORE_BYTES, true).storeId
            )
        );

        for (const id of ids) expect(id).to.match(/^[0-9a-f]{16}$/);
        expect(ids.size).to.equal(200);
    });

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
