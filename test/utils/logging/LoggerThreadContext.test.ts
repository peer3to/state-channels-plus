import { DetachedPromises } from "@/utils/DetachedPromises";
import { createLogger } from "@/utils/logging";
import {
    createUploaderFixture,
    decodeUpload,
    startLogReceiver,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import { expect } from "chai";
import { ethers } from "ethers";

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
    it("reparents children to the surviving grandparent on disposal", async function () {
        const { logger } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        const middle = logger.child({ component: "middle" });
        const left = middle.child({ component: "left" });
        const right = middle.child({ component: "right" });
        try {
            middle.dispose();
            middle.dispose();
            expect(left.rootLogger).to.equal(logger);
            expect(right.rootLogger).to.equal(logger);
            left.info("surviving left child");
            right.info("surviving right child");
            await left.upload("middle logger disposed");
            expect(receiver!.requests).to.have.length(1);
            expect(
                decodeUpload(receiver!.requests[0]).map(
                    (entry) => entry.message
                )
            ).to.include.members([
                "surviving left child",
                "surviving right child"
            ]);
        } finally {
            logger.dispose({ cascadeChildren: true });
        }
    });

    it("keeps one shared store registered after its parent logger is disposed", async function () {
        const { logger } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        const left = logger.child({ component: "left" });
        const right = logger.child({ component: "right" });
        try {
            logger.dispose();
            expect(left.rootLogger).to.equal(left);
            expect(right.rootLogger).to.equal(right);
            left.info("first surviving root");
            right.info("second surviving root");
            await right.upload("parent logger disposed");
            expect(receiver!.requests).to.have.length(1);
            left.dispose();
            right.info("last surviving root");
            await right.upload("first sibling disposed");
            expect(receiver!.requests).to.have.length(2);
            expect(
                decodeUpload(receiver!.requests[1]).map(
                    (entry) => entry.message
                )
            ).to.include("last surviving root");
            right.dispose();
            right.dispose();
            // a disposed logger still writes to its console, never fails
            right.info("disposed logger writes to its console");
            expect(() => right.upload("all loggers disposed")).to.throw(
                "has been disposed"
            );
            expect(receiver!.requests).to.have.length(2);
        } finally {
            left.dispose();
            right.dispose();
            logger.dispose();
        }
    });
    it("releases shared crash listeners only after the last logger is disposed", function () {
        const before = process.listenerCount("uncaughtException");
        const logger = createLogger(
            {},
            { component: "SharedLoggerLifetime" },
            {
                skipWriting: true,
                attachErrorListener: true,
                logUploaderConfig: {
                    uploadEndpoint: receiver!.url,
                    jitterMaxMs: 0
                }
            }
        );
        const child = logger.child({ component: "child" });
        try {
            expect(process.listenerCount("uncaughtException")).to.equal(
                before + 1
            );
            logger.dispose();
            expect(process.listenerCount("uncaughtException")).to.equal(
                before + 1
            );
            child.dispose();
            child.dispose();
            expect(process.listenerCount("uncaughtException")).to.equal(before);
        } finally {
            child.dispose();
            logger.dispose();
        }
    });

    it("cascades through grandchildren reparented by an earlier disposal", function () {
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: ""
        });
        const middle = logger.child({ component: "middle" });
        const leaf = middle.child({ component: "leaf" });
        middle.dispose();
        logger.dispose({ cascadeChildren: true });
        expect(leaf.isDisposed).to.equal(true);
        leaf.info("stores nothing after cascading disposal");
        expect(logStore.getAllLogs()).to.have.length(0);
        // a late link's logger is born disposed and stores nothing either
        const late = leaf.child({ component: "late" });
        expect(late.isDisposed).to.equal(true);
        late.info("late child of a disposed logger");
        expect(logStore.getAllLogs()).to.have.length(0);
        leaf.dispose();
    });
    it("stores a disposed child's entry while its parent lives", function () {
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: ""
        });
        try {
            const child = logger.child({ component: "disposedChild" });
            child.dispose();
            const before = logStore.getAllLogs().length;
            child.info("disposed child, family alive");
            const stored = logStore.getAllLogs();
            expect(stored).to.have.length(before + 1);
            expect(stored[stored.length - 1].context.component).to.equal(
                "disposedChild"
            );
        } finally {
            logger.dispose();
        }
    });
    it("writes a disposing runtime's warnings and errors at info and uploads nothing for them", function () {
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: ""
        });
        try {
            const child = logger.child({ component: "teardown" });
            const pendingLive = DetachedPromises.size();
            child.warn("live warning");
            child.error("live error");
            // a live error still starts its upload
            expect(DetachedPromises.size()).to.equal(pendingLive + 1);
            logger.updateSharedContext({ disposing: true });
            const pendingDisposing = DetachedPromises.size();
            child.warn("teardown warning");
            child.error("teardown error");
            expect(DetachedPromises.size()).to.equal(pendingDisposing);
            expect(
                logStore
                    .getAllLogs()
                    .map((entry) => [entry.message, entry.level])
                    .slice(-4)
            ).to.deep.equal([
                ["live warning", "warn"],
                ["live error", "error"],
                ["teardown warning", "info"],
                ["teardown error", "info"]
            ]);
        } finally {
            logger.dispose({ cascadeChildren: true });
        }
    });
    it("logs on every level and replays after disposal without storing, uploading or failing", function () {
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: ""
        });
        logger.info("entry to replay");
        const entry = logStore.getAllLogs()[0];
        logger.level = "error";
        logger.debug("filtered while active");
        logger.dispose();
        logger.dispose();
        const pendingBefore = DetachedPromises.size();
        logger.debug("late debug");
        logger.info("late info");
        logger.warn("late warning");
        logger.error("late error");
        logger.verbose("late verbose");
        logger.logEntry(entry);
        // its family is gone: nothing stored, and error() started no upload
        expect(logStore.getAllLogs()).to.have.length(1);
        expect(DetachedPromises.size()).to.equal(pendingBefore);
    });
});
