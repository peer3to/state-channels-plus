import { expect } from "chai";
import { ethers } from "ethers";

import { createLogger } from "@/utils/logging";
import {
    createUploaderFixture,
    decodeUpload,
    startLogReceiver,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";

describe("Logger thread context", function () {
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

    it("defaults the thread name to main", function () {
        const logger = createLogger(
            { peerId: 0 },
            { component: "LoggerThreadContextTest" },
            { skipWriting: true }
        );

        try {
            expect(logger.getSharedContext().threadName).to.equal("main");
        } finally {
            logger.dispose();
        }
    });

    it("re-uploads earlier entries under the channel set later", async function () {
        const channelId = ethers.id("channel-set-after-first-upload");
        const peerAddress = ethers.Wallet.createRandom().address;
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            sharedContext: { threadName: "vm", peerAddress }
        });
        logger.info("pre-channel entry");
        await logUploader.uploadLogs();

        logger.updateSharedContext({ channelId });
        logger.info("post-channel entry");
        await logUploader.uploadLogs();

        // the first upload was filed under ZeroHash; the watermark must not
        // strand it there -> the second body starts from seq 0 again
        const second = receiver!.requests[1];
        expect(second.channelId).to.equal(channelId);
        expect(second.fromSeq).to.equal(0);
        const messages = decodeUpload(second).map((entry) => entry.message);
        expect(messages).to.include("pre-channel entry");
        expect(messages).to.include("post-channel entry");
    });

    it("uploads buffered entries under the channel set later", async function () {
        const channelId = ethers.id("channel-set-after-buffering");
        const peerAddress = ethers.Wallet.createRandom().address;
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            sharedContext: { threadName: "vm", peerAddress }
        });
        logger.info("written before the channel existed");

        logger.updateSharedContext({ channelId });
        await logUploader.uploadLogs();

        const body = receiver!.requests[0];
        expect(body.channelId).to.equal(channelId);
        // the store holds the context by reference -> an entry written before the
        // channel existed still uploads under it
        for (const entry of decodeUpload(body)) {
            expect(entry.sharedContext.channelId).to.equal(channelId);
        }
    });
});
