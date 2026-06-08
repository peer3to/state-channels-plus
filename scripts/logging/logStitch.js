"use strict";

// Dependency-free stitch logic shared by the crash-log server and its tests.
const { decompressSync, strFromU8 } = require("fflate");

// base64 -> gunzip -> JSON array of per-entry JSON strings (mirrors logEncoder)
function decodeLogs(compressedLogs) {
    const bytes = Uint8Array.from(Buffer.from(compressedLogs, "base64"));
    const serialized = strFromU8(decompressSync(bytes));
    const arr = JSON.parse(serialized);
    if (!Array.isArray(arr))
        throw new Error("Failed to deserialize log entries");
    return arr.map((s) => JSON.parse(s));
}

// NDJSON lines for a delta batch from fromSeq; skips seq <= lastWrittenSeq (retry overlap).
// No gap marker needed: a jump in seq between adjacent lines is itself the gap, read-time.
function buildAppendLines(entries, fromSeq, lastWrittenSeq) {
    const lines = [];
    let newLastSeq = lastWrittenSeq;
    for (let i = 0; i < entries.length; i++) {
        const seq = fromSeq + i;
        if (seq <= lastWrittenSeq) continue;
        lines.push(JSON.stringify({ seq, ...entries[i] }));
        newLastSeq = seq;
    }
    return { lines, newLastSeq };
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
