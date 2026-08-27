// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import path from "path";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    utimesSync
} from "node:fs";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// set before the server module is required: it reads CRASH_LOG_DIR at import
const TEST_LOG_DIR = mkdtempSync(path.join(tmpdir(), "crash-log-server-test-"));
process.env.CRASH_LOG_DIR = TEST_LOG_DIR;

// The crash-log server is a CommonJS dev script. Its start() is guarded by
// `require.main === module`, so requiring it here only imports the helper and
// does not spin up a server.
type UploadValidation =
    | { ok: true }
    | { ok: false; status: number; error: string };

const { app, sanitizeSegment, validateUploadBody } =
    require("../../scripts/logging/crash-log-server.js") as {
        app: { listen: (port: number, host: string) => Server };
        sanitizeSegment: (value: unknown) => string;
        validateUploadBody: (body: unknown) => UploadValidation;
    };

const { encodeChunk, decodeChunk } =
    require("../../scripts/logging/logChunks.js") as {
        encodeChunk: (entries: unknown[]) => string;
        decodeChunk: (base64: string) => { message: string }[];
    };

function logEntries(count: number): unknown[] {
    return Array.from({ length: count }, (_unused, index) => ({
        time: "1",
        wallTimeMs: 1 + index,
        level: "info",
        context: {},
        sharedContext: { threadName: "vm" },
        message: `entry ${index}`,
        meta: [],
        stack: "stack"
    }));
}

/** entries fat enough that a handful of chunks exhaust a lowered merge budget */
function paddedLogEntries(count: number, marker: string): unknown[] {
    return Array.from({ length: count }, (_unused, index) => ({
        time: "1",
        wallTimeMs: 1 + index,
        level: "info",
        context: {},
        sharedContext: { threadName: "vm" },
        message: `${marker} ${index}`,
        meta: [],
        stack: `${marker}-${index}-`.padEnd(1000, "x")
    }));
}

function uploadBody(overrides: Record<string, unknown> = {}) {
    return {
        channelId: "0x" + "ab".repeat(32),
        peerAddress: "0x" + "cd".repeat(20),
        threadName: "vm",
        storeId: "a1b2c3d4",
        compressedLogs: encodeChunk(logEntries(3)),
        fromSeq: 0,
        toSeq: 2,
        ...overrides
    };
}

/**
 * Regression: channelId / peerAddress are attacker-controlled and used to build
 * on-disk paths under LOG_DIR. sanitizeSegment must neutralize any path
 * traversal so a crafted value can't write/read outside the log directory.
 */
describe("crash-log-server sanitizeSegment - path traversal", function () {
    const LOG_DIR = "/var/crash-logs";

    it("leaves legitimate hex ids / addresses unchanged", function () {
        const channelId = "0x" + "ab".repeat(32);
        const address = "0x" + "cd".repeat(20);
        expect(sanitizeSegment(channelId)).to.equal(channelId);
        expect(sanitizeSegment(address)).to.equal(address);
    });

    it("replaces every disallowed character with _", function () {
        expect(sanitizeSegment("a.b/c\\d:e")).to.equal("a_b_c_d_e");
    });

    it("keeps a sanitized segment contained under LOG_DIR", function () {
        for (const evil of [
            "../../../../tmp/pwn",
            "..\\..\\windows",
            "/etc/passwd",
            "../secret",
            ".."
        ]) {
            const safe = sanitizeSegment(evil);
            // No separators survive...
            expect(safe).to.not.match(/[/\\]/);
            // ...and joining it under LOG_DIR cannot escape LOG_DIR.
            const resolved = path.resolve(LOG_DIR, `${safe}_ts`);
            expect(
                resolved.startsWith(path.resolve(LOG_DIR) + path.sep)
            ).to.equal(true);
        }
    });

    it("keeps a sanitized thread segment under LOG_DIR", function () {
        for (const evil of ["../../../../tmp/pwn", "..\\..\\windows", ".."]) {
            const safe = sanitizeSegment(evil);
            expect(safe).to.not.match(/[/\\]/);
            const resolved = path.resolve(LOG_DIR, "peer", safe);
            expect(
                resolved.startsWith(path.resolve(LOG_DIR) + path.sep)
            ).to.equal(true);
        }
    });
});

