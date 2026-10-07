import { sleep } from "@/utils";
import { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { AbiCoder, keccak256, toQuantity } from "ethers";

/** How long a live log needs to be dispatched and complete its block. */
const LIVE_LOG_SETTLE_MS = 3_000;
/** Longer than the reconnect backoff's 5 s cap: a retry loop would have read again. */
const BACKOFF_CAP_WINDOW_MS = 6_000;

/**
 * A peer connected to several RPC nodes. Each node is a WebSocket proxy in
 * front of the one test node, so a test can cut a node's sockets without a
 * second chain and without touching the node itself.
 */
describe("E2E: Multiple RPC nodes", function () {
    it("delivers an event emitted while the peer's only RPC node was cut through the reconnect catch-up", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const callsBeforeCut = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );
        // the threshold signs the top-up while every peer still reaches the chain
        const topUp = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });

        proxy.cut();
        await h.join.submitPreparedForceInboundJoinWait(topUp, {
            observePeerIndices: [0, 1]
        });
        const inboundHead = await h.query.getLatestInboundMessageHash(0);
        // premise - the cut peer has not seen the event
        expect(await h.query.getLatestInboundMessageHash(proxied)).not.to.equal(
            inboundHead
        );
        proxy.restore();

        await waitFor(
            async () =>
                (await h.query.getLatestInboundMessageHash(proxied)) ===
                inboundHead
        );
        // the renewed subscription is live: a later event arrives on it
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(1).address
        });
        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBeforeCut + 2);
    });

    it("delivers the event missed while cut when a newer event arrives during the catch-up read", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const callsBeforeCut = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );
        // the threshold signs both top-ups while every peer reaches the chain
        const missed = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        const newer = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(1).address
        });
        proxy.cut();
        await h.join.submitPreparedForceInboundJoinWait(missed, {
            observePeerIndices: [0, 1]
        });
        const getLogsBeforeRestore = proxy.forwardedCount("eth_getLogs");
        const releaseCatchUpRead = proxy.holdRequests("eth_getLogs");
        proxy.restore();
        // the reconnect's catch-up read is in flight, held at the proxy
        await waitFor(
            () => proxy.forwardedCount("eth_getLogs") > getLogsBeforeRestore
        );

        // the newer event reaches the reconnected socket's subscription live
        await h.join.submitPreparedForceInboundJoinWait(newer, {
            observePeerIndices: [0, 1]
        });
        // time is the input: long enough for a live log that is not held
        // back to be dispatched and complete its block
        await sleep(LIVE_LOG_SETTLE_MS);
        releaseCatchUpRead();

        await waitFor(
            () =>
                h.event.getEventCallCount(
                    proxied,
                    "onInboundMessagesProcessed"
                ) >=
                callsBeforeCut + 2
        );
        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBeforeCut + 2);
        const [newerLog] = (
            await h.channelManager.queryFilter(
                h.channelManager.filters.InboundMessagesProcessed(h.channelId)
            )
        ).slice(-1);
        // the finished catch-up released its hold on the watermark
        const watermark = await h
            .control(h.getPeer(proxied))
            .validation.getEventWatermark()
            .request();
        expect(watermark).not.to.equal(null);
        expect(watermark!).to.be.at.least(newerLog.blockNumber);
    });

    it("retries a failed catch-up read while the node stays connected", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const topUp = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        proxy.cut();
        await h.join.submitPreparedForceInboundJoinWait(topUp, {
            observePeerIndices: [0, 1]
        });
        const inboundHead = await h.query.getLatestInboundMessageHash(0);
        const getLogsBeforeRestore = proxy.forwardedCount("eth_getLogs");
        // the first catch-up read after the reconnect fails
        proxy.failNextRequest("eth_getLogs");

        proxy.restore();

        await waitFor(
            async () =>
                (await h.query.getLatestInboundMessageHash(proxied)) ===
                inboundHead
        );
        expect(
            proxy.forwardedCount("eth_getLogs") - getLogsBeforeRestore
        ).to.be.at.least(2);
    });

    it("delivers every event exactly once and keeps sending through the second RPC node when the first is cut", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 }
        });
        const [first, second] = h.getRpcNodeProxies(proxied);
        const callsAtStart = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );

        // both nodes stream this event to the peer
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        first.cut();
        // the peer prepares and sends its own top-up through the second node
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(proxied).address
        });

        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsAtStart + 2);
        expect(second.forwardedMethods).to.include("eth_sendRawTransaction");
    });

    it("subscribes a backup node that connects after startup and delivers through it once the first node is cut", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 },
            rpcNodeProxiesCutAtStart: { [proxied]: [1] }
        });
        const [first, backup] = h.getRpcNodeProxies(proxied);
        // premise - the backup was down while the peer started
        expect(backup.forwardedMethods).to.deep.equal([]);
        const callsBefore = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );

        backup.restore();
        // its first socket is subscribed and caught up as a reopened one
        await waitFor(
            () =>
                backup.forwardedCount("eth_subscribe") > 0 &&
                backup.forwardedCount("eth_getLogs") > 0
        );
        first.cut();
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address
        });

        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBefore + 1);
    });

    it("catches the restored first node up over events the backup delivered and sends through it again", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 }
        });
        const [first] = h.getRpcNodeProxies(proxied);
        const callsBefore = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );
        first.cut();
        // the backup streams both
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(1).address
        });
        const getLogsBeforeRestore = first.forwardedCount("eth_getLogs");

        first.restore();
        // the restored node completed one catch-up read over those blocks
        await waitFor(
            () => first.forwardedCount("eth_getLogs") > getLogsBeforeRestore
        );
        const sendsThroughFirst = first.forwardedCount(
            "eth_sendRawTransaction"
        );
        // the peer's own top-up goes through the first node again
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(proxied).address
        });

        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBefore + 3);
        expect(first.forwardedCount("eth_sendRawTransaction")).to.equal(
            sendsThroughFirst + 1
        );
    });

    it("unsubscribes every node socket on clear and subscribes each once again on select", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 }
        });
        const [first] = h.getRpcNodeProxies(proxied);
        const validation = () => h.control(h.getPeer(proxied)).validation;
        expect(
            await validation().getChannelSubscriptionCounts().request()
        ).to.deep.equal([1, 1]);

        await validation().clearChannelListener().request();

        expect(
            await validation().getChannelSubscriptionCounts().request()
        ).to.deep.equal([0, 0]);
        // a reopened socket is not subscribed to the cleared channel
        const subscribesBefore = first.forwardedCount("eth_subscribe");
        first.cut();
        first.restore();
        await waitFor(
            async () =>
                (
                    await validation().getChannelSubscriptionCounts().request()
                )[0] !== null
        );
        // time is the input: long enough for a renewed subscription to be sent
        await sleep(LIVE_LOG_SETTLE_MS);
        expect(first.forwardedCount("eth_subscribe")).to.equal(
            subscribesBefore
        );
        await validation().restoreChannelListener().request();
        expect(
            await validation().getChannelSubscriptionCounts().request()
        ).to.deep.equal([1, 1]);
    });

    it("stops a failing catch-up's retries when its socket drops and catches up on the next one", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const callsBeforeCut = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );
        const topUp = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        proxy.cut();
        await h.join.submitPreparedForceInboundJoinWait(topUp, {
            observePeerIndices: [0, 1]
        });
        proxy.failRequests("eth_getLogs");
        const getLogsBeforeRestore = proxy.forwardedCount("eth_getLogs");
        proxy.restore();
        // the catch-up failed and retried at least once
        await waitFor(
            () =>
                proxy.forwardedCount("eth_getLogs") >= getLogsBeforeRestore + 2
        );

        proxy.cut();
        proxy.stopFailingRequests("eth_getLogs");
        const getLogsBeforeSecondRestore = proxy.forwardedCount("eth_getLogs");
        proxy.restore();
        await waitFor(
            () =>
                h.event.getEventCallCount(
                    proxied,
                    "onInboundMessagesProcessed"
                ) > callsBeforeCut
        );
        // time is the input: the old loop's next retry would have read by now
        await sleep(BACKOFF_CAP_WINDOW_MS);

        // only the new socket's catch-up read: the old loop stopped
        expect(
            proxy.forwardedCount("eth_getLogs") - getLogsBeforeSecondRestore
        ).to.equal(1);
        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBeforeCut + 1);
        const [missedLog] = (
            await h.channelManager.queryFilter(
                h.channelManager.filters.InboundMessagesProcessed(h.channelId)
            )
        ).slice(-1);
        // neither the abandoned catch-up nor the new one holds the watermark
        const watermark = await h
            .control(h.getPeer(proxied))
            .validation.getEventWatermark()
            .request();
        expect(watermark).not.to.equal(null);
        expect(watermark!).to.be.at.least(missedLog.blockNumber);
    });

    it("stops a failing catch-up's retries when the channel listener is cleared", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const validation = () => h.control(h.getPeer(proxied)).validation;
        proxy.cut();
        proxy.failRequests("eth_getLogs");
        const getLogsBeforeRestore = proxy.forwardedCount("eth_getLogs");
        proxy.restore();
        await waitFor(
            () =>
                proxy.forwardedCount("eth_getLogs") >= getLogsBeforeRestore + 2
        );

        await validation().clearChannelListener().request();
        // time is the input: a retry already sleeping may still read once
        await sleep(BACKOFF_CAP_WINDOW_MS);
        const getLogsAfterClear = proxy.forwardedCount("eth_getLogs");
        await sleep(BACKOFF_CAP_WINDOW_MS);

        expect(proxy.forwardedCount("eth_getLogs")).to.equal(getLogsAfterClear);
        proxy.stopFailingRequests("eth_getLogs");
        await validation().restoreChannelListener().request();
        // the stopped catch-up released its hold: a later event moves the
        // watermark to its block
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        await h.event.settleContractEvents(proxied);
        const [laterLog] = (
            await h.channelManager.queryFilter(
                h.channelManager.filters.InboundMessagesProcessed(h.channelId)
            )
        ).slice(-1);
        const watermark = await validation().getEventWatermark().request();
        expect(watermark).not.to.equal(null);
        expect(watermark!).to.be.at.least(laterLog.blockNumber);
    });

    it("stops a failing catch-up's retries when the peer's runtime is disposed", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        proxy.cut();
        proxy.failRequests("eth_getLogs");
        const getLogsBeforeRestore = proxy.forwardedCount("eth_getLogs");
        proxy.restore();
        await waitFor(
            () =>
                proxy.forwardedCount("eth_getLogs") >= getLogsBeforeRestore + 2
        );

        await h.getPeer(proxied).p2pInstance.dispose();
        // time is the input: a retry already sleeping may still read once
        await sleep(BACKOFF_CAP_WINDOW_MS);
        const getLogsAfterDispose = proxy.forwardedCount("eth_getLogs");
        await sleep(BACKOFF_CAP_WINDOW_MS);

        expect(proxy.forwardedCount("eth_getLogs")).to.equal(
            getLogsAfterDispose
        );
        proxy.stopFailingRequests("eth_getLogs");
    });

    it("catches up a channel that opened while a peer subscribed to it before it opened was cut off", async function () {
        const h = TestSession.getHarness();
        const label = "multi-rpc-pre-open-catch-up";
        const channelId = keccak256(
            AbiCoder.defaultAbiCoder().encode(["string"], [label])
        );
        const observer = 2;
        await h.setup(3, {
            autoConnect: false,
            channelId: label,
            rpcNodeProxiesByPeer: { [observer]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(observer);
        // every peer subscribes to the channel before it opens
        await h.setChannelId(channelId);
        const openedBefore = h.event.getEventCallCount(
            observer,
            "onChannelOpened"
        );

        proxy.cut();
        await h.lifecycle.openChannelForParticipants([0, 1], {
            observePeerIndices: [0, 1]
        });
        // premise - the cut observer has not seen the open
        expect(h.event.getEventCallCount(observer, "onChannelOpened")).to.equal(
            openedBefore
        );
        proxy.restore();

        await waitFor(
            () =>
                h.event.getEventCallCount(observer, "onChannelOpened") >
                openedBefore
        );
        await h.event.settleContractEvents(observer);
        expect(h.event.getEventCallCount(observer, "onChannelOpened")).to.equal(
            openedBefore + 1
        );
    });

    it("reads nothing and reports caught up through a node whose head is behind the watermark", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const validation = h.control(h.getPeer(1)).validation;
        const watermark = await validation.getEventWatermark().request();
        if (watermark === null) throw new Error("Expected a watermark");
        const proxy = await RpcNodeProxy.start(h.getConfig().PROVIDER_URL!);
        try {
            proxy.answerRequests("eth_blockNumber", toQuantity(watermark - 1));

            const resumeFrom = await validation
                .runCatchUpThroughNode(proxy.url)
                .request();

            expect(resumeFrom).to.equal(null);
            expect(proxy.forwardedCount("eth_getLogs")).to.equal(0);
        } finally {
            await proxy.close();
        }
    });

    it("reads exactly the watermark block through a node whose head is the watermark", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const validation = h.control(h.getPeer(1)).validation;
        const watermark = await validation.getEventWatermark().request();
        if (watermark === null) throw new Error("Expected a watermark");
        const proxy = await RpcNodeProxy.start(h.getConfig().PROVIDER_URL!);
        try {
            proxy.answerRequests("eth_blockNumber", toQuantity(watermark));

            const resumeFrom = await validation
                .runCatchUpThroughNode(proxy.url)
                .request();

            expect(resumeFrom).to.equal(null);
            expect(proxy.forwardedLogWindows()).to.deep.equal([
                [watermark, watermark]
            ]);
        } finally {
            await proxy.close();
        }
    });

    it("retries from the watermark when the catch-up's head read fails", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const validation = h.control(h.getPeer(1)).validation;
        const watermark = await validation.getEventWatermark().request();
        if (watermark === null) throw new Error("Expected a watermark");
        const proxy = await RpcNodeProxy.start(h.getConfig().PROVIDER_URL!);
        try {
            // the catch-up's head read is the node's first eth_blockNumber
            proxy.failNextRequest("eth_blockNumber");

            const resumeFrom = await validation
                .runCatchUpThroughNode(proxy.url)
                .request();

            expect(resumeFrom).to.equal(watermark);
            expect(proxy.forwardedCount("eth_getLogs")).to.equal(0);
            const retried = await validation
                .runCatchUpThroughNode(proxy.url, resumeFrom ?? undefined)
                .request();
            expect(retried).to.equal(null);
            const windows = proxy.forwardedLogWindows();
            expect(windows.length).to.equal(1);
            expect(windows[0][0]).to.equal(watermark);
        } finally {
            await proxy.close();
        }
    });

    it("keeps the watermark below the catch-up's unread blocks while a recovery query completes later blocks, and advances it once the read finishes", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const validation = h.control(h.getPeer(proxied)).validation;
        const callsBeforeCut = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );
        // the threshold signs both top-ups while every peer reaches the chain
        const missed = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        const later = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(1).address
        });
        proxy.cut();
        await h.join.submitPreparedForceInboundJoinWait(missed, {
            observePeerIndices: [0, 1]
        });
        const getLogsBeforeRestore = proxy.forwardedCount("eth_getLogs");
        // only the catch-up's read: the recovery query below passes
        const releaseCatchUpRead = proxy.holdRequests("eth_getLogs", 1);
        proxy.restore();
        // the reconnect's catch-up read is in flight, held at the proxy
        await waitFor(
            () => proxy.forwardedCount("eth_getLogs") > getLogsBeforeRestore
        );
        await h.join.submitPreparedForceInboundJoinWait(later, {
            observePeerIndices: [0, 1]
        });
        const logs = await h.channelManager.queryFilter(
            h.channelManager.filters.InboundMessagesProcessed(h.channelId)
        );
        const [missedLog, laterLog] = logs.slice(-2);
        const inboundHead = await h.query.getLatestInboundMessageHash(0);
        expect(inboundHead).not.to.equal(null);

        // a real inbound-run recovery reads both logs and completes them
        const recovery = await validation
            .probeInboundRunRecovery(inboundHead!)
            .request();

        expect(recovery.threw).to.equal(null);
        expect(recovery.heldAfter).to.equal(true);
        expect(recovery.scheduledLogCount).to.equal(2);
        const heldWatermark = await validation.getEventWatermark().request();
        expect(heldWatermark).not.to.equal(null);
        expect(heldWatermark!).to.be.lessThan(missedLog.blockNumber);
        releaseCatchUpRead();
        await waitFor(
            async () =>
                ((await validation.getEventWatermark().request()) ?? -1) >=
                laterLog.blockNumber
        );
        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBeforeCut + 2);
    });

    it("converges a catch-up wider than the endpoint's log range limit in LOG_QUERY_MAX_BLOCKS windows", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        const endpointLimit = 10;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 },
            configOverrides: { LOG_QUERY_MAX_BLOCKS: endpointLimit }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        proxy.rejectLogSpansAbove(endpointLimit);
        const callsBeforeCut = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );
        const topUp = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        proxy.cut();
        // the missed range grows past one window
        await h.produceBlocks(endpointLimit + 2);
        await h.join.submitPreparedForceInboundJoinWait(topUp, {
            observePeerIndices: [0, 1]
        });
        const inboundHead = await h.query.getLatestInboundMessageHash(0);
        const windowsBeforeRestore = proxy.forwardedLogWindows().length;

        proxy.restore();

        await waitFor(
            async () =>
                (await h.query.getLatestInboundMessageHash(proxied)) ===
                inboundHead
        );
        const catchUpWindows = proxy
            .forwardedLogWindows()
            .slice(windowsBeforeRestore);
        expect(catchUpWindows.length).to.be.at.least(2);
        for (const [fromBlock, toBlock] of catchUpWindows)
            expect(toBlock - fromBlock + 1).to.be.at.most(endpointLimit);
        // the held live stream is released: a later event arrives on it
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(1).address
        });
        await h.event.settleContractEvents(proxied);
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBeforeCut + 2);
        const [laterLog] = (
            await h.channelManager.queryFilter(
                h.channelManager.filters.InboundMessagesProcessed(h.channelId)
            )
        ).slice(-1);
        // the finished catch-up released its hold on the watermark
        const watermark = await h
            .control(h.getPeer(proxied))
            .validation.getEventWatermark()
            .request();
        expect(watermark).not.to.equal(null);
        expect(watermark!).to.be.at.least(laterLog.blockNumber);
    });

    it("advances the watermark when a backup node drops for good during its catch-up read", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 }
        });
        const [, backup] = h.getRpcNodeProxies(proxied);
        const validation = h.control(h.getPeer(proxied)).validation;
        backup.cut();
        const getLogsBeforeRestore = backup.forwardedCount("eth_getLogs");
        const releaseCatchUpRead = backup.holdRequests("eth_getLogs");
        backup.restore();
        // the backup's catch-up read is in flight, held at its proxy
        await waitFor(
            () => backup.forwardedCount("eth_getLogs") > getLogsBeforeRestore
        );

        // the backup drops before it answers and never comes back
        backup.cut();
        // the first node streams a later event
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        await h.event.settleContractEvents(proxied);
        const [laterLog] = (
            await h.channelManager.queryFilter(
                h.channelManager.filters.InboundMessagesProcessed(h.channelId)
            )
        ).slice(-1);

        const watermark = await validation.getEventWatermark().request();
        expect(watermark).not.to.equal(null);
        expect(watermark!).to.be.at.least(laterLog.blockNumber);
        releaseCatchUpRead();
    });

    it("keeps the watermark held until both nodes' concurrent catch-up reads have finished", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 }
        });
        const [first, second] = h.getRpcNodeProxies(proxied);
        const validation = h.control(h.getPeer(proxied)).validation;
        const callsBeforeCut = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );
        const missed = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        first.cut();
        second.cut();
        await h.join.submitPreparedForceInboundJoinWait(missed, {
            observePeerIndices: [0, 1]
        });
        const [missedLog] = (
            await h.channelManager.queryFilter(
                h.channelManager.filters.InboundMessagesProcessed(h.channelId)
            )
        ).slice(-1);
        const watermarkBefore = await validation.getEventWatermark().request();
        expect(watermarkBefore).not.to.equal(null);
        // premise - the missed event lies above the watermark both hold
        expect(missedLog.blockNumber).to.be.greaterThan(watermarkBefore!);
        const firstReadsBefore = first.forwardedCount("eth_getLogs");
        const secondReadsBefore = second.forwardedCount("eth_getLogs");
        const releaseFirstRead = first.holdRequests("eth_getLogs");
        const releaseSecondRead = second.holdRequests("eth_getLogs");
        first.restore();
        second.restore();
        // both reconnects' catch-up reads are in flight, held at the proxies
        await waitFor(
            () =>
                first.forwardedCount("eth_getLogs") > firstReadsBefore &&
                second.forwardedCount("eth_getLogs") > secondReadsBefore
        );

        releaseFirstRead();
        // the first node's catch-up delivers the missed event
        await waitFor(
            () =>
                h.event.getEventCallCount(
                    proxied,
                    "onInboundMessagesProcessed"
                ) > callsBeforeCut
        );
        await h.event.settleContractEvents(proxied);

        // the second node's catch-up still holds the watermark
        expect(await validation.getEventWatermark().request()).to.equal(
            watermarkBefore
        );
        releaseSecondRead();
        await waitFor(
            async () =>
                ((await validation.getEventWatermark().request()) ?? -1) >=
                missedLog.blockNumber
        );
        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBeforeCut + 1);
    });

    it("reads the rest of a reconnected backup's catch-up through the first connected node once its own read fails", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        const windowBlocks = 10;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 },
            configOverrides: { LOG_QUERY_MAX_BLOCKS: windowBlocks }
        });
        const [first, backup] = h.getRpcNodeProxies(proxied);
        const validation = h.control(h.getPeer(proxied)).validation;
        backup.cut();
        // the backup's missed range grows past one window
        await h.produceBlocks(windowBlocks + 2);
        // the backup stays connected but answers every eth_getLogs with an error
        backup.failRequests("eth_getLogs");
        const firstWindowsBefore = first.forwardedLogWindows().length;

        backup.restore();
        await waitFor(() => backup.failedCount("eth_getLogs") > 0);
        const [[failedFrom]] = backup.failedLogWindows();
        // the remaining windows go through the first node, from the failed one on
        await waitFor(() => {
            const fromBlocks = first
                .forwardedLogWindows()
                .slice(firstWindowsBefore)
                .map(([fromBlock]) => fromBlock);
            return (
                fromBlocks.includes(failedFrom) &&
                fromBlocks.includes(failedFrom + windowBlocks)
            );
        });

        // the finished catch-up released its hold: a later event moves the
        // watermark to its block
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        await h.event.settleContractEvents(proxied);
        const [laterLog] = (
            await h.channelManager.queryFilter(
                h.channelManager.filters.InboundMessagesProcessed(h.channelId)
            )
        ).slice(-1);
        const watermark = await validation.getEventWatermark().request();
        expect(watermark).not.to.equal(null);
        expect(watermark!).to.be.at.least(laterLog.blockNumber);
        // time is the input: a retry through the backup would have read by now
        await sleep(BACKOFF_CAP_WINDOW_MS);
        expect(backup.failedCount("eth_getLogs")).to.equal(1);
        backup.stopFailingRequests("eth_getLogs");
    });
});
