import { config } from "@/utils/config";
import { LogUploader } from "@/utils/logging/LogUploader";
import {
    messagesOf,
    createUploaderFixture,
    createUploaderOverLoggedStore,
    decodeUpload,
    inflatedBytesOf,
    paddedMessages,
    loadSeparateNodeLogUploader,
    startLogReceiver,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import { deferred } from "@test/utils/deferred";
import { expect } from "chai";
import { ethers } from "ethers";

describe("LogUploader delta uploads", function () {
    let receiver: LogReceiver | undefined;

    beforeEach(async function () {
        receiver = undefined;
        receiver = await startLogReceiver();
    });

    afterEach(async function () {
        const started = receiver;
        receiver = undefined;
        if (started) await started.close();
    });

    it("an idle store resolves without paying the jitter", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            // every draw from this bound is far above the assertion, so a sleep
            // that happens before the empty-delta check always trips it
            jitterMaxMs: 4000
        });
        logger.info("first entry");
        await logUploader.uploadLogs();

        // nothing new -> the empty-delta check must come before the sleep
        const startedAt = Date.now();
        const outcome = await logUploader.uploadLogs();

        expect(outcome).to.deep.equal({ ok: true, entries: 0 });
        expect(Date.now() - startedAt).to.be.lessThan(200);
    });

    it("sends the whole store on the first upload", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("first");
        logger.info("second");

        const outcome = await logUploader.uploadLogs();

        expect(outcome).to.deep.equal({ ok: true, entries: 2 });
        expect(receiver!.requests).to.have.length(1);
        expect(messagesOf(receiver!, 0)).to.deep.equal(["first", "second"]);
    });

    it("sends only entries added since the last upload", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("first");
        await logUploader.uploadLogs();

        logger.info("second");
        const outcome = await logUploader.uploadLogs();

        expect(outcome).to.deep.equal({ ok: true, entries: 1 });
        expect(receiver!.requests).to.have.length(2);
        expect(messagesOf(receiver!, 1)).to.deep.equal(["second"]);
    });

    it("does not POST when there is nothing new", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("first");
        await logUploader.uploadLogs();

        const outcome = await logUploader.uploadLogs();

        expect(outcome).to.deep.equal({ ok: true, entries: 0 });
        expect(receiver!.requests).to.have.length(1);
    });

    it("ends an upload still running when its thread ends, without a retry or its queued follow-up", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async () => {
                await held.promise;
                return 200;
            }
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("held");
        try {
            const running = logUploader.uploadLogs();
            await receiver!.waitForRequests(1);
            logger.info("queued");
            // Queued behind the running upload: it must not start once the thread ended.
            const queued = logUploader.uploadLogs();
            const endedAtMs = Date.now();

            LogUploader.cancelRealmUploads();

            expect(await running).to.deep.equal({ ok: false, entries: 0 });
            expect(await queued).to.deep.equal({ ok: false, entries: 0 });
            expect(Date.now() - endedAtMs).to.be.below(500);
            // No retry and no follow-up after the cancel.
            expect(receiver!.requests).to.have.length(1);
        } finally {
            held.resolve();
        }
    });

    it("ends an upload in its jitter wait when its thread ends, before it posts", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            // Well above the assertion: only a cancel ends the wait in time.
            jitterMaxMs: 5_000
        });
        logger.info("never posted");
        const running = logUploader.uploadLogs();
        const endedAtMs = Date.now();

        LogUploader.cancelRealmUploads();

        expect(await running).to.deep.equal({ ok: false, entries: 0 });
        expect(Date.now() - endedAtMs).to.be.below(500);
        expect(receiver!.requests).to.have.length(0);
    });

    // The tests log at info and upload explicitly: an error line starts an upload of its own.
    it("lets an upload in its jitter wait post before its thread ends", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            jitterMaxMs: 300
        });
        logger.info("hit during dispose");
        const running = logUploader.uploadLogs();

        await LogUploader.settleRealmUploads(5_000);
        LogUploader.cancelRealmUploads();

        expect(await running).to.deep.equal({ ok: true, entries: 1 });
        expect(receiver!.requests).to.have.length(1);
    });

    it("an ending thread waits for an upload of a second copy of the uploader module in it, and cancels it", async function () {
        const { logger, logUploader: separateUploader } = createUploaderFixture(
            {
                uploadEndpoint: receiver!.url,
                jitterMaxMs: 300,
                Uploader: loadSeparateNodeLogUploader()
            }
        );
        logger.info("logged through the separate copy");
        const posted = separateUploader.uploadLogs();

        // This copy's thread end settles the other copy's upload.
        await LogUploader.settleRealmUploads(5_000);
        expect(receiver!.requests).to.have.length(1);
        expect(await posted).to.deep.equal({ ok: true, entries: 1 });

        logger.info("never posted");
        const cancelled = separateUploader.uploadLogs();
        LogUploader.cancelRealmUploads();
        expect(await cancelled).to.deep.equal({ ok: false, entries: 0 });
        expect(receiver!.requests).to.have.length(1);
    });

    it("an ending thread waits for its running upload no longer than its bound", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async () => {
                await held.promise;
                return 200;
            }
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("held");
        try {
            const running = logUploader.uploadLogs();
            await receiver!.waitForRequests(1);
            const endingAtMs = Date.now();

            await LogUploader.settleRealmUploads(200);
            LogUploader.cancelRealmUploads();

            expect(Date.now() - endingAtMs).to.be.below(1_000);
            expect(await running).to.deep.equal({ ok: false, entries: 0 });
        } finally {
            held.resolve();
        }
    });

    it("an ending thread waits no longer for an upload of an abort flush whose deadline passed", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            // Well above the assertion: only the passed deadline ends the wait in time.
            jitterMaxMs: 5_000
        });
        logger.info("left for the cancel");
        const running = logUploader.uploadLogs(Date.now() - 1);
        const endingAtMs = Date.now();

        await LogUploader.settleRealmUploads(5_000);
        LogUploader.cancelRealmUploads();

        expect(Date.now() - endingAtMs).to.be.below(500);
        expect(await running).to.deep.equal({ ok: false, entries: 0 });
    });

    it("an ending thread waits again for a later upload once an abort flush's upload finished", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            jitterMaxMs: 300
        });
        logger.info("flushed");
        expect(await logUploader.uploadLogs(Date.now() + 5_000)).to.deep.equal({
            ok: true,
            entries: 1
        });
        logger.info("hit during dispose, after the flush");
        const running = logUploader.uploadLogs();

        await LogUploader.settleRealmUploads(5_000);
        LogUploader.cancelRealmUploads();

        expect(await running).to.deep.equal({ ok: true, entries: 1 });
        expect(receiver!.requests).to.have.length(2);
    });

    it("an ending thread waits for an upload queued by an error behind an abort flush's upload whose deadline passed", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            jitterMaxMs: 300
        });
        logger.info("flushed");
        const flushed = logUploader.uploadLogs(Date.now() - 1);
        logger.info("hit during dispose, behind the flush");
        const queued = logUploader.uploadLogs();

        await LogUploader.settleRealmUploads(5_000);
        LogUploader.cancelRealmUploads();

        // Nothing was cancelled: both lines arrived, whichever upload read the second one.
        expect((await flushed).ok).to.equal(true);
        expect((await queued).ok).to.equal(true);
        expect(
            receiver!.requests.flatMap((_request, index) =>
                messagesOf(receiver!, index)
            )
        ).to.deep.equal(["flushed", "hit during dispose, behind the flush"]);
    });

    it("an ending thread waits for an upload queued during a running abort flush only until that flush's deadline", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async () => {
                await held.promise;
                return 200;
            }
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("flushed");
        try {
            // Far enough ahead that the held POST is reached before it passes.
            const flushDeadlineMs = Date.now() + 2_000;
            const flushed = logUploader.uploadLogs(flushDeadlineMs);
            await receiver!.waitForRequests(1);
            logger.info("hit during the abort");
            const queued = logUploader.uploadLogs();

            await LogUploader.settleRealmUploads(10_000);
            LogUploader.cancelRealmUploads();

            // Waited for the flush's deadline, and no longer.
            expect(Date.now()).to.be.at.least(flushDeadlineMs - 50);
            expect(Date.now() - flushDeadlineMs).to.be.below(1_000);
            expect(await flushed).to.deep.equal({ ok: false, entries: 0 });
            expect(await queued).to.deep.equal({ ok: false, entries: 0 });
        } finally {
            held.resolve();
        }
    });

    it("a flush cuts short the jitter wait of an error's upload already running, so an ending thread sends it", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            // every draw is far past the flush deadline below
            jitterMaxMs: 60_000
        });
        logger.info("error before the dispose");
        const running = logUploader.uploadLogs();
        logger.info("logged while disposing");
        const flushed = logUploader.uploadLogs(Date.now() + 2_000);

        await LogUploader.settleRealmUploads(10_000);
        LogUploader.cancelRealmUploads();

        expect((await running).ok).to.equal(true);
        expect((await flushed).ok).to.equal(true);
        expect(
            receiver!.requests.flatMap((_request, index) =>
                messagesOf(receiver!, index)
            )
        ).to.deep.equal(["error before the dispose", "logged while disposing"]);
    });

    it("a flush's upload sleeps its jitter at most half the time left to the flush's deadline", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            // every draw is far past the deadline below
            jitterMaxMs: 60_000
        });
        logger.info("logged while disposing");
        const flushDeadlineMs = Date.now() + 2_000;

        const posted = logUploader.uploadLogs(flushDeadlineMs);
        await LogUploader.settleRealmUploads(10_000);
        LogUploader.cancelRealmUploads();

        expect(await posted).to.deep.equal({ ok: true, entries: 1 });
        expect(Date.now()).to.be.below(flushDeadlineMs);
    });

    it("an ending thread waits for an upload queued without a deadline only until a later flush's deadline", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async () => {
                await held.promise;
                return 200;
            }
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("running");
        try {
            const running = logUploader.uploadLogs();
            await receiver!.waitForRequests(1);
            logger.info("queued before the dispose");
            const queued = logUploader.uploadLogs();
            const flushDeadlineMs = Date.now() + 1_000;
            const flushed = logUploader.uploadLogs(flushDeadlineMs);

            await LogUploader.settleRealmUploads(10_000);
            LogUploader.cancelRealmUploads();

            // Waited for the flush's deadline, and no longer.
            expect(Date.now()).to.be.at.least(flushDeadlineMs - 50);
            expect(Date.now() - flushDeadlineMs).to.be.below(1_000);
            expect((await running).ok).to.equal(false);
            expect(await queued).to.deep.equal({ ok: false, entries: 0 });
            expect(flushed).to.equal(queued);
        } finally {
            held.resolve();
        }
    });

    it("an ending thread waits for a request during an abort flush queued behind an earlier upload only until that flush's deadline", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async () => {
                await held.promise;
                return 200;
            }
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("before the abort");
        try {
            const earlier = logUploader.uploadLogs();
            await receiver!.waitForRequests(1);
            logger.info("flushed");
            const flushDeadlineMs = Date.now() + 2_000;
            const flushed = logUploader.uploadLogs(flushDeadlineMs);
            logger.info("hit during the abort");
            const during = logUploader.uploadLogs();

            await LogUploader.settleRealmUploads(10_000);
            LogUploader.cancelRealmUploads();

            expect(Date.now()).to.be.at.least(flushDeadlineMs - 50);
            expect(Date.now() - flushDeadlineMs).to.be.below(1_000);
            expect(await earlier).to.deep.equal({ ok: false, entries: 0 });
            expect(await flushed).to.deep.equal({ ok: false, entries: 0 });
            expect(await during).to.deep.equal({ ok: false, entries: 0 });
        } finally {
            held.resolve();
        }
    });

    it("ends an upload in its retry delay when its thread ends, without the retry", async function () {
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: (_received, index) => (index === 0 ? 500 : 200)
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("refused once");
        // onRetry reads the network snapshot just before the 1 s delay starts.
        const inDelay = deferred();
        const snapshot =
            logUploader["getSyncNetworkSnapshot"].bind(logUploader);
        logUploader["getSyncNetworkSnapshot"] = (endpoint, uploadError) => {
            inDelay.resolve();
            return snapshot(endpoint, uploadError);
        };
        const running = logUploader.uploadLogs();
        await inDelay.promise;
        const endedAtMs = Date.now();

        LogUploader.cancelRealmUploads();

        expect(await running).to.deep.equal({ ok: false, entries: 0 });
        expect(Date.now() - endedAtMs).to.be.below(500);
        // The refused POST only: the retry never starts.
        expect(receiver!.requests).to.have.length(1);
    });

    it("re-sends the delta after a failed upload", async function () {
        await receiver!.close();
        receiver = await startLogReceiver({
            // both attempts - the uploader retries once, so failing only the
            // first would still end in a 2xx
            respond: (_received, index) => (index < 2 ? 500 : 200)
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("first");

        const failed = await logUploader.uploadLogs();
        logger.info("second");
        const succeeded = await logUploader.uploadLogs();

        expect(failed.ok).to.equal(false);
        expect(succeeded.ok).to.equal(true);
        // the failed POST left the watermark alone -> its entry rides along
        const lastBody = receiver!.requests[receiver!.requests.length - 1];
        expect(decodeUpload(lastBody).map((e) => e.message)).to.deep.equal([
            "first",
            "second"
        ]);
        expect(lastBody.fromSeq).to.equal(0);
    });

    it("files an upload under the identity current after the jitter", async function () {
        const before = ethers.Wallet.createRandom().address;
        const after = ethers.Wallet.createRandom().address;
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            sharedContext: { channelId: ethers.ZeroHash, peerAddress: before }
        });
        logger.info("entry");

        // the peer is set while the upload is already sleeping off its jitter
        const upload = logUploader.uploadLogs();
        logger.updateSharedContext({ peerAddress: after });
        await upload;
        // nothing new under that identity -> the batch is not sent again
        const again = await logUploader.uploadLogs();

        expect(receiver!.requests.map((r) => r.peerAddress)).to.deep.equal([
            after
        ]);
        expect(again).to.deep.equal({ ok: true, entries: 0 });
    });

    it("sends threadName and the sequence range", async function () {
        const channelId = ethers.id("delta-upload-channel");
        const peerAddress = ethers.Wallet.createRandom().address;
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            sharedContext: { threadName: "vm", channelId, peerAddress }
        });
        logger.info("first");
        logger.info("second");

        await logUploader.uploadLogs();

        const body = receiver!.requests[0];
        expect(body.threadName).to.equal("vm");
        expect(body.channelId).to.equal(channelId);
        expect(body.peerAddress).to.equal(peerAddress);
        expect(body.fromSeq).to.equal(0);
        expect(body.toSeq).to.equal(1);
    });

    it("a flush requested during an in-flight upload resolves after the second POST", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async (_received, index) => {
                if (index === 0) await held.promise;
                return 200;
            }
        });
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("first");

        const inFlight = logUploader.uploadLogs();
        // the first body is already on the wire -> this entry needs its own POST
        await receiver!.waitForRequests(1);
        logger.info("second");
        const queued = logUploader.uploadLogs();

        held.resolve();
        await inFlight;
        const outcome = await queued;

        expect(outcome).to.deep.equal({ ok: true, entries: 1 });
        expect(receiver!.requests).to.have.length(2);
        expect(messagesOf(receiver!, 1)).to.deep.equal(["second"]);
    });
    it("finishes an awaited local upload after its last logger is disposed", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async (_received, index) => {
                if (index === 0) {
                    await held.promise;
                    return 500;
                }
                return 200;
            }
        });
        const { logger } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("retain in-flight entries");
        const upload = logger.upload();
        try {
            await receiver!.waitForRequests(1);
            logger.dispose();
            held.resolve();
            expect(await upload).to.deep.equal({ ok: true, entries: 1 });
            expect(receiver!.requests).to.have.length(2);
        } finally {
            held.resolve();
            logger.dispose();
        }
    });
    describe("a delta past the server's chunk limit", function () {
        it("is sent as consecutive chunks, each within the limit", async function () {
            const messages = paddedMessages(40);
            const { logUploader, maxChunkBytes } =
                createUploaderOverLoggedStore({
                    uploadEndpoint: receiver!.url,
                    messages,
                    maxChunkBytes: (deltaBytes) => Math.ceil(deltaBytes / 2.5)
                });

            const outcome = await logUploader.uploadLogs();

            expect(outcome).to.deep.equal({ ok: true, entries: 40 });
            const chunks = receiver!.requests;
            expect(chunks.length).to.be.above(1);
            for (const chunk of chunks)
                expect(inflatedBytesOf(chunk)).to.be.at.most(maxChunkBytes);
            const ranges = chunks.map(({ fromSeq, toSeq }) => [fromSeq, toSeq]);
            const contiguous = ranges.map(([, toSeq], index) => [
                index === 0 ? 0 : ranges[index - 1][1] + 1,
                toSeq
            ]);
            expect(ranges).to.deep.equal(contiguous);
            expect(chunks[chunks.length - 1].toSeq).to.equal(39);
            expect(
                chunks.flatMap(decodeUpload).map((e) => e.message)
            ).to.deep.equal(messages);
        });

        it("exactly at the limit is sent as one chunk", async function () {
            const { logUploader } = createUploaderOverLoggedStore({
                uploadEndpoint: receiver!.url,
                messages: paddedMessages(10),
                maxChunkBytes: (deltaBytes) => deltaBytes
            });

            const outcome = await logUploader.uploadLogs();

            expect(outcome).to.deep.equal({ ok: true, entries: 10 });
            expect(receiver!.requests).to.have.length(1);
        });

        it("re-sends from the first chunk the server refused", async function () {
            await receiver!.close();
            receiver = await startLogReceiver({
                // the second chunk fails on both attempts (one retry)
                respond: (_received, index) =>
                    index === 1 || index === 2 ? 500 : 200
            });
            const messages = paddedMessages(20);
            const { logUploader } = createUploaderOverLoggedStore({
                uploadEndpoint: receiver!.url,
                messages,
                maxChunkBytes: (deltaBytes) => Math.ceil(deltaBytes / 1.5)
            });

            const failed = await logUploader.uploadLogs();
            const firstChunk = receiver!.requests[0];
            const resent = await logUploader.uploadLogs();

            expect(failed).to.deep.equal({
                ok: false,
                entries: firstChunk.toSeq + 1
            });
            expect(resent.ok).to.equal(true);
            const resentChunks = receiver!.requests.slice(3);
            expect(resentChunks[0].fromSeq).to.equal(firstChunk.toSeq + 1);
            expect(
                [firstChunk, ...resentChunks]
                    .flatMap(decodeUpload)
                    .map((e) => e.message)
            ).to.deep.equal(messages);
        });

        it("trims an entry that alone is past the limit and sends it with the rest", async function () {
            const small = paddedMessages(3);
            const oversized = "oversized ".padEnd(200_000, "x");
            // far above a small entry with any stack depth, far below the oversized one
            const maxChunkBytes = 100_000;
            const { logUploader } = createUploaderOverLoggedStore({
                uploadEndpoint: receiver!.url,
                messages: [small[0], oversized, small[1], small[2]],
                maxStoreBytes: 1024 * 1024,
                maxChunkBytes: () => maxChunkBytes
            });

            const outcome = await logUploader.uploadLogs();
            const uploads = receiver!.requests.length;
            const again = await logUploader.uploadLogs();

            expect(outcome).to.deep.equal({ ok: true, entries: 4 });
            for (const chunk of receiver!.requests)
                expect(inflatedBytesOf(chunk)).to.be.at.most(maxChunkBytes);
            const messages = receiver!.requests
                .slice(0, uploads)
                .flatMap(decodeUpload)
                .map((e) => e.message);
            expect([messages[0], messages[2], messages[3]]).to.deep.equal(
                small
            );
            expect(messages[1]).to.match(
                /^oversized x+ \[trimmed from \d+ bytes\]$/
            );
            // the trim warning goes through the logger, so it ships in the next upload
            expect(again).to.deep.equal({ ok: true, entries: 1 });
            const [warning] = decodeUpload(receiver!.requests[uploads]);
            expect(warning.level).to.equal("warn");
            expect(warning.message).to.match(
                /^Log upload trimmed an entry: seq=1 encodes to \d+ bytes, past the 100000 byte chunk limit$/
            );
        });

        it("trims an entry that grows under encoding through the halving loop", async function () {
            // once encoded twice a quote and a newline take 4 bytes, a control
            // character 7 and a euro sign 3: a quarter of the limit in characters
            // is past the limit in bytes
            const oversized = '"\n\u0001€'.repeat(60_000);
            const maxChunkBytes = 100_000;
            const { logUploader } = createUploaderOverLoggedStore({
                uploadEndpoint: receiver!.url,
                messages: [oversized],
                maxStoreBytes: 4 * 1024 * 1024,
                maxChunkBytes: () => maxChunkBytes
            });

            const outcome = await logUploader.uploadLogs();
            const again = await logUploader.uploadLogs();

            expect(outcome).to.deep.equal({ ok: true, entries: 1 });
            expect(inflatedBytesOf(receiver!.requests[0])).to.be.at.most(
                maxChunkBytes
            );
            const [trimmed] = decodeUpload(receiver!.requests[0]);
            const [kept, note] = trimmed.message.split(" [trimmed from ");
            expect(oversized.startsWith(kept)).to.equal(true);
            // the first guess keeps a quarter of the limit; it did not fit
            expect(kept.length).to.be.below(maxChunkBytes / 4);
            expect(note).to.match(/^\d+ bytes\]$/);
            // only the trim warning is left to send
            expect(again).to.deep.equal({ ok: true, entries: 1 });
        });

        it("keeps only the time, level and size of an entry whose other fields alone are past the limit", async function () {
            const maxChunkBytes = 100_000;
            const { logger, logStore } = createUploaderFixture({
                uploadEndpoint: receiver!.url,
                maxStoreBytes: 4 * 1024 * 1024
            });
            logger
                .child({ component: "x".repeat(200_000) })
                .info("context too large");
            const { logUploader } = createUploaderFixture({
                uploadEndpoint: receiver!.url,
                logStore,
                maxChunkBytes
            });

            const outcome = await logUploader.uploadLogs();
            const again = await logUploader.uploadLogs();

            expect(outcome).to.deep.equal({ ok: true, entries: 1 });
            expect(inflatedBytesOf(receiver!.requests[0])).to.be.at.most(
                maxChunkBytes
            );
            const [trimmed] = decodeUpload(receiver!.requests[0]);
            expect(trimmed.level).to.equal("info");
            expect(trimmed.context).to.deep.equal({});
            expect(trimmed.message).to.match(/^\[trimmed from \d+ bytes\]$/);
            // the refused entry does not hold back the next upload
            expect(again).to.deep.equal({ ok: true, entries: 1 });
        });

        it("takes a chunk limit of zero as the default, so a small store goes whole and untrimmed", async function () {
            const previous = config.CRASH_LOG_MAX_CHUNK_MB;
            config.CRASH_LOG_MAX_CHUNK_MB = 0;
            try {
                const messages = paddedMessages(3);
                const { logger, logUploader } = createUploaderFixture({
                    uploadEndpoint: receiver!.url
                });
                for (const message of messages) logger.info(message);

                const outcome = await logUploader.uploadLogs();

                expect(outcome).to.deep.equal({ ok: true, entries: 3 });
                expect(receiver!.requests).to.have.length(1);
                expect(messagesOf(receiver!, 0)).to.deep.equal(messages);
            } finally {
                config.CRASH_LOG_MAX_CHUNK_MB = previous;
            }
        });

        it("ends a split delta at the chunk a thread end cancels, sending nothing after it", async function () {
            const held = deferred();
            await receiver!.close();
            receiver = await startLogReceiver({
                respond: async (_received, index) => {
                    if (index === 1) await held.promise;
                    return 200;
                }
            });
            const { logUploader } = createUploaderOverLoggedStore({
                uploadEndpoint: receiver!.url,
                messages: paddedMessages(30),
                maxChunkBytes: (deltaBytes) => Math.ceil(deltaBytes / 2.5)
            });
            try {
                const running = logUploader.uploadLogs();
                await receiver!.waitForRequests(2);
                const firstChunk = receiver!.requests[0];

                LogUploader.cancelRealmUploads();

                expect(await running).to.deep.equal({
                    ok: false,
                    entries: firstChunk.toSeq + 1
                });
                expect(receiver!.requests).to.have.length(2);
            } finally {
                held.resolve();
            }
        });
    });
});
