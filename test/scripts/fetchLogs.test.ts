import { expect } from "chai";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";

import {
    encodeChunk,
    listenOn,
    loadCrashLogServer,
    paddedLogEntries,
    withInflateCeiling,
    upload,
    uploadBody
} from "@test/fixtures/logging/crashLogServer.fixture";
import {
    fetchLogEntries,
    persistLogEntries
} from "../../scripts/logging/logFetch";

const { app, logDir: TEST_LOG_DIR } = loadCrashLogServer();

/** the fetch tool against the real server: a read the server cut short must
 *  say so in the file it writes, where the reader starts */
describe("fetch-logs", function () {
    let server: Server;
    let baseUrl: string;
    let outputDir: string;

    before(async function () {
        ({ server, baseUrl } = await listenOn(app));
        outputDir = mkdtempSync(path.join(tmpdir(), "fetch-logs-test-"));
    });

    after(function () {
        server.close();
        rmSync(TEST_LOG_DIR, { recursive: true, force: true });
        rmSync(outputDir, { recursive: true, force: true });
    });

    it("marks a persisted log the server read short", async function () {
        const channelId = "0x" + "f1".repeat(32);
        const peerAddress = "0x" + "f2".repeat(20);
        expect(
            await upload(baseUrl, uploadBody({ channelId, peerAddress }))
        ).to.equal(200);
        // ~100 KB inflated: past the ceiling the read below runs at
        expect(
            await upload(
                baseUrl,
                uploadBody({
                    channelId,
                    peerAddress,
                    storeId: "fatstore",
                    compressedLogs: encodeChunk(paddedLogEntries(100, "fat")),
                    fromSeq: 0,
                    toSeq: 99
                })
            )
        ).to.equal(200);

        const fetched = await withInflateCeiling("0.05", () =>
            fetchLogEntries({ baseUrl, channelId, peerAddress })
        );

        // the read really was cut short, or the case proves nothing
        expect(fetched.skippedChunks).to.equal(1);
        expect(fetched.logEntries).to.have.length(3);

        const outputPath = await persistLogEntries({
            outputDir,
            channelId,
            peerAddress,
            ...fetched
        });
        const written = readFileSync(outputPath, "utf8");
        expect(written).to.include("skipped stored chunks");
        expect(written).to.include("skippedChunks");
        expect(written).to.include("entry 2");
    });

    it("writes no marker for a read the server completed", async function () {
        const channelId = "0x" + "f3".repeat(32);
        const peerAddress = "0x" + "f4".repeat(20);
        expect(
            await upload(baseUrl, uploadBody({ channelId, peerAddress }))
        ).to.equal(200);

        const fetched = await fetchLogEntries({
            baseUrl,
            channelId,
            peerAddress
        });
        expect(fetched.skippedChunks).to.equal(0);

        const outputPath = await persistLogEntries({
            outputDir,
            channelId,
            peerAddress,
            ...fetched
        });
        const written = readFileSync(outputPath, "utf8");
        expect(written).to.not.include("skipped stored chunks");
        expect(written).to.include("entry 2");
    });
});