/** fromSeq / toSeq become chunk file names -> a non-integer or negative one sorts
 *  wrong and corrupts the merged read */
describe("crash-log-server validateUploadBody", function () {
    it("accepts a well-formed chunk upload", function () {
        expect(validateUploadBody(uploadBody())).to.deep.equal({ ok: true });
    });

    it("rejects a non-integer sequence range", function () {
        for (const range of [
            { fromSeq: Number.NaN, toSeq: 2 },
            { fromSeq: 0, toSeq: 2.5 },
            { fromSeq: -1, toSeq: 2 },
            { fromSeq: 1e300, toSeq: 1e300 },
            { fromSeq: 5, toSeq: 2 }
        ]) {
            const result = validateUploadBody(uploadBody(range));
            expect(result.ok, JSON.stringify(range)).to.equal(false);
            if (result.ok) throw new Error("expected a rejection");
            expect(result.status).to.equal(400);
        }
    });

    it("rejects an upload with no store id", function () {
        const result = validateUploadBody(uploadBody({ storeId: undefined }));

        expect(result.ok).to.equal(false);
        if (result.ok) throw new Error("expected a rejection");
        expect(result.status).to.equal(400);
    });

    it("rejects a chunk whose entry count disagrees with its range", function () {
        const result = validateUploadBody(uploadBody({ toSeq: 5 }));

        expect(result.ok).to.equal(false);
        if (result.ok) throw new Error("expected a rejection");
        expect(result.status).to.equal(400);
        expect(result.error).to.include("3 entries");
    });

    it("rejects a body with no thread name", function () {
        const result = validateUploadBody(
            uploadBody({ threadName: undefined })
        );

        expect(result.ok).to.equal(false);
        if (result.ok) throw new Error("expected a rejection");
        expect(result.status).to.equal(400);
    });
});

/**
 * the POST and GET routes end to end. the unit cases above call
 * validateUploadBody directly, so a handler that never destructures a field it
 * uses passes them and still 500s on every real upload.
 */
