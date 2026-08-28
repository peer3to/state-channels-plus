import { expect } from "chai";
import { ethers } from "ethers";

import { deferred } from "@test/fixtures/logging/LogFlushBus.fixture";
import {
    createUploaderFixture,
    decodeUpload,
    startLogReceiver,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";

function messagesOf(receiver: LogReceiver, index: number): string[] {
    return decodeUpload(receiver.requests[index]).map((entry) => entry.message);
}

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
});
