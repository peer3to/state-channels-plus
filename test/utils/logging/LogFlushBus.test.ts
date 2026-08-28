import { expect } from "chai";
import { ethers } from "ethers";

import {
    addDeadPort,
    countMessages,
    createTestRealm,
    deferred,
    connectRealms,
    type RealmConnection,
    type TestRealm
} from "@test/fixtures/logging/LogFlushBus.fixture";
import {
    decodeUpload,
    startLogReceiver,
    threadStream,
    type LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";
import { applyCrashLogConfig } from "@test/fixtures/logging/crashLogConfig";

// above the 1s retry delay -> a failing realm reports failed, not timed out
const ACK_TIMEOUT_MS = 5000;
// short on purpose - the timeout cases are about the bound itself
const SHORT_ACK_TIMEOUT_MS = 300;

// the bus reads its bound from config when a round arms, so set it the same way
// an operator would. restored in after() - createConfig rebuilds from defaults.
let restoreConfig: (() => void) | undefined;

function setAckTimeout(ms: number): void {
    const restore = applyCrashLogConfig({ CRASH_LOG_FLUSH_TIMEOUT_MS: ms });
    restoreConfig ??= restore;
}

function threadNamesOf(receiver: LogReceiver): string[] {
    return receiver.requests.map((request) => request.threadName).sort();
}

function flushSummaryIn(receiver: LogReceiver, threadName: "main" | "vm") {
    return threadStream(receiver, threadName)
        .flatMap(decodeUpload)
        .find((entry) => entry.message === "Log flush round reached");
}

function uploadFor(receiver: LogReceiver, threadName: string) {
    return receiver.requests.find(
        (request) => request.threadName === threadName
    );
}

describe("LogFlushBus", function () {
    let receiver: LogReceiver | undefined;
    const realms: TestRealm[] = [];
    const connections: RealmConnection[] = [];

    function realm(
        threadName: "main" | "sdk" | "vm",
        options: { uploadEndpoint?: string } = {}
    ): TestRealm {
        const created = createTestRealm({
            threadName,
            uploadEndpoint: options.uploadEndpoint ?? receiver!.url
        });
        realms.push(created);
        return created;
    }

    function connect(parent: TestRealm, child: TestRealm): RealmConnection {
        const created = connectRealms(parent, child);
        connections.push(created);
        return created;
    }

    beforeEach(async function () {
        setAckTimeout(ACK_TIMEOUT_MS);
        receiver = undefined;
        receiver = await startLogReceiver();
    });

    after(function () {
        restoreConfig?.();
        restoreConfig = undefined;
    });

    afterEach(async function () {
        setAckTimeout(ACK_TIMEOUT_MS);
        for (const created of connections.splice(0)) created.close();
        for (const created of realms.splice(0)) created.logger.dispose();
        const started = receiver;
        receiver = undefined;
        if (started) await started.close();
    });

    it("uploads a connected realm's logger", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        connect(main, sdk);
        sdk.logger.info("sdk entry");

        await main.bus.flushAll("test");

        expect(threadNamesOf(receiver!)).to.deep.equal(["sdk"]);
    });

    it("reaches a realm two ports away", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        connect(main, sdk);
        connect(sdk, vm);
        vm.logger.info("vm entry");

        await main.bus.flushAll("test");

        expect(threadNamesOf(receiver!)).to.deep.equal(["vm"]);
    });

    it("a flush started in the leaf realm uploads the root realm", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        connect(main, sdk);
        connect(sdk, vm);
        main.logger.info("main entry");

        await vm.bus.flushAll("test");

        expect(threadNamesOf(receiver!)).to.deep.equal(["main"]);
    });

    it("does not echo the flush to the sender", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        const upper = connect(main, sdk);
        const lower = connect(sdk, vm);

        await main.bus.flushAll("test");

        expect(countMessages(upper.toChild, "flushRequest")).to.equal(1);
        expect(countMessages(lower.toChild, "flushRequest")).to.equal(1);
        // the middle realm must not send the round back where it came from
        expect(countMessages(upper.toParent, "flushRequest")).to.equal(0);
    });

    it("resolves after every connected realm has uploaded", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        connect(main, sdk);
        connect(sdk, vm);
        main.logger.info("main entry");
        sdk.logger.info("sdk entry");
        vm.logger.info("vm entry");

        await main.bus.flushAll("test");

        // no waiting -> the round resolved only once all three POSTs landed
        expect(threadNamesOf(receiver!)).to.deep.equal(["main", "sdk", "vm"]);
    });

    it("resolves when a port never acks", async function () {
        setAckTimeout(SHORT_ACK_TIMEOUT_MS);
        const main = realm("main");
        const dead = addDeadPort(main);
        main.logger.info("main entry");

        const startedAt = Date.now();
        const result = await main.bus.flushAll("test");
        dead.remove();

        expect(result.timedOut).to.equal(1);
        expect(Date.now() - startedAt).to.be.greaterThanOrEqual(
            SHORT_ACK_TIMEOUT_MS
        );
        expect(threadNamesOf(receiver!)).to.deep.equal(["main"]);
    });

    it("ignores a port removed before the flush", async function () {
        setAckTimeout(SHORT_ACK_TIMEOUT_MS);
        const main = realm("main");
        const dead = addDeadPort(main);
        dead.remove();
        main.logger.info("main entry");

        const startedAt = Date.now();
        const result = await main.bus.flushAll("test");

        expect(result.timedOut).to.equal(0);
        expect(Date.now() - startedAt).to.be.lessThan(SHORT_ACK_TIMEOUT_MS);
    });

    it("coalesces concurrent flush requests", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        const upper = connect(main, sdk);

        await Promise.all([
            main.bus.flushAll("one"),
            main.bus.flushAll("two"),
            main.bus.flushAll("three")
        ]);

        // the active round plus at most one queued follow-up
        expect(countMessages(upper.toChild, "flushRequest")).to.equal(2);
    });

    it("acks a request that arrives while a round is in flight", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async (_received, index) => {
                if (index === 0) await held.promise;
                return 200;
            }
        });

        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        connect(main, sdk);
        connect(sdk, vm);
        sdk.logger.info("sdk entry");
        vm.logger.info("vm entry");

        // sdk's POST is held open -> its round is still active when main's arrives
        const slowRound = sdk.bus.flushAll("slow");
        await receiver!.waitForRequests(1);
        const fromMain = main.bus.flushAll("from main");

        held.resolve();
        const [, mainResult] = await Promise.all([slowRound, fromMain]);

        expect(mainResult.timedOut).to.equal(0);
        expect(mainResult.ok).to.be.greaterThan(0);
    });

    it("two realms originating at once both resolve without a timeout", async function () {
        setAckTimeout(SHORT_ACK_TIMEOUT_MS);
        const main = realm("main");
        const sdk = realm("sdk");
        connect(main, sdk);
        main.logger.info("main entry");
        sdk.logger.info("sdk entry");

        // each round waits on the other's ack -> a queued round that waited on
        // its whole active round would close the cycle and both would time out
        const startedAt = Date.now();
        const [fromMain, fromSdk] = await Promise.all([
            main.bus.flushAll("main crash"),
            sdk.bus.flushAll("sdk crash")
        ]);
        const elapsedMs = Date.now() - startedAt;

        expect(fromMain.timedOut).to.equal(0);
        expect(fromSdk.timedOut).to.equal(0);
        expect(elapsedMs).to.be.lessThan(SHORT_ACK_TIMEOUT_MS);
    });

    it("a round folded from two children forwards back to neither", async function () {
        const held = deferred();
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: async (_received, index) => {
                if (index === 0) await held.promise;
                return 200;
            }
        });

        const main = realm("main");
        const childA = realm("sdk");
        const childB = realm("sdk");
        const toA = connect(main, childA);
        const toB = connect(main, childB);
        main.logger.info("main entry");

        // main's POST is held open, so both children fold into one queued round
        const mainRound = main.bus.flushAll("main");
        await receiver!.waitForRequests(1);
        const childRounds = Promise.all([
            childA.bus.flushAll("child a"),
            childB.bus.flushAll("child b")
        ]);

        held.resolve();
        await Promise.all([mainRound, childRounds]);

        expect(countMessages(toA.toChild, "flushRequest")).to.equal(1);
        expect(countMessages(toB.toChild, "flushRequest")).to.equal(1);
    });

    it("error() uploads only this realm's store", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        const upper = connect(main, sdk);
        sdk.logger.info("sdk entry");

        main.logger.error("recoverable failure");
        await receiver!.waitForRequests(1);

        expect(threadNamesOf(receiver!)).to.deep.equal(["main"]);
        expect(countMessages(upper.toChild, "flushRequest")).to.equal(0);
    });

    it("a child logger does not add a second upload", async function () {
        const main = realm("main");
        const child = main.logger.child({ component: "Child" });
        child.info("written through the child");

        await main.bus.flushAll("test");

        expect(receiver!.requests).to.have.length(1);
        expect(JSON.stringify(decodeUpload(receiver!.requests[0]))).to.include(
            "written through the child"
        );
    });

    it("a disposed logger is not uploaded", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        // two roots on one bus, as the main thread has one per peer
        main.bus.registerLogger(sdk.logger);
        main.logger.info("main entry");
        sdk.logger.info("sdk entry");

        sdk.logger.dispose();
        await main.bus.flushAll("test");

        expect(threadNamesOf(receiver!)).to.deep.equal(["main"]);
    });

    it("posts nothing when uploads are disabled", async function () {
        const main = realm("main", { uploadEndpoint: "" });
        const sdk = realm("sdk", { uploadEndpoint: "" });
        const upper = connect(main, sdk);
        main.logger.info("main entry");
        upper.toChild.length = 0;

        const result = await main.bus.flushAll("test");

        expect(upper.toChild).to.have.length(0);
        expect(receiver!.requests).to.have.length(0);
        expect(result).to.deep.equal({
            ok: 0,
            failed: 0,
            timedOut: 0,
            entries: 0
        });
    });

    it("context set after connecting reaches the leaf before its first upload", async function () {
        const channelId = ethers.id("channel-set-after-connecting");
        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        connect(main, sdk);
        connect(sdk, vm);
        vm.logger.info("vm entry");

        sdk.logger.updateSharedContext({ channelId });
        await main.bus.flushAll("test");

        expect(uploadFor(receiver!, "vm")?.channelId).to.equal(channelId);
    });

    it("a crash raised in the leaf realm uploads under the channel set after connecting", async function () {
        const channelId = ethers.id("channel-for-leaf-crash");
        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        connect(main, sdk);
        connect(sdk, vm);

        sdk.logger.updateSharedContext({ channelId });
        // the round applies the context and drains the stores -> what follows is
        // only the crash
        await main.bus.flushAll("prime");
        receiver!.requests.length = 0;
        // something new in the root -> the crash round has a second POST to make
        main.logger.info("main entry after priming");

        vm.logUploader.captureUnhandled(
            new Error("leaf realm blew up"),
            "unhandledRejection"
        );
        await receiver!.waitForRequests(2, ACK_TIMEOUT_MS);

        const vmUpload = uploadFor(receiver!, "vm");
        expect(vmUpload?.channelId).to.equal(channelId);
        expect(JSON.stringify(decodeUpload(vmUpload!))).to.include(
            "leaf realm blew up"
        );
        expect(threadNamesOf(receiver!)).to.include("main");
    });

    it("does not apply a peer address arriving from a child", async function () {
        const channelId = ethers.id("channel-from-child");
        const main = realm("main");
        const sdk = realm("sdk");
        connect(main, sdk);
        const mainPeerAddress = main.logger.getSharedContext().peerAddress;

        sdk.logger.updateSharedContext({
            channelId,
            peerAddress: ethers.Wallet.createRandom().address
        });
        // the context update travels the same port ahead of the round -> once this
        // resolves the parent has applied it
        await sdk.bus.flushAll("test");

        expect(main.logger.getSharedContext().channelId).to.equal(channelId);
        expect(main.logger.getSharedContext().peerAddress).to.equal(
            mainPeerAddress
        );
    });

    it("a second root in the same realm follows the channel", async function () {
        const channelId = ethers.id("channel-followed-in-realm");
        const host = realm("sdk");
        const app = realm("main");
        // inline-host shape - two roots, one bus, no port between them
        host.bus.registerLogger(app.logger);
        host.logger.followContextTo(app.logger);
        app.logger.info("app entry");

        host.logger.updateSharedContext({ channelId });
        await host.bus.flushAll("test");

        expect(uploadFor(receiver!, "main")?.channelId).to.equal(channelId);
    });

    it("does not pass peer identity to the following root", async function () {
        const host = realm("sdk");
        const app = realm("main");
        host.bus.registerLogger(app.logger);
        const appPeerAddress = app.logger.getSharedContext().peerAddress;
        host.logger.followContextTo(app.logger);

        host.logger.updateSharedContext({
            peerAddress: ethers.Wallet.createRandom().address
        });

        expect(app.logger.getSharedContext().peerAddress).to.equal(
            appPeerAddress
        );
    });

    it("reports one ok realm per connected thread", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        const vm = realm("vm");
        connect(main, sdk);
        connect(sdk, vm);
        main.logger.info("main entry");
        sdk.logger.info("sdk entry");
        vm.logger.info("vm entry");

        const result = await main.bus.flushAll("test");

        expect(result.ok).to.equal(3);
        expect(result.failed).to.equal(0);
        expect(result.timedOut).to.equal(0);
        expect(result.entries).to.equal(3);
    });

    it("reports a realm whose upload failed", async function () {
        await receiver!.close();
        receiver = await startLogReceiver({
            respond: (received) => (received.threadName === "sdk" ? 500 : 200)
        });

        const main = realm("main");
        const sdk = realm("sdk");
        connect(main, sdk);
        main.logger.info("main entry");
        sdk.logger.info("sdk entry");

        const result = await main.bus.flushAll("test");

        expect(result.failed).to.equal(1);
        expect(result.ok).to.equal(1);
        expect(result.entries).to.equal(1);
    });

    it("reports a port that never acked as timed out", async function () {
        setAckTimeout(SHORT_ACK_TIMEOUT_MS);
        const main = realm("main");
        const first = addDeadPort(main);
        const second = addDeadPort(main);

        const result = await main.bus.flushAll("test");
        first.remove();
        second.remove();

        expect(result.timedOut).to.equal(2);
    });

    it("uploads this realm without waiting for a port that never acks", async function () {
        setAckTimeout(SHORT_ACK_TIMEOUT_MS);
        const vm = realm("vm");
        const dead = addDeadPort(vm);
        vm.logger.info("vm entry");

        const startedAt = Date.now();
        const result = await vm.bus.flushOwnRealm();
        dead.remove();

        expect(Date.now() - startedAt).to.be.lessThan(SHORT_ACK_TIMEOUT_MS);
        expect(result).to.deep.equal({
            ok: 1,
            failed: 0,
            timedOut: 0,
            entries: 1
        });
        expect(threadNamesOf(receiver!)).to.deep.equal(["vm"]);
    });

    it("asks every port while resolving on this realm's own upload", async function () {
        setAckTimeout(SHORT_ACK_TIMEOUT_MS);
        const vm = realm("vm");
        const dead = addDeadPort(vm);
        vm.logger.info("vm entry");

        // the shape the vm worker exits on: sweep detached, wait on its own POST
        const round = vm.bus.flushAll("crash");
        const startedAt = Date.now();
        const own = await vm.bus.flushOwnRealm();

        expect(Date.now() - startedAt).to.be.lessThan(SHORT_ACK_TIMEOUT_MS);
        expect(countMessages(dead.posted, "flushRequest")).to.equal(1);
        // the round already shipped the entry -> this realm has nothing left
        expect(own).to.deep.equal({
            ok: 1,
            failed: 0,
            timedOut: 0,
            entries: 0
        });
        expect(threadNamesOf(receiver!)).to.deep.equal(["vm"]);

        expect((await round).timedOut).to.equal(1);
        dead.remove();
    });

    it("records what a round reached in the realm that asked for it", async function () {
        const main = realm("main");
        const sdk = realm("sdk");
        connect(main, sdk);
        sdk.logger.info("sdk entry");

        const result = await main.logger.uploadLogs("user report");

        expect(result.timedOut).to.equal(0);
        const summary = flushSummaryIn(receiver!, "main");
        expect(summary, "no flush summary entry").to.not.be.undefined;
        expect(summary!.meta[0]).to.deep.equal({
            reason: "user report",
            ...result
        });
    });

    it("records the realms a round never reached", async function () {
        setAckTimeout(SHORT_ACK_TIMEOUT_MS);
        const main = realm("main");
        const dead = addDeadPort(main);

        const result = await main.logger.uploadLogs("user report");
        dead.remove();

        expect(result.timedOut).to.equal(1);
        const summary = flushSummaryIn(receiver!, "main");
        expect(summary, "no flush summary entry").to.not.be.undefined;
        expect(summary!.meta[0].timedOut).to.equal(1);
    });
});
