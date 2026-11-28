// @distributed-requires: lightClient
import { channelKey } from "@/utils/channelKey";
import {
    assertLightClientSlotNode,
    followRequests,
    nextFollowRequests
} from "@test/fixtures/lightClient/LightClientFollowWire";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { hexlify, randomBytes } from "ethers";

/** The participant whose endpoint requests the tests record. */
const PEER = 1;

/**
 * A participant with the light client on, over a peer3 slot node that serves
 * the light client endpoints: a proxy in front of the node records the
 * subscriptions the participant asks for as it starts reading the chain and
 * selects, clears, switches and disposes its channel listener. The
 * participant keeps one subscription of its state channel manager and
 * subscribes it again whenever the followed topics change.
 */
describe("Light client channel follow on a peer3 node", function () {
    before(function () {
        assertLightClientSlotNode();
    });

    it("subscribes its state channel manager with no topic when it starts reading the chain", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { rpcNodeProxiesByPeer: { [PEER]: 1 } });
        const [proxy] = h.getRpcNodeProxies(PEER);
        const { query } = h.control(h.getPeer(PEER));
        const manager = (
            await query.getStateChannelManagerAddress().request()
        ).toLowerCase();

        expect(await nextFollowRequests(proxy, 0, 1)).to.deep.equal([
            { call: "subscribe", address: manager, topics: [] }
        ]);
    });

    it("subscribes the channel contract with the channel's id as topic when it selects the channel", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { rpcNodeProxiesByPeer: { [PEER]: 1 } });
        const [proxy] = h.getRpcNodeProxies(PEER);
        const { query, validation } = h.control(h.getPeer(PEER));
        const channelId = await query.getChannelId().request();
        const manager = (
            await query.getStateChannelManagerAddress().request()
        ).toLowerCase();
        await validation.clearChannelListener().request();
        await nextFollowRequests(proxy, 0, 5);
        const from = followRequests(proxy).length;

        await validation.restoreChannelListener().request();

        expect(await nextFollowRequests(proxy, from, 2)).to.deep.equal([
            { call: "unsubscribe" },
            {
                call: "subscribe",
                address: manager,
                topics: [channelKey(channelId)]
            }
        ]);
    });

    it("ends the channel's subscription when the selection is cleared", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { rpcNodeProxiesByPeer: { [PEER]: 1 } });
        const [proxy] = h.getRpcNodeProxies(PEER);
        const { query, validation } = h.control(h.getPeer(PEER));
        const manager = (
            await query.getStateChannelManagerAddress().request()
        ).toLowerCase();
        // premise: the selected channel is subscribed
        await nextFollowRequests(proxy, 0, 3);
        const from = followRequests(proxy).length;

        await validation.clearChannelListener().request();

        expect(await nextFollowRequests(proxy, from, 2)).to.deep.equal([
            { call: "unsubscribe" },
            { call: "subscribe", address: manager, topics: [] }
        ]);
    });

    it("ends the channel's subscription when the channel listener is disposed", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { rpcNodeProxiesByPeer: { [PEER]: 1 } });
        const [proxy] = h.getRpcNodeProxies(PEER);
        const { query, validation } = h.control(h.getPeer(PEER));
        const manager = (
            await query.getStateChannelManagerAddress().request()
        ).toLowerCase();
        await nextFollowRequests(proxy, 0, 3);
        const from = followRequests(proxy).length;

        await validation.disposeChannelListener().request();

        expect(await nextFollowRequests(proxy, from, 2)).to.deep.equal([
            { call: "unsubscribe" },
            { call: "subscribe", address: manager, topics: [] }
        ]);
    });

    it("ends the channel's subscription before it subscribes another channel it selects", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { rpcNodeProxiesByPeer: { [PEER]: 1 } });
        const [proxy] = h.getRpcNodeProxies(PEER);
        const { query, validation } = h.control(h.getPeer(PEER));
        const manager = (
            await query.getStateChannelManagerAddress().request()
        ).toLowerCase();
        const other = hexlify(randomBytes(32));
        await nextFollowRequests(proxy, 0, 3);
        const from = followRequests(proxy).length;

        await validation.selectChannelListener(other).request();

        expect(await nextFollowRequests(proxy, from, 4)).to.deep.equal([
            { call: "unsubscribe" },
            { call: "subscribe", address: manager, topics: [] },
            { call: "unsubscribe" },
            {
                call: "subscribe",
                address: manager,
                topics: [channelKey(other)]
            }
        ]);
    });
});
