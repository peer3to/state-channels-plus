import { randomHexId } from "@/utils/randomHexId";
import {
    applyCrashLogConfig,
    crashLogUploadOverrides
} from "@test/fixtures/logging/crashLogConfig";
import {
    createUploaderFixture,
    decodeUpload,
    startLogReceiver,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import {
    connectLoggerCycle,
    failHostFlush,
    inlineHostOf,
    createLateLoggerChild,
    connectLoggerPeers
} from "@test/fixtures/node/LoggerResponseFixture";
import { createLoggerSdkFixture } from "@test/fixtures/node/LoggerServiceFixture";
import { recordReportedErrors } from "@test/fixtures/RuntimeRootObservation";
import { deferred } from "@test/utils/deferred";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/** A short flush bound, so a case that waits for it is quick. */
const SHORT_FLUSH_MS = 300;
/** A bound a neighbour's failure surely reaches the origin within, even on a loaded worker. */
const FAILURE_FLUSH_MS = 1_000;

describe("LoggerService", function () {
    let receiver: LogReceiver;
    let restoreConfig: () => void;
    const fixtures: Array<{ dispose(): Promise<void> }> = [];
    beforeEach(async () => {
        restoreConfig = applyCrashLogConfig({
            CRASH_LOG_UPLOAD_COALESCE_MS: 100
        });
        receiver = await startLogReceiver();
    });
    afterEach(async () => {
        try {
            for (const fixture of fixtures.splice(0).reverse())
                await fixture.dispose();
        } finally {
            restoreConfig();
            await receiver.close();
        }
    });

    it("attaches one shared store and preserves children until final disposal", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        const extra = createUploaderFixture({ uploadEndpoint: receiver.url });
        const child = extra.logger.child({ component: "survivor" });
        extra.logger.attachLoggerService(sdk.clientRoot.logger);
        child.attachLoggerService(sdk.clientRoot.logger);
        expect(child.loggerService === extra.logger.loggerService).to.equal(
            true
        );
        extra.logger.dispose();
        child.info("surviving store");
        await sdk.gossipUpload("attached store");
        await receiver.waitForRequests(1);
        expect(
            receiver.requests
                .flatMap(decodeUpload)
                .filter((entry) => entry.message === "surviving store")
        ).to.have.length(1);
        child.dispose();
        expect(child.loggerService).to.equal(undefined);
    });

    it("rejects attaching a logger family to a second service", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        const other = [...sdk.roots].find((root) => root !== sdk.clientRoot)!;
        expect(() => sdk.logger.attachLoggerService(other.logger)).to.throw(
            "another service"
        );
        expect(sdk.logger.loggerService === sdk.clientRoot.logger).to.equal(
            true
        );
    });

    it("detaches surviving loggers when the service is disposed", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        await sdk.instance.dispose();
        expect(sdk.logger.loggerService).to.equal(undefined);
        sdk.logger.info("standalone after root cleanup");
        expect((await sdk.logger.upload()).ok).to.equal(true);
        expect(
            receiver.requests
                .flatMap(decodeUpload)
                .some(
                    (entry) => entry.message === "standalone after root cleanup"
                )
        ).to.equal(true);
    });

    it("a standalone logger uploads without collecting an unrelated SDK", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        const extra = createUploaderFixture({ uploadEndpoint: receiver.url });
        try {
            extra.logger.info("standalone origin");
            await sdk.remote.loggerProbe.write("unrelated SDK").request();
            expect(await extra.logger.upload()).to.deep.equal({
                ok: true,
                entries: 1
            });
            expect(receiver.requests).to.have.length(1);
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .map((entry) => entry.message)
            ).to.deep.equal(["standalone origin"]);
        } finally {
            extra.logger.dispose();
        }
    });

    it("updates the channel of every local store attached to the service", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        const extra = createUploaderFixture({ uploadEndpoint: receiver.url });
        try {
            extra.logger.attachLoggerService(sdk.clientRoot.logger);
            extra.logger.info("attached store entry");
            const channelId = ethers.id("shared service channel");
            sdk.logger.updateSharedContext({ channelId });
            expect(extra.logger.getSharedContext().channelId).to.equal(
                channelId
            );
            await extra.logger.uploadOwnLogs();
            expect(receiver.requests.at(-1)!.channelId).to.equal(channelId);
        } finally {
            extra.logger.dispose();
        }
    });

    it("uploads a connected realm's logger", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        await sdk.remote.loggerProbe.write("sdk entry").request();
        expect(await sdk.gossipUpload("connected")).to.deep.equal({
            ok: true,
            entries: 0
        });
        await receiver.waitForRequests(1);
        expect(receiver.requests[0].threadName).to.equal("sdk");
    });

    it("reaches a realm two ports away", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { vmWorker: true });
        fixtures.push(sdk);
        await sdk.remote.loggerProbe.childWriteAtEndpoint("vm entry").request();
        await sdk.gossipUpload("two ports");
        await receiver.waitForRequests(1);
        expect(receiver.requests[0].threadName).to.equal("vm");
    });

    it("a leaf upload reaches its parent roots", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { vmWorker: true });
        fixtures.push(sdk);
        sdk.logger.info("main entry");
        await sdk.remote.loggerProbe.childGossipUpload("leaf").request();
        await receiver.waitForRequests(1);
        expect(receiver.requests[0].threadName).to.equal("main");
    });

    it("returns the local result while a remote POST is still pending", async () => {
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async (received) => {
                if (received.threadName === "sdk") await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        try {
            sdk.logger.info("local result");
            await sdk.remote.loggerProbe.write("remote held").request();
            expect(await sdk.gossipUpload("local outcome")).to.deep.equal({
                ok: true,
                entries: 1
            });
            await receiver.waitForRequests(2);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            held.resolve();
            await sdk.remote.loggerProbe.own().request();
        }
    });

    it("coalesces nearby local triggers into one gossip generation", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        await Promise.all([
            sdk.gossipUpload("one"),
            sdk.gossipUpload("two"),
            sdk.gossipUpload("three")
        ]);
        expect(
            sdk.frames.filter(
                (frame) =>
                    frame.service === "logger" && frame.method === "upload"
            )
        ).to.have.length(1);
    });

    it("advances for a fresh local trigger after the window", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        await sdk.gossipUpload("first");
        // Time is the oracle: cross the configured 100 ms coalescing window.
        await new Promise((resolve) => setTimeout(resolve, 120));
        await sdk.gossipUpload("second");
        expect(
            sdk.frames
                .filter(
                    (frame) =>
                        frame.service === "logger" && frame.method === "upload"
                )
                .map((frame) => frame.params[0])
        ).to.deep.equal([1, 2]);
    });

    it("ignores equal and older generations after the window", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        await sdk.remote.logger.upload(20, "first").request();
        // Time is the oracle: cross the configured 100 ms coalescing window.
        await new Promise((resolve) => setTimeout(resolve, 120));
        await sdk.remote.loggerProbe
            .write("buffered until newer generation")
            .request();
        const before = await sdk.remote.loggerProbe.uploadState().request();
        await sdk.remote.logger.upload(20, "equal").request();
        await sdk.remote.logger.upload(19, "older").request();
        const after = await sdk.remote.loggerProbe.uploadState().request();
        expect(after.calls).to.equal(before.calls);
        expect(after.pending).to.equal(false);
        expect(receiver.requests).to.have.length(0);
        await sdk.remote.logger.upload(21, "newer").request();
        await receiver.waitForRequests(1);
        expect(
            receiver.requests
                .flatMap(decodeUpload)
                .some(
                    (entry) =>
                        entry.message === "buffered until newer generation"
                )
        ).to.equal(true);
    });

    it("ignores an old frame released after a newer generation and delay", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        const received = sdk.control.holdNextMessage("upload");
        await sdk.remote.loggerProbe.gossipUpload("held generation").request();
        await received;
        sdk.clientRoot.logger.upload(10, "newer generation");
        // Time is the oracle: cross the configured 100 ms coalescing window.
        await new Promise((resolve) => setTimeout(resolve, 120));
        sdk.logger.info("must remain buffered");
        const before = sdk.uploadState();
        sdk.control.release();
        await sdk.remote.runtimeProbe.sum(1, 2).request();
        const after = sdk.uploadState();
        expect(after.calls).to.equal(before.calls);
        expect(after.pending).to.equal(false);
        expect(receiver.requests).to.have.length(0);
        await sdk.gossipUpload("fresh local");
        await receiver.waitForRequests(1);
    });

    it("adopts a higher generation without incrementing it", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { vmWorker: true });
        fixtures.push(sdk);
        await sdk.remote.logger.upload(17, "adopt").request();
        const frames = await sdk.remote.loggerProbe.frames().request();
        expect(
            frames
                .filter((frame) => frame.method === "upload")
                .map((frame) => frame.params[0])
        ).to.deep.equal([17]);
    });

    it("synchronizes a newly connected root before its first local trigger", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        await sdk.remote.logger.upload(25, "existing generation").request();
        const child = await createLateLoggerChild(sdk);
        expect(child.root.rootLogger.getSharedContext().peerAddress).to.equal(
            (await sdk.remote.loggerProbe.context().request()).peerAddress
        );
        sdk.logger.info("late child trigger");
        await child.root.rootLogger.upload("new child");
        await receiver.waitForRequests(1);
        const frames = await sdk.remote.loggerProbe.frames().request();
        expect(
            frames.some(
                (frame) => frame.method === "upload" && frame.params[0] === 26
            )
        ).to.equal(true);
        await child.remote.dispose();
    });

    it("rejects invalid upload generations through the RPC boundary", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        for (const index of [
            -1,
            1.5,
            NaN,
            Infinity,
            Number.MAX_SAFE_INTEGER + 1
        ]) {
            const result = await sdk.remote.logger
                .upload(index, "invalid")
                .request()
                .then(
                    () => "accepted",
                    (error: Error) => error.message
                );
            expect(result).to.include("non-negative safe integer");
        }
        expect(
            (await sdk.remote.loggerProbe.frames().request()).filter(
                (frame) => frame.method === "upload"
            )
        ).to.have.length(0);
        expect(receiver.requests).to.have.length(0);
    });

    it("does not wrap an exhausted upload index", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        sdk.clientRoot.logger.upload(Number.MAX_SAFE_INTEGER, "last index");
        // Time is the oracle: cross the configured 100 ms coalescing window.
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(() => sdk.logger.upload("overflow")).to.throw("index exhausted");
    });

    it("terminates gossip across a cycle of real root connections", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        const close = connectLoggerCycle(sdk);
        try {
            sdk.logger.info("cycle main");
            await sdk.remote.loggerProbe.write("cycle host").request();
            await sdk.gossipUpload("cycle");
            await receiver.waitForRequests(2);
            await sdk.remote.runtimeProbe.sum(1, 2).request();
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .filter((entry) => entry.message.startsWith("cycle "))
            ).to.have.length(2);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            close();
        }
    });

    it("a flush settles only once every connected realm has posted its logs", async () => {
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async (received) => {
                if (received.threadName === "sdk") await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        sdk.logger.info("flush main");
        await sdk.remote.loggerProbe.write("flush host").request();
        let isSettled = false;

        const flush = sdk.logger.flushLogs().then(() => {
            isSettled = true;
        });
        await receiver.waitForRequests(2);
        // The main realm's own post has finished: a flush that waited only for it would settle.
        await sdk.own();
        await new Promise(setImmediate);

        // The sdk realm's post is still held: the flush waits for it.
        expect(isSettled).to.equal(false);
        held.resolve();
        await flush;
        expect(
            receiver.requests
                .flatMap(decodeUpload)
                .map((entry) => entry.message)
                .filter((message) => message.startsWith("flush "))
                .sort()
        ).to.deep.equal(["flush host", "flush main"]);
    });

    it("a flush skips a neighbour that closes while its upload is held", async () => {
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async (received) => {
                if (received.threadName === "sdk") await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        sdk.logger.info("flush before close");
        await sdk.remote.loggerProbe.write("held before close").request();
        const reported = recordReportedErrors(sdk.clientRoot);
        const flush = sdk.logger.flushLogs();
        await receiver.waitForRequests(2);

        try {
            // The connection to the sdk realm closes with its upload still held.
            const closedAtMs = Date.now();
            sdk.parentTransport.close();
            await flush;
            // Its closure ended the wait, not the flush's bound, and is no failure.
            expect(Date.now() - closedAtMs).to.be.below(1_000);
            expect(reported.errors).to.deep.equal([]);
        } finally {
            reported.restore();
            held.resolve();
        }
    });

    it("a flush reports a neighbour's failure at once and still waits for the other uploads", async () => {
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async (received) => {
                if (received.threadName === "main") await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        // After the fixture: its setup rebuilds the config, and so does this, so the
        // receiver's endpoint goes in again.
        const restoreBound = applyCrashLogConfig({
            ...crashLogUploadOverrides(receiver.url),
            CRASH_LOG_FLUSH_MS: FAILURE_FLUSH_MS
        });
        sdk.logger.info("main upload outlasts the bound");
        const restoreFlush = failHostFlush(sdk, new Error("host flush failed"));
        const reported = recordReportedErrors(sdk.clientRoot);
        try {
            const startedAtMs = Date.now();

            await sdk.logger.flushLogs();

            const elapsedMs = Date.now() - startedAtMs;
            expect(
                reported.errors.map((error) => (error as Error).message)
            ).to.deep.equal(["host flush failed"]);
            // Reported when it happened, not when the flush settled.
            expect(reported.atMs[0] - startedAtMs).to.be.below(
                FAILURE_FLUSH_MS / 2
            );
            // The failure did not cut the held upload short: the flush waited for its bound.
            expect(elapsedMs).to.be.at.least(FAILURE_FLUSH_MS - 50);
            await receiver.waitForRequests(1);
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .some(
                        (entry) =>
                            entry.message === "main upload outlasts the bound"
                    )
            ).to.equal(true);
        } finally {
            held.resolve();
            reported.restore();
            restoreFlush();
            restoreBound();
        }
    });

    it("a flush ends at its bound when a neighbour never answers", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        // After the fixture: its setup rebuilds the config, and so does this, so the
        // receiver's endpoint goes in again.
        const restoreBound = applyCrashLogConfig({
            ...crashLogUploadOverrides(receiver.url),
            CRASH_LOG_FLUSH_MS: SHORT_FLUSH_MS
        });
        // The host's real answer is held until the flush has ended.
        void sdk.control.holdNextResponse("flush");
        try {
            const startedAtMs = Date.now();

            await sdk.logger.flushLogs();

            const elapsedMs = Date.now() - startedAtMs;
            expect(elapsedMs).to.be.at.least(SHORT_FLUSH_MS - 50);
            expect(elapsedMs).to.be.below(SHORT_FLUSH_MS + 2_000);
        } finally {
            sdk.control.release();
            restoreBound();
        }
    });

    it("every realm in a flush stops at the origin's deadline, not at its own", async () => {
        /** The flush bound: wide, so a loaded worker still answers inside it. */
        const SHARED_DEADLINE_FLUSH_MS = 1_000;
        /** How late the host gets the flush request: most of the bound. */
        const LATE_DELIVERY_MS = 700;
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async (received) => {
                if (received.threadName === "vm") await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver, {
            inlineSdk: true,
            vmWorker: true
        });
        fixtures.push(sdk);
        // After the fixture: its setup rebuilds the config, and so does this, so the
        // receiver's endpoint goes in again.
        const restoreBound = applyCrashLogConfig({
            ...crashLogUploadOverrides(receiver.url),
            CRASH_LOG_FLUSH_MS: SHARED_DEADLINE_FLUSH_MS
        });
        // The VM's upload stays held, so the host waits on the VM until the deadline.
        await sdk.remote.loggerProbe
            .childWriteAtEndpoint("held vm upload")
            .request();
        const posted = sdk.control.holdNextPost("flush");
        const answered = sdk.control
            .holdNextResponse("flush")
            .then(() => Date.now());
        try {
            const startedAtMs = Date.now();
            const flush = sdk.logger.flushLogs();
            await posted;
            // Time is the input: the host gets the request late.
            await new Promise((resolve) =>
                setTimeout(resolve, LATE_DELIVERY_MS)
            );
            const releasedAtMs = Date.now();
            sdk.control.releaseAt(0);

            const answeredAtMs = await answered;
            await flush;

            expect(answeredAtMs - startedAtMs).to.be.at.least(
                SHARED_DEADLINE_FLUSH_MS - 50
            );
            // A host with its own deadline cannot answer before this.
            expect(answeredAtMs).to.be.below(
                releasedAtMs + SHARED_DEADLINE_FLUSH_MS
            );
        } finally {
            sdk.control.release();
            held.resolve();
            restoreBound();
        }
    });

    it("a realm asked to flush after the deadline answers at once while its upload is held", async () => {
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async () => {
                await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        await sdk.remote.loggerProbe.write("held late upload").request();
        let isSettled = false;
        try {
            const flush = inlineHostOf(sdk)
                .logger.flush(randomHexId(), Date.now() - 1)
                .then(() => {
                    isSettled = true;
                });
            // Time is the oracle: the upload stays held long after this window.
            await Promise.race([
                flush,
                new Promise((resolve) => setTimeout(resolve, 1_000))
            ]);

            expect(isSettled).to.equal(true);
            await receiver.waitForRequests(1);
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .map((entry) => entry.message)
            ).to.include("held late upload");
        } finally {
            held.resolve();
        }
    });

    it("a realm whose logger service was disposed answers a flush at once and forwards nothing", async () => {
        const held = deferred();
        await receiver.close();
        // A forwarded flush would wait on this held upload until its deadline.
        receiver = await startLogReceiver({
            respond: async (received) => {
                if (
                    decodeUpload(received).some(
                        (entry) => entry.message === "beyond disposed realm"
                    )
                )
                    await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        const beyond = await createLoggerSdkFixture(receiver, {
            inlineSdk: true
        });
        fixtures.push(beyond);
        const disconnect = connectLoggerPeers(sdk, beyond);
        try {
            beyond.logger.info("beyond disposed realm");
            sdk.clientRoot.logger.dispose();
            const startedAtMs = Date.now();

            await inlineHostOf(sdk).logger.flush(
                randomHexId(),
                Date.now() + 5_000
            );

            // Time is the oracle: half the 5 s deadline a forwarded flush would wait for.
            expect(Date.now() - startedAtMs).to.be.below(2_500);
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .map((entry) => entry.message)
            ).to.not.include("beyond disposed realm");
        } finally {
            held.resolve();
            disconnect();
        }
    });

    it("with log collection off a flush asks no realm and settles at once", async () => {
        const sdk = await createLoggerSdkFixture(receiver, {
            inlineSdk: true,
            disabled: true
        });
        fixtures.push(sdk);
        // A host answer, were the host asked, would stay held.
        void sdk.control.holdNextResponse("flush");
        let isSettled = false;
        try {
            const flush = sdk.logger.flushLogs().then(() => {
                isSettled = true;
            });
            await new Promise(setImmediate);

            expect(isSettled).to.equal(true);
            expect(
                sdk.control.sent.filter((frame) => frame.method === "flush")
            ).to.deep.equal([]);
            await flush;
        } finally {
            sdk.control.release();
        }
    });

    it("a flush answer to a requester whose connection closed reports no error", async () => {
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async () => {
                await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        // The host's held upload keeps its real flush running.
        await sdk.remote.loggerProbe.write("held host upload").request();
        const host = inlineHostOf(sdk);
        const hostTransport = host.parent!["transport"];
        const reported = recordReportedErrors(host);
        try {
            const flush = sdk.logger.flushLogs();
            await waitFor(() =>
                receiver.requests
                    .flatMap(decodeUpload)
                    .some((entry) => entry.message === "held host upload")
            );
            sdk.parentTransport.close();
            await waitFor(() => host.parent === null);

            // The host's flush ends only now and answers a requester that is gone.
            held.resolve();
            // 5 s is only a bound: the drain ends once the host's flush handler answers.
            await host.router.drainInFlightHandlers(hostTransport, 5_000);
            await new Promise(setImmediate);
            await flush;

            expect(reported.errors).to.deep.equal([]);
        } finally {
            held.resolve();
            reported.restore();
        }
    });

    it("a slow flush answer that lands after its requester's logger was disposed warns nothing", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        // After the fixture: its setup rebuilds the config, and so does this, so the
        // receiver's endpoint goes in again.
        const restoreBound = applyCrashLogConfig({
            ...crashLogUploadOverrides(receiver.url),
            CRASH_LOG_FLUSH_MS: SHORT_FLUSH_MS
        });
        // The host's real answer is held until the requester's logger is gone.
        const answered = sdk.control.holdNextResponse("flush");
        const reported = recordReportedErrors(sdk.clientRoot);
        try {
            const startedAtMs = Date.now();
            await sdk.logger.flushLogs();
            await answered;
            // Slow enough for the slow-request warning (one second), then the logger goes.
            await new Promise((resolve) =>
                setTimeout(resolve, 1_100 - (Date.now() - startedAtMs))
            );
            sdk.clientRoot.logger.attachedLogger.dispose();

            sdk.control.release();
            await new Promise(setImmediate);

            expect(reported.errors).to.deep.equal([]);
            expect(
                sdk
                    .entries()
                    .filter(
                        (entry) =>
                            entry.message === "Slow worker request completed"
                    )
            ).to.deep.equal([]);
        } finally {
            sdk.control.release();
            reported.restore();
            restoreBound();
        }
    });

    it("a logger without a coordination service refuses to flush", () => {
        const { logger } = createUploaderFixture({
            uploadEndpoint: receiver.url
        });

        expect(() => logger.flushLogs()).to.throw(
            "Logger has no coordination service to flush through"
        );
    });

    it("a flush across a cycle of real root connections settles once", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        const close = connectLoggerCycle(sdk);
        try {
            sdk.logger.info("cycle flush main");
            await sdk.remote.loggerProbe.write("cycle flush host").request();

            await sdk.logger.flushLogs();

            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .filter((entry) => entry.message.startsWith("cycle flush "))
            ).to.have.length(2);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            close();
        }
    });

    it("concurrent roots upload without waiting on one another", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        sdk.logger.info("main concurrent");
        await sdk.remote.loggerProbe.write("sdk concurrent").request();
        const outcomes = await Promise.all([
            sdk.gossipUpload("main"),
            sdk.remote.loggerProbe.gossipUpload("sdk").request()
        ]);
        expect(outcomes.every((outcome) => outcome.ok)).to.equal(true);
        await receiver.waitForRequests(2);
    });

    it("keeps at most one follow-up when higher generations arrive during a POST", async () => {
        const held = deferred();
        await receiver.close();
        receiver = await startLogReceiver({
            respond: async (_received, index) => {
                if (index === 0) await held.promise;
                return 200;
            }
        });
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        try {
            sdk.logger.info("first snapshot");
            const active = sdk.gossipUpload("active");
            await receiver.waitForRequests(1);
            sdk.logger.info("after snapshot");
            sdk.clientRoot.logger.upload(10, "newer");
            sdk.clientRoot.logger.upload(11, "latest");
            // Time is the oracle: cross the configured 100 ms coalescing window.
            await new Promise((resolve) => setTimeout(resolve, 120));
            held.resolve();
            await active;
            await receiver.waitForRequests(2);
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .filter((entry) => entry.message === "after snapshot")
            ).to.have.length(1);
        } finally {
            held.resolve();
        }
    });

    it("cancels a pending service upload on disposal", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        await sdk.gossipUpload("window");
        sdk.logger.info("pending entry");
        sdk.cancelPendingUpload();
        expect(receiver.requests).to.have.length(0);
        expect(sdk.logger.loggerService).to.equal(undefined);
        expect((await sdk.logger.upload()).entries).to.equal(1);
    });

    it("a disabled store still relays uploads to enabled neighbours", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { disabled: true });
        fixtures.push(sdk);
        const extra = createUploaderFixture({ uploadEndpoint: receiver.url });
        try {
            extra.logger.attachLoggerService(sdk.clientRoot.logger);
            extra.logger.info("enabled extra store");
            await sdk.remote.loggerProbe
                .gossipUpload("disabled relay")
                .request();
            await receiver.waitForRequests(1);
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .map((entry) => entry.message)
            ).to.deep.equal(["enabled extra store"]);
        } finally {
            extra.logger.dispose();
        }
    });

    it("a child logger does not add a second upload", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        const child = sdk.logger.child({ component: "child" });
        try {
            child.info("one shared delta");
            await sdk.gossipUpload("shared");
            expect(receiver.requests).to.have.length(1);
        } finally {
            child.dispose();
        }
    });

    it("an attached error triggers local and remote uploads", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        await sdk.remote.loggerProbe.write("remote error context").request();
        sdk.logger.error("local error");
        await receiver.waitForRequests(2);
        expect(
            receiver.requests.map((request) => request.threadName).sort()
        ).to.deep.equal(["main", "sdk"]);
    });

    it("a failed local upload preserves entries for a later attempt", async () => {
        let fail = true;
        await receiver.close();
        receiver = await startLogReceiver({
            respond: (received) =>
                received.threadName === "main" && fail ? 500 : 200
        });
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        sdk.logger.info("retry me");
        await sdk.remote.loggerProbe.write("other store succeeds").request();
        expect((await sdk.gossipUpload("failed local")).ok).to.equal(false);
        expect(
            receiver.requests.some((request) => request.threadName === "sdk")
        ).to.equal(true);
        fail = false;
        expect((await sdk.gossipUpload("retry local")).ok).to.equal(true);
        expect(
            decodeUpload(receiver.requests[receiver.requests.length - 1]).some(
                (entry) => entry.message === "retry me"
            )
        ).to.equal(true);
    });

    it("a synchronous post failure does not block the local upload", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        sdk.control.failNextPost("upload");
        sdk.logger.info("local despite failed port");
        expect((await sdk.gossipUpload("post failure")).ok).to.equal(true);
        expect(receiver.requests).to.have.length(1);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
    });

    it("rapid channel updates reach both neighbours without echoing to their sender", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { vmWorker: true });
        fixtures.push(sdk);
        const first = ethers.id("first rapid channel");
        const final = ethers.id("final rapid channel");
        sdk.remote.loggerProbe.updateContext({ channelId: first }).send();
        sdk.remote.loggerProbe
            .updateContext({ channelId: ethers.ZeroHash })
            .send();
        await sdk.remote.loggerProbe
            .updateContext({ channelId: final })
            .request();
        expect(
            (await sdk.remote.loggerProbe.context().request()).channelId
        ).to.equal(final);
        expect(
            (await sdk.remote.loggerProbe.childContext().request()).channelId
        ).to.equal(final);
        expect(sdk.logger.getSharedContext().channelId).to.equal(final);
        expect(
            sdk.frames.filter(
                (frame) =>
                    frame.service === "logger" &&
                    frame.method === "contextUpdate"
            )
        ).to.have.length(0);
    });

    it("context set after connecting reaches the leaf before its first upload", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { vmWorker: true });
        fixtures.push(sdk);
        const channelId = ethers.id("channel-set-after-connecting");
        await sdk.remote.loggerProbe.childWriteAtEndpoint("vm entry").request();
        await sdk.remote.loggerProbe.updateContext({ channelId }).request();
        await sdk.gossipUpload("context");
        await receiver.waitForRequests(1);
        expect(
            receiver.requests.find((request) => request.threadName === "vm")
                ?.channelId
        ).to.equal(channelId);
    });

    it("does not apply a peer address arriving from a child", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        const address = sdk.logger.getSharedContext().peerAddress;
        const channelId = ethers.id("child channel");
        await sdk.remote.loggerProbe
            .updateContext({
                channelId,
                peerAddress: ethers.Wallet.createRandom().address
            })
            .request();
        await waitFor(
            () => sdk.logger.getSharedContext().channelId === channelId
        );
        expect(sdk.logger.getSharedContext().peerAddress).to.equal(address);
    });

    it("a second root in the same realm follows the channel", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        const channelId = ethers.id("inline channel");
        await sdk.remote.loggerProbe.updateContext({ channelId }).request();
        expect(sdk.logger.getSharedContext().channelId).to.equal(channelId);
    });

    it("reaches a VM worker owned by an inline SDK", async () => {
        const sdk = await createLoggerSdkFixture(receiver, {
            inlineSdk: true,
            vmWorker: true
        });
        fixtures.push(sdk);
        sdk.logger.info("main mixed");
        await sdk.remote.loggerProbe.write("host mixed").request();
        await sdk.remote.loggerProbe.childWriteAtEndpoint("vm mixed").request();
        await sdk.gossipUpload("mixed placement");
        await receiver.waitForRequests(3);
        expect(
            receiver.requests
                .flatMap(decodeUpload)
                .filter((entry) => entry.message.endsWith(" mixed"))
        ).to.have.length(3);
    });
    it("connected SDK roots share the caller store without registering it twice", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        const sibling = await createLoggerSdkFixture(receiver, {
            inlineSdk: true,
            peerLogger: sdk.logger
        });
        fixtures.push(sibling);
        const close = connectLoggerPeers(sdk, sibling);
        try {
            expect(
                sdk.clientRoot.logger === sibling.clientRoot.logger
            ).to.equal(false);
            expect(
                sdk.clientRoot.rootLogger.loggerService ===
                    sibling.clientRoot.rootLogger.loggerService
            ).to.equal(true);
            sdk.logger.info("shared caller store");
            await sdk.remote.loggerProbe.write("first host").request();
            await sibling.remote.loggerProbe.write("second host").request();
            await sdk.gossipUpload("connected SDKs");
            await receiver.waitForRequests(3);
            expect(
                receiver.requests
                    .flatMap(decodeUpload)
                    .filter((entry) => entry.message === "shared caller store")
            ).to.have.length(1);
        } finally {
            close();
        }
    });

    it("a leaf crash retains late channel identity and triggers its client upload", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { vmWorker: true });
        fixtures.push(sdk);
        const channelId = ethers.id("leaf crash channel");
        await sdk.remote.loggerProbe.updateContext({ channelId }).request();
        sdk.logger.info("client crash context");
        await sdk.remote.loggerProbe
            .childCaptureUnhandled("leaf crash marker")
            .request();
        await receiver.waitForRequests(2);
        const upload = receiver.requests.find(
            (request) => request.threadName === "vm"
        );
        expect(upload?.channelId).to.equal(channelId);
        expect(
            decodeUpload(upload!).some((entry) =>
                entry.message.includes("captured for log upload")
            )
        ).to.equal(true);
    });

    it("does not pass peer identity between inline roots", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { inlineSdk: true });
        fixtures.push(sdk);
        const address = sdk.logger.getSharedContext().peerAddress;
        await sdk.remote.loggerProbe
            .updateContext({
                peerAddress: ethers.Wallet.createRandom().address
            })
            .request();
        expect(sdk.logger.getSharedContext().peerAddress).to.equal(address);
    });
});
