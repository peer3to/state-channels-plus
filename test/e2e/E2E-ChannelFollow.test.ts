import { channelKey } from "@/utils/channelKey";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { hexlify, randomBytes } from "ethers";

/** The participant whose chain access the tests record. */
const PEER = 1;

/**
 * A participant tells its chain access which channel it follows, so that a
 * light client subscribes to that channel's partition. On the test chain the
 * chain access ignores the calls; the participant's host records each one and
 * lets it run.
 */
describe("E2E: The chain access follows the selected channel", function () {
    it("tells the chain access to follow the channel it selects, with the channel's contract", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { query, validation } = h.control(h.getPeer(PEER));
        const channelId = await query.getChannelId().request();
        const contract = await query.getStateChannelManagerAddress().request();
        await validation.clearChannelListener().request();
        const recording = await h.rpcStub.recordChainFollows(PEER);

        await validation.restoreChannelListener().request();

        expect(await recording.follows()).to.deep.equal([
            {
                call: "follow",
                contract: contract.toLowerCase(),
                channelKey: channelKey(channelId)
            }
        ]);
        await recording.restore();
    });

    it("tells the chain access to stop following when the selection is cleared", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { query, validation } = h.control(h.getPeer(PEER));
        const channelId = await query.getChannelId().request();
        const contract = await query.getStateChannelManagerAddress().request();
        const recording = await h.rpcStub.recordChainFollows(PEER);

        await validation.clearChannelListener().request();

        expect(await recording.follows()).to.deep.equal([
            {
                call: "unfollow",
                contract: contract.toLowerCase(),
                channelKey: channelKey(channelId)
            }
        ]);
        await recording.restore();
    });

    it("stops following the selected channel before it follows another one it selects", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { query, validation } = h.control(h.getPeer(PEER));
        const channelId = await query.getChannelId().request();
        const contract = (
            await query.getStateChannelManagerAddress().request()
        ).toLowerCase();
        const other = hexlify(randomBytes(32));
        const recording = await h.rpcStub.recordChainFollows(PEER);

        await validation.selectChannelListener(other).request();

        expect(await recording.follows()).to.deep.equal([
            { call: "unfollow", contract, channelKey: channelKey(channelId) },
            { call: "follow", contract, channelKey: channelKey(other) }
        ]);
        await recording.restore();
    });

    it("tells the chain access to stop following when the channel listener is disposed", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { query, validation } = h.control(h.getPeer(PEER));
        const channelId = await query.getChannelId().request();
        const contract = await query.getStateChannelManagerAddress().request();
        const recording = await h.rpcStub.recordChainFollows(PEER);

        await validation.disposeChannelListener().request();

        expect(await recording.follows()).to.deep.equal([
            {
                call: "unfollow",
                contract: contract.toLowerCase(),
                channelKey: channelKey(channelId)
            }
        ]);
        await recording.restore();
    });

    it("follows nothing for a select a newer select overtook while it removed the old subscriptions", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { query, validation } = h.control(h.getPeer(PEER));
        const channelId = await query.getChannelId().request();
        const contract = (
            await query.getStateChannelManagerAddress().request()
        ).toLowerCase();
        const recording = await h.rpcStub.recordChainFollows(PEER);

        const race = await validation
            .probeChannelSelectionRace("select")
            .request();

        // the probe selects the original channel again at its end
        expect(await recording.follows()).to.deep.equal([
            { call: "unfollow", contract, channelKey: channelKey(channelId) },
            { call: "follow", contract, channelKey: race.newerChannelKey },
            { call: "unfollow", contract, channelKey: race.newerChannelKey },
            { call: "follow", contract, channelKey: channelKey(channelId) }
        ]);
        await recording.restore();
    });

    it("tells the chain access nothing when the selected channel is selected again", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { validation } = h.control(h.getPeer(PEER));
        const recording = await h.rpcStub.recordChainFollows(PEER);

        await validation.restoreChannelListener().request();

        expect(await recording.follows()).to.deep.equal([]);
        await recording.restore();
    });
});
