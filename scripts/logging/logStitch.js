"use strict";

// Dependency-free stitch logic shared by the crash-log server and its tests.
const { decompressSync, strFromU8 } = require("fflate");

// base64 -> gunzip -> JSON array of per-entry JSON strings (mirrors logEncoder)
function decodeLogs(compressedLogs) {
    const bytes = Uint8Array.from(Buffer.from(compressedLogs, "base64"));
    const serialized = strFromU8(decompressSync(bytes));
    const arr = JSON.parse(serialized);
    return Array.isArray(arr) ? arr.map((s) => JSON.parse(s)) : arr;
}

// NDJSON lines for a delta batch starting at fromSeq; skips seq <= lastWrittenSeq, marks gaps.
function buildAppendLines(entries, fromSeq, lastWrittenSeq) {
    const lines = [];
    let gap = null;

    if (fromSeq > lastWrittenSeq + 1) {
        gap = [lastWrittenSeq + 1, fromSeq - 1];
        lines.push(JSON.stringify({ gap }));
    }

    let newLastSeq = lastWrittenSeq;
    for (let i = 0; i < entries.length; i++) {
        const seq = fromSeq + i;
        if (seq <= lastWrittenSeq) continue; // dedup retry overlap
        lines.push(JSON.stringify({ seq, ...entries[i] }));
        newLastSeq = seq;
    }
    return { lines, newLastSeq, gap };
}

// lastWrittenSeq from the last seq-bearing line.
function parseLastSeq(ndjson) {
    if (!ndjson) return -1;
    const lines = ndjson.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
            const obj = JSON.parse(line);
            if (typeof obj.seq === "number") return obj.seq;
        } catch {
            // ignore unparseable lines
        }
    }
    return -1;
}

module.exports = { decodeLogs, buildAppendLines, parseLastSeq };
