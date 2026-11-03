import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

/**
 * A peer connected to several RPC nodes. Each node is a WebSocket proxy in
 * front of the one test node, so a test can cut a node's sockets without a
 * second chain and without touching the node itself. Events come from the
 * storage diff service, so only what is still sent to the nodes (transactions,
 * head subscriptions) fails over between them.
 */
describe("E2E: Multiple RPC nodes", function () {
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

        // the peer receives this event from the service
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

    it("sends a join and observes its event through an RPC node that refuses newHeads and offers newBlockHeaders", async function () {
        const h = TestSession.getHarness();
        const proxied = 2;
        // the peer's only node has Asset Hub eth-rpc's head subscriptions
        await h.lifecycle.start(3, 0, {
            rpcNodeProxiesByPeer: { [proxied]: 1 },
            rpcNodeProxiesOfferingOnlyNewBlockHeaders: { [proxied]: [0] }
        });
        const [proxy] = h.getRpcNodeProxies(proxied);
        const callsBefore = h.event.getEventCallCount(
            proxied,
            "onInboundMessagesProcessed"
        );

        // the proxied peer signs and submits its own top-up and waits for it
        // Mutation: no newBlockHeaders after the refusal, the peer hears no block
        await h.join.forceInboundJoinWait({
            participant: h.getPeer(proxied).address
        });
        await h.event.settleContractEvents(proxied);

        expect(
            h.event.getEventCallCount(proxied, "onInboundMessagesProcessed")
        ).to.equal(callsBefore + 1);
        expect(
            proxy.forwardedRequests
                .filter((request) => request.method === "eth_subscribe")
                .map((request) => (request.params as unknown[])[0])
        ).to.include("newBlockHeaders");
    });

    it("watches the channel's logs again only after the listener selects it again", async function () {
        const h = TestSession.getHarness();
        const peer = 2;
        await h.lifecycle.start(3, 0);
        const validation = () => h.control(h.getPeer(peer)).validation;
        expect(await validation().getChannelWatchCount().request()).to.equal(1);

        await validation().clearChannelListener().request();

        expect(await validation().getChannelWatchCount().request()).to.equal(0);
        await validation().restoreChannelListener().request();
        expect(await validation().getChannelWatchCount().request()).to.equal(1);
    });

    it("lets a select that starts while an older select is still removing the watch win, and the older select watches nothing", async function () {
        const h = TestSession.getHarness();
        const peer = 2;
        await h.lifecycle.start(3, 0);
        const validation = () => h.control(h.getPeer(peer)).validation;
        // premise - the selected channel is watched
        expect(await validation().getChannelWatchCount().request()).to.equal(1);

        const result = await validation()
            .probeChannelSelectionRace("select")
            .request();

        expect(result.newerCount).to.equal(1);
        expect(result.olderCount).to.equal(0);
        expect(result.originalCount).to.equal(0);
        expect(result.listenerChannelKey).to.equal(result.newerChannelKey);
        expect(result.eventSyncChannelKey).to.equal(result.newerChannelKey);
    });

    it("keeps the key and watch of a select started while a clear is still removing the watch", async function () {
        const h = TestSession.getHarness();
        const peer = 2;
        await h.lifecycle.start(3, 0);
        const validation = () => h.control(h.getPeer(peer)).validation;
        // premise - the selected channel is watched
        expect(await validation().getChannelWatchCount().request()).to.equal(1);

        const result = await validation()
            .probeChannelSelectionRace("clear")
            .request();

        expect(result.listenerChannelKey).to.equal(result.newerChannelKey);
        expect(result.newerCount).to.equal(1);
        expect(result.originalCount).to.equal(0);
    });
});
