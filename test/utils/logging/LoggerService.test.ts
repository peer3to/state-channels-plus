import { applyCrashLogConfig } from "@test/fixtures/logging/crashLogConfig";
import {
    createUploaderFixture,
    decodeUpload,
    startLogReceiver,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import {
    connectLoggerCycle,
    createLateLoggerChild,
    connectLoggerPeers
} from "@test/fixtures/node/LoggerResponseFixture";
import {
    createLoggerSdkFixture,
    deferred
} from "@test/fixtures/node/LoggerServiceFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

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
        await sdk.flush("attached store");
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
        expect(await sdk.flush("connected")).to.deep.equal({
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
        await sdk.flush("two ports");
        await receiver.waitForRequests(1);
        expect(receiver.requests[0].threadName).to.equal("vm");
    });

    it("a leaf upload reaches its parent roots", async () => {
        const sdk = await createLoggerSdkFixture(receiver, { vmWorker: true });
        fixtures.push(sdk);
        sdk.logger.info("main entry");
        await sdk.remote.loggerProbe.childFlush("leaf").request();
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
            expect(await sdk.flush("local outcome")).to.deep.equal({
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
            sdk.flush("one"),
            sdk.flush("two"),
            sdk.flush("three")
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
        await sdk.flush("first");
        // Time is the oracle: cross the configured 100 ms coalescing window.
        await new Promise((resolve) => setTimeout(resolve, 120));
        await sdk.flush("second");
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
        await sdk.remote.loggerProbe.flush("held generation").request();
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
        await sdk.flush("fresh local");
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
            await sdk.flush("cycle");
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

    it("concurrent roots upload without waiting on one another", async () => {
        const sdk = await createLoggerSdkFixture(receiver);
        fixtures.push(sdk);
        sdk.logger.info("main concurrent");
        await sdk.remote.loggerProbe.write("sdk concurrent").request();
        const outcomes = await Promise.all([
            sdk.flush("main"),
            sdk.remote.loggerProbe.flush("sdk").request()
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
            const active = sdk.flush("active");
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
        await sdk.flush("window");
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
            await sdk.remote.loggerProbe.flush("disabled relay").request();
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
            await sdk.flush("shared");
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
        expect((await sdk.flush("failed local")).ok).to.equal(false);
        expect(
            receiver.requests.some((request) => request.threadName === "sdk")
        ).to.equal(true);
        fail = false;
        expect((await sdk.flush("retry local")).ok).to.equal(true);
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
        expect((await sdk.flush("post failure")).ok).to.equal(true);
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
        await sdk.flush("context");
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
        await sdk.flush("mixed placement");
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
            await sdk.flush("connected SDKs");
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