describe("crash-log-server routes", function () {
    let server: Server;
    let baseUrl: string;

    before(async function () {
        server = app.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(function () {
        server.close();
        rmSync(TEST_LOG_DIR, { recursive: true, force: true });
    });

    async function upload(body: Record<string, unknown>): Promise<number> {
        const response = await fetch(`${baseUrl}/logs/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return response.status;
    }

    it("stores an uploaded chunk and reads it back merged", async function () {
        const body = uploadBody();

        expect(await upload(body)).to.equal(200);

        const read = await fetch(
            `${baseUrl}/logs/${body.channelId}/${body.peerAddress}`
        );
        expect(read.status).to.equal(200);
        const merged = decodeChunk(await read.text());
        expect(merged.map((entry) => entry.message)).to.deep.equal([
            "entry 0",
            "entry 1",
            "entry 2"
        ]);
    });

    it("keeps two stores with the same sequence range apart", async function () {
        const channelId = "0x" + "12".repeat(32);
        const peerAddress = "0x" + "34".repeat(20);
        const first = uploadBody({
            channelId,
            peerAddress,
            storeId: "aaaa1111"
        });
        const second = uploadBody({
            channelId,
            peerAddress,
            storeId: "bbbb2222",
            compressedLogs: encodeChunk(logEntries(3))
        });

        expect(await upload(first)).to.equal(200);
        expect(await upload(second)).to.equal(200);

        const read = await fetch(`${baseUrl}/logs/${channelId}/${peerAddress}`);
        // same seq range from two runs -> six entries, not three overwritten
        expect(decodeChunk(await read.text())).to.have.length(6);
    });

    // [TO6] a round fires peers x realms uploads at once. an existing dir older
    // than the rotation age makes every one of them decide to rotate, so without
    // serialization the losing renames ENOENT into a 500.
    it("keeps concurrent uploads for one channel in a single directory", async function () {
        const channelId = "0x" + "78".repeat(32);
        // dated a year back, well past CHANNEL_DIR_MAX_AGE_MS
        mkdirSync(path.join(TEST_LOG_DIR, `${channelId}_01-01-2020#00:00:00`), {
            recursive: true
        });

        const uploads = Array.from({ length: 8 }, (_unused, index) =>
            upload(
                uploadBody({
                    channelId,
                    storeId: `store${index}`,
                    peerAddress: "0x" + String(index).repeat(40).slice(0, 40)
                })
            )
        );

        const statuses = await Promise.all(uploads);

        expect(statuses).to.deep.equal(Array.from({ length: 8 }, () => 200));
        const dirs = readdirSync(TEST_LOG_DIR).filter((name) =>
            name.startsWith(channelId)
        );
        expect(dirs).to.have.length(1);
    });

    // [FR2] store ids are random, so name order says nothing about which run is
    // newest. when the shared inflate budget truncates a read it must drop the
    // oldest run, not whichever id happens to sort first.
    it("keeps the newest store when a merged read runs out of budget", async function () {
        const channelId = "0x" + "9a".repeat(32);
        const peerAddress = "0x" + "9b".repeat(20);
        const oldStore = "zzzzzzzz";
        const newStore = "aaaaaaaa";
        const perChunk = 40;

        // 26 chunks of ~40 KB: more than the 20-store budget allows at the
        // lowered ceiling below
        for (let index = 0; index < 26; index += 1) {
            const fromSeq = index * perChunk;
            expect(
                await upload(
                    uploadBody({
                        channelId,
                        peerAddress,
                        storeId: oldStore,
                        compressedLogs: encodeChunk(
                            paddedLogEntries(perChunk, "old run")
                        ),
                        fromSeq,
                        toSeq: fromSeq + perChunk - 1
                    })
                )
            ).to.equal(200);
        }
        expect(
            await upload(
                uploadBody({
                    channelId,
                    peerAddress,
                    storeId: newStore,
                    compressedLogs: encodeChunk(
                        paddedLogEntries(perChunk, "new run")
                    ),
                    fromSeq: 0,
                    toSeq: perChunk - 1
                })
            )
        ).to.equal(200);

        const channelDir = readdirSync(TEST_LOG_DIR).find((name) =>
            name.startsWith(channelId)
        )!;
        const threadDir = path.join(
            TEST_LOG_DIR,
            channelDir,
            peerAddress,
            "vm"
        );
        // explicit ages: the two runs land within the same millisecond otherwise
        const now = Date.now() / 1000;
        utimesSync(path.join(threadDir, oldStore), now - 600, now - 600);
        utimesSync(path.join(threadDir, newStore), now, now);

        const previousMaxSizeMb = process.env.CRASH_LOG_MAX_SIZE_MB;
        // ~50 KB per chunk, so the whole read gets ~1 MB
        process.env.CRASH_LOG_MAX_SIZE_MB = "0.05";
        let read: Response;
        try {
            read = await fetch(`${baseUrl}/logs/${channelId}/${peerAddress}`);
        } finally {
            if (previousMaxSizeMb === undefined) {
                delete process.env.CRASH_LOG_MAX_SIZE_MB;
            } else {
                process.env.CRASH_LOG_MAX_SIZE_MB = previousMaxSizeMb;
            }
        }

        expect(read.status).to.equal(200);
        // the read really was truncated, or the case proves nothing
        expect(Number(read.headers.get("x-skipped-chunks"))).to.be.greaterThan(
            0
        );
        const messages = decodeChunk(await read.text()).map(
            (entry) => entry.message
        );
        expect(
            messages.some((message) => message.startsWith("new run"))
        ).to.equal(true);
    });

    it("lists stored chunks in the index", async function () {
        const body = uploadBody({ channelId: "0x" + "56".repeat(32) });

        expect(await upload(body)).to.equal(200);

        const index = (await (
            await fetch(`${baseUrl}/logs/index`)
        ).json()) as Record<string, Record<string, Record<string, string[]>>>;
        const chunks = Object.values(index)
            .flatMap((peers) => Object.values(peers))
            .flatMap((threads) => Object.values(threads))
            .flat();
        expect(chunks.some((name) => name.includes("/"))).to.equal(true);
    });
});
