// @spec-test-coverage-ignore: developer diagnostics tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";

import type { LogEntry } from "@/utils/logging/Logger";

// The chunk helpers are a CommonJS dev-script module shared with the crash-log
// server, required here the same way the server helper is.
const {
    chunkFileName,
    parseChunkFileName,
    encodeChunk,
    decodeChunk,
    mergeChunks
} = require("../../scripts/logging/logChunks.js") as {
    chunkFileName: (fromSeq: number, toSeq: number) => string;
    parseChunkFileName: (
        name: string
    ) => { fromSeq: number; toSeq: number } | null;
    encodeChunk: (entries: LogEntry[]) => string;
    decodeChunk: (base64: string) => LogEntry[];
    mergeChunks: ((perThread: {
        [threadName: string]: Array<{
            storeId?: string;
            fromSeq: number;
            toSeq: number;
            base64: string;
        }>;
    }) => LogEntry[]) & { lastSkippedChunks: number };
};

function entry(
    message: string,
    wallTimeMs: number,
    threadName: "main" | "sdk" | "vm"
): LogEntry {
    return {
        time: String(Math.floor(wallTimeMs / 1000)),
        wallTimeMs,
        level: "info",
        context: { component: "LogChunksTest" },
        sharedContext: { threadName },
        message,
        meta: [],
        stack: "stack"
    };
}

function chunk(fromSeq: number, entries: LogEntry[]) {
    return {
        fromSeq,
        toSeq: fromSeq + entries.length - 1,
        base64: encodeChunk(entries)
    };
}

describe("logChunks", function () {
    it("names and parses a chunk by its sequence range", function () {
        const name = chunkFileName(3, 17);

        expect(parseChunkFileName(name)).to.deep.equal({
            fromSeq: 3,
            toSeq: 17
        });
        // Zero padding makes a lexical directory sort a numeric one.
        expect(
            [chunkFileName(10, 10), chunkFileName(2, 2)].sort()
        ).to.deep.equal([chunkFileName(2, 2), chunkFileName(10, 10)]);
        expect(parseChunkFileName("not-a-chunk")).to.equal(null);
    });

    it("merges three threads into one ordered stream", function () {
        const merged = mergeChunks({
            main: [chunk(0, [entry("main a", 100, "main")])],
            sdk: [
                chunk(0, [
                    entry("sdk a", 50, "sdk"),
                    entry("sdk b", 150, "sdk")
                ])
            ],
            vm: [chunk(0, [entry("vm a", 120, "vm")])]
        });

        expect(merged.map((item) => item.message)).to.deep.equal([
            "sdk a",
            "main a",
            "vm a",
            "sdk b"
        ]);
    });

    it("merges overlapping chunks without duplicates", function () {
        const first = entry("one", 10, "sdk");
        const second = entry("two", 20, "sdk");
        const third = entry("three", 30, "sdk");

        // A lost 2xx makes the client re-send a range it already stored.
        const merged = mergeChunks({
            sdk: [chunk(0, [first, second]), chunk(0, [first, second, third])]
        });

        expect(merged.map((item) => item.message)).to.deep.equal([
            "one",
            "two",
            "three"
        ]);
    });

    it("skips an undecodable chunk", function () {
        const merged = mergeChunks({
            sdk: [
                { fromSeq: 0, toSeq: 0, base64: "not base64 gzip at all" },
                chunk(1, [entry("survivor", 10, "sdk")])
            ]
        });

        expect(merged.map((item) => item.message)).to.deep.equal(["survivor"]);
    });

    it("keeps the gap when a chunk is missing", function () {
        const merged = mergeChunks({
            sdk: [
                chunk(0, [entry("before gap", 10, "sdk")]),
                chunk(5, [entry("after gap", 20, "sdk")])
            ]
        });

        // No filler entries invented for 1..4 - the gap simply stays a gap.
        expect(merged.map((item) => item.message)).to.deep.equal([
            "before gap",
            "after gap"
        ]);
        expect(decodeChunk(encodeChunk(merged))).to.have.length(2);
    });

    // [PO1] the budget is shared across a whole merged read, not per chunk
    it("stops a merged read at the shared inflate budget and reports it", function () {
        const previous = process.env.CRASH_LOG_MAX_SIZE_MB;
        process.env.CRASH_LOG_MAX_SIZE_MB = "1";
        try {
            // each chunk fits the per-chunk bound; together they pass it
            // ~400 KB inflated: comfortably under the 1 MB per-chunk bound
            const padded = encodeChunk(
                Array.from({ length: 1_000 }, (_unused, i) =>
                    entry(`padding ${"x".repeat(200)}`, 1000 + i, "vm")
                )
            );
            const chunk = (index: number) => ({
                storeId: `s${index}`,
                fromSeq: 0,
                toSeq: 999,
                base64: padded
            });

            // 100 x ~400 KB = ~40 MB, past the 20-store shared budget
            const merged = mergeChunks({
                vm: Array.from({ length: 100 }, (_unused, i) => chunk(i))
            });

            expect(mergeChunks.lastSkippedChunks).to.be.greaterThan(0);
            // a partial read, not an empty one
            expect(merged.length).to.be.greaterThan(0);
        } finally {
            process.env.CRASH_LOG_MAX_SIZE_MB = previous;
        }
    });

    // [TO4] the bound must stop the inflate, not check the size after it
    it("refuses a chunk that inflates past the configured maximum", function () {
        const previous = process.env.CRASH_LOG_MAX_SIZE_MB;
        process.env.CRASH_LOG_MAX_SIZE_MB = "1";
        try {
            const many = Array.from({ length: 40_000 }, (_unused, index) =>
                entry(`padding ${"x".repeat(200)}`, 1000 + index, "vm")
            );

            expect(() => decodeChunk(encodeChunk(many))).to.throw(
                "inflates past"
            );
        } finally {
            process.env.CRASH_LOG_MAX_SIZE_MB = previous;
        }
    });

    // [TO5] the required-field policy, applied on the read side
    it("drops an entry with no wall-clock timestamp from the merge", function () {
        const good = entry("readable", 1000, "vm");
        const broken = {
            ...entry("unreadable", 1001, "vm")
        } as Partial<LogEntry>;
        delete broken.wallTimeMs;
        const base64 = encodeChunk([good, broken as LogEntry]);

        const merged = mergeChunks({
            vm: [{ storeId: "s1", fromSeq: 0, toSeq: 1, base64 }]
        });

        expect(merged.map((item) => item.message)).to.deep.equal(["readable"]);
    });

    it("keeps the sequence of entries after a dropped one aligned", function () {
        const broken = {
            ...entry("unreadable", 1000, "vm")
        } as Partial<LogEntry>;
        delete broken.wallTimeMs;
        const base64 = encodeChunk([
            broken as LogEntry,
            entry("second", 1001, "vm"),
            entry("third", 1002, "vm")
        ]);

        const merged = mergeChunks({
            vm: [{ storeId: "s1", fromSeq: 0, toSeq: 2, base64 }]
        });

        // the dropped entry still consumed its index, so 1 and 2 keep their seq
        expect(merged.map((item) => item.message)).to.deep.equal([
            "second",
            "third"
        ]);
    });
});
