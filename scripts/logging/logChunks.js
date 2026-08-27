/**
 * chunk naming / decoding / merging, shared by the crash-log server and its
 * tests. CommonJS and fflate-only, since the server is a plain node script.
 */

const { compressSync, Decompress, strToU8, strFromU8 } = require("fflate");

// wide enough that seq never overflows the padding -> lexical sort is numeric
const SEQ_DIGITS = 12;
const CHUNK_NAME_PATTERN = new RegExp(
    `^([0-9]{${SEQ_DIGITS}})-([0-9]{${SEQ_DIGITS}})\\.b64$`
);

// how many whole stores a single merged read may inflate before it stops
const MERGE_CHUNK_BUDGET = 20;

function maxInflatedBytes() {
    const configured = Number(process.env.CRASH_LOG_MAX_SIZE_MB);
    const megabytes =
        Number.isFinite(configured) && configured > 0 ? configured : 10;
    return megabytes * 1024 * 1024;
}

function padSeq(seq) {
    return String(seq).padStart(SEQ_DIGITS, "0");
}

function chunkFileName(fromSeq, toSeq) {
    return `${padSeq(fromSeq)}-${padSeq(toSeq)}.b64`;
}

function parseChunkFileName(name) {
    const match = CHUNK_NAME_PATTERN.exec(String(name));
    if (!match) return null;
    return { fromSeq: Number(match[1]), toSeq: Number(match[2]) };
}

function isSafeSeq(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

// stops at the limit while inflating: checking the size afterwards would have
// already allocated whatever a small chunk expands to
function inflateBounded(bytes, maxBytes) {
    const parts = [];
    let total = 0;
    const stream = new Decompress((chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
            throw new Error(`Chunk inflates past the ${maxBytes} byte maximum`);
        }
        parts.push(chunk);
    });
    stream.push(bytes, true);

    const inflated = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        inflated.set(part, offset);
        offset += part.length;
    }
    return inflated;
}

// the same required fields decodeLogEntry enforces -> the server never stores
// an entry the SDK decoder would later throw on
function isDecodableEntry(entry) {
    return (
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof entry.time === "string" &&
        entry.time !== "" &&
        typeof entry.wallTimeMs === "number" &&
        typeof entry.level === "string" &&
        entry.level !== "" &&
        Boolean(entry.context) &&
        typeof entry.context === "object" &&
        Boolean(entry.sharedContext) &&
        typeof entry.sharedContext === "object" &&
        typeof entry.message === "string" &&
        Array.isArray(entry.meta) &&
        typeof entry.stack === "string"
    );
}

// a merge walks every chunk ever written for a peer, so the per-chunk bound is
// not enough on its own - the budget is shared across the whole read
function mergeBudget() {
    return { remaining: maxInflatedBytes() * MERGE_CHUNK_BUDGET };
}

function decodeChunkWithin(base64, budget) {
    const bytes = Uint8Array.from(Buffer.from(String(base64), "base64"));
    const inflated = inflateBounded(
        bytes,
        Math.min(budget.remaining, maxInflatedBytes())
    );
    budget.remaining -= inflated.length;
    const parsed = JSON.parse(strFromU8(inflated));
    if (!Array.isArray(parsed)) {
        throw new Error("Chunk is not an array of encoded log entries");
    }
    return parsed.map((encodedEntry) => JSON.parse(encodedEntry));
}

/** base64 -> gunzip -> array of per-entry JSON strings, as decodeLogs does */
function decodeChunk(base64) {
    return decodeChunkWithin(base64, mergeBudget());
}

/** the inverse -> a merged read comes back in the format clients decode */
function encodeChunk(entries) {
    const json = JSON.stringify(entries.map((entry) => JSON.stringify(entry)));
    return Buffer.from(compressSync(strToU8(json))).toString("base64");
}

function compareMergedEntries(left, right) {
    const leftWall = Number(left.entry.wallTimeMs);
    const rightWall = Number(right.entry.wallTimeMs);
    if (Number.isFinite(leftWall) && Number.isFinite(rightWall)) {
        if (leftWall !== rightWall) return leftWall - rightWall;
    } else if (Number.isFinite(leftWall) !== Number.isFinite(rightWall)) {
        // no wall clock -> sorts first
        return Number.isFinite(leftWall) ? 1 : -1;
    }

    const leftTime = Number(left.entry.time);
    const rightTime = Number(right.entry.time);
    if (
        Number.isFinite(leftTime) &&
        Number.isFinite(rightTime) &&
        leftTime !== rightTime
    ) {
        return leftTime - rightTime;
    }

    if (left.threadName !== right.threadName) {
        return left.threadName < right.threadName ? -1 : 1;
    }
    if (left.storeId !== right.storeId) {
        return left.storeId < right.storeId ? -1 : 1;
    }
    return left.seq - right.seq;
}

/**
 * merge every thread's chunks into one ordered stream. `perThread` is
 * `{ [thread]: [{ fromSeq, toSeq, base64 }, ...] }`, ascending.
 *
 * de-duped by `(thread, fromSeq + index)`, later chunk wins -> a lost 2xx makes
 * the client re-send an overlapping range. an undecodable or oversized chunk is
 * skipped so one bad chunk can't fail the read.
 */
function mergeChunks(perThread) {
    const byKey = new Map();
    const budget = mergeBudget();
    let skipped = 0;

    for (const [threadName, chunks] of Object.entries(perThread || {})) {
        for (const chunk of chunks || []) {
            let entries;
            try {
                entries = decodeChunkWithin(chunk.base64, budget);
            } catch {
                skipped += 1;
                continue;
            }
            const storeId = chunk.storeId ?? "";
            entries.forEach((entry, index) => {
                // dropped here, not at decode: the index still has to line up
                // with the declared range, and a bad entry must not 400 a chunk
                if (!isDecodableEntry(entry)) return;
                const seq = chunk.fromSeq + index;
                // seq restarts per store -> the store is part of the identity
                byKey.set(`${threadName}:${storeId}:${seq}`, {
                    entry,
                    threadName,
                    storeId,
                    seq
                });
            });
        }
    }

    if (skipped > 0) {
        // never silently: a short merged log must say it is short
        console.warn(
            `[logChunks] merged read skipped ${skipped} chunk(s): undecodable or past the ${MERGE_CHUNK_BUDGET}-store inflate budget`
        );
    }

    const entries = Array.from(byKey.values())
        .sort(compareMergedEntries)
        .map((item) => item.entry);
    // the caller has to be able to say the log is short; a quietly truncated
    // read looks identical to a complete one
    mergeChunks.lastSkippedChunks = skipped;
    return entries;
}

module.exports = {
    SEQ_DIGITS,
    chunkFileName,
    parseChunkFileName,
    isSafeSeq,
    decodeChunk,
    encodeChunk,
    mergeChunks
};
