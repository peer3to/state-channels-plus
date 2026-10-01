import { sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** How long a live log needs to be dispatched and complete its block. */
const LIVE_LOG_SETTLE_MS = 3_000;

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
        const inboundHeadOf = (index: number) =>
            h
                .control(h.getPeer(index))
                .query.getLatestInboundMessageHash()
                .request();
        const handlerCalls =
            h.getPeer(proxied).eventSpies.onInboundMessagesProcessed!;
        const callsBeforeCut = handlerCalls.callCount;
        // the threshold signs the top-up while every peer still reaches the chain
        const topUp = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });

        proxy.cut();
        await h.join.submitPreparedForceInboundJoinWait(topUp, {
            observePeerIndices: [0, 1]
        });
        const inboundHead = await inboundHeadOf(0);
        // premise - the cut peer has not seen the event
        expect(await inboundHeadOf(proxied)).not.to.equal(inboundHead);
        proxy.restore();

        await waitFor(
            async () => (await inboundHeadOf(proxied)) === inboundHead
        );
        await waitFor(() => handlerCalls.callCount > callsBeforeCut);
        // a duplicate would be scheduled before the drain settles
        await h
            .control(h.getPeer(proxied))
            .validation.drainScheduledEvents()
            .request();
        expect(handlerCalls.callCount).to.equal(callsBeforeCut + 1);
    });

    it("delivers the event missed while cut when a newer event arrives during the catch-up read", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const handlerCalls =
            h.getPeer(proxied).eventSpies.onInboundMessagesProcessed!;
        const callsBeforeCut = handlerCalls.callCount;
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
        const getLogsCount = () =>
            proxy.forwardedMethods.filter((method) => method === "eth_getLogs")
                .length;
        const getLogsBeforeRestore = getLogsCount();
        const releaseCatchUpRead = proxy.holdRequests("eth_getLogs");
        proxy.restore();
        // the reconnect's catch-up read is in flight, held at the proxy
        await waitFor(() => getLogsCount() > getLogsBeforeRestore);

        // the newer event reaches the reconnected socket's subscription live
        await h.join.submitPreparedForceInboundJoinWait(newer, {
            observePeerIndices: [0, 1]
        });
        // time is the input: long enough for a live log that is not held
        // back to be dispatched and complete its block
        await sleep(LIVE_LOG_SETTLE_MS);
        releaseCatchUpRead();

        await waitFor(() => handlerCalls.callCount >= callsBeforeCut + 2);
        await h
            .control(h.getPeer(proxied))
            .validation.drainScheduledEvents()
            .request();
        expect(handlerCalls.callCount).to.equal(callsBeforeCut + 2);
    });

    it("retries a failed catch-up read while the node stays connected", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const inboundHeadOf = (index: number) =>
            h
                .control(h.getPeer(index))
                .query.getLatestInboundMessageHash()
                .request();
        const topUp = await h.join.prepareForceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        proxy.cut();
        await h.join.submitPreparedForceInboundJoinWait(topUp, {
            observePeerIndices: [0, 1]
        });
        const inboundHead = await inboundHeadOf(0);
        const getLogsCount = () =>
            proxy.forwardedMethods.filter((method) => method === "eth_getLogs")
                .length;
        const getLogsBeforeRestore = getLogsCount();
        // the first catch-up read after the reconnect fails
        proxy.failNextRequest("eth_getLogs");

        proxy.restore();

        await waitFor(
            async () => (await inboundHeadOf(proxied)) === inboundHead
        );
        expect(getLogsCount() - getLogsBeforeRestore).to.be.at.least(2);
    });

    it("delivers every event exactly once and keeps sending through the second RPC node when the first is cut", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 2 }
        });
        const [first, second] = h.getRpcNodeProxies(proxied);
        const handlerCalls =
            h.getPeer(proxied).eventSpies.onInboundMessagesProcessed!;
        const callsAtStart = handlerCalls.callCount;

        // both nodes stream this event to the peer
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(0).address
        });
        first.cut();
        // the peer prepares and sends its own top-up through the second node
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(proxied).address
        });

        await waitFor(() => handlerCalls.callCount >= callsAtStart + 2);
        // a duplicate would be scheduled before the drain settles
        await h
            .control(h.getPeer(proxied))
            .validation.drainScheduledEvents()
            .request();
        expect(handlerCalls.callCount).to.equal(callsAtStart + 2);
        expect(second.forwardedMethods).to.include("eth_sendRawTransaction");
    });
});
