import { expect } from "chai";
import { ethers } from "ethers";

import { compareAddresses } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import { sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

describe("LocalDiscoveryServer topic lifecycle", function () {
    it("redials an eligible disconnected peer while the topic remains observed and stops after leave", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-redial-until-leave");
        const primaryIndex =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? 0
                : 1;
        const otherIndex = 1 - primaryIndex;
        const primary = h.peers[primaryIndex];
        const other = h.peers[otherIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        const firstToken = await h
            .control(primary)
            .network.getTransportToken(other.address)
            .request();
        expect(firstToken).to.be.a("number");

        expect(
            await h
                .control(primary)
                .network.closePeerTransportByAddress(other.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(primary)
                .query.isBlacklisted(other.address)
                .request()
        ).to.equal(false);
        let replacementToken: number | null = null;
        await waitFor(
            async () => {
                replacementToken = await h
                    .control(primary)
                    .network.getTransportToken(other.address)
                    .request();
                return (
                    replacementToken !== null && replacementToken !== firstToken
                );
            },
            h.event.protocolEventTimeoutMs(),
            200
        );
        expect(replacementToken).to.not.equal(firstToken);

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.leaveSelectedKey(topic).request()
            )
        );
        expect(
            await h
                .control(primary)
                .network.closePeerTransportByAddress(other.address)
                .request()
        ).to.equal(true);
        await sleep(600);
        expect(
            await h
                .control(primary)
                .network.getTransportToken(other.address)
                .request()
        ).to.equal(null);
        expect(
            await h.control(primary).query.getOpenConnectionCount().request()
        ).to.equal(0);
    });

    it("does not redial a peer blacklisted before its transport closes", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("local-discovery-blacklist-stops-redial");
        const primaryIndex =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? 0
                : 1;
        const otherIndex = 1 - primaryIndex;
        const primary = h.peers[primaryIndex];
        const other = h.peers[otherIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(topic).request()
            )
        );
        await h.network.waitForP2PConnections();
        expect(
            await h
                .control(primary)
                .network.blacklistAndDisconnectPeerByAddress(other.address)
                .request()
        ).to.equal(true);
        await sleep(600);

        expect(
            await h
                .control(primary)
                .query.isBlacklisted(other.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(primary)
                .network.getTransportToken(other.address)
                .request()
        ).to.equal(null);
        expect(
            await h.control(primary).query.getOpenConnectionCount().request()
        ).to.equal(0);
    });

    it("does not dial a peer that already has a live authenticated transport on another topic", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const firstTopic = ethers.id("local-discovery-dedupe-first-topic");
        const secondTopic = ethers.id("local-discovery-dedupe-second-topic");
        const primaryIndex =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? 0
                : 1;
        const primary = h.peers[primaryIndex];
        const other = h.peers[1 - primaryIndex];

        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(firstTopic).request()
            )
        );
        await h.network.waitForP2PConnections();
        const firstToken = await h
            .control(primary)
            .network.getTransportToken(other.address)
            .request();
        expect(firstToken).to.be.a("number");

        // A second observed topic announces the same peer again. One live
        // authenticated transport must be reused instead of dialed twice.
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).network.joinSelectedKey(secondTopic).request()
            )
        );
        await sleep(600);
        expect(
            await h
                .control(primary)
                .network.getTransportToken(other.address)
                .request()
        ).to.equal(firstToken);
        expect(
            await h.control(primary).query.getOpenConnectionCount().request()
        ).to.equal(1);
        expect(
            await h.control(other).query.getOpenConnectionCount().request()
        ).to.equal(1);

        await Promise.all(
            h.peers.flatMap((peer) => [
                h.control(peer).network.leaveSelectedKey(firstTopic).request(),
                h.control(peer).network.leaveSelectedKey(secondTopic).request()
            ])
        );
    });
});
