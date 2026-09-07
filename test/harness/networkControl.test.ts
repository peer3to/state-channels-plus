import { Status } from "@/types";
import { Codec, sleep, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("harness network control", function () {
    it("orders lobby roles by the two real peer addresses in either peer ordering", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const [advertiser, selector] = h.network.lobbyRoleIndices();
        expect(
            BigInt(h.peers[advertiser].address) <
                BigInt(h.peers[selector].address)
        ).to.equal(true);
        const original = [...h.peers];
        try {
            h.peers.reverse();
            expect(h.network.lobbyRoleIndices()).to.deep.equal([
                1 - advertiser,
                1 - selector
            ]);
        } finally {
            h.peers.splice(0, h.peers.length, ...original);
        }
    });

    it("intentional peer isolation blacklists both Holepunch directions", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);

        await h.network.blacklistAndDisconnectPeer(1);
        await sleep(600);

        expect(
            await h
                .control(h.getPeer(0))
                .query.isBlacklisted(h.getPeer(1).address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(h.getPeer(1))
                .query.isBlacklisted(h.getPeer(0).address)
                .request()
        ).to.equal(true);
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).query.getOpenConnectionCount().request()
                )
            )
        ).to.deep.equal([0, 0]);
    });

    it("explicit peer reconnection clears the harness blacklist", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        await h.network.blacklistAndDisconnectPeer(1);

        // Peer 1↔peer 0 reconnection is the explicit inverse under test.
        await h.network.reconnectPeers([1]);
        await h.network.waitForP2PConnections();

        expect(
            await h
                .control(h.getPeer(0))
                .query.isBlacklisted(h.getPeer(1).address)
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(h.getPeer(1))
                .query.isBlacklisted(h.getPeer(0).address)
                .request()
        ).to.equal(false);
    });

    it("connectToChannel control returns while the signer promise is unsettled", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const target = ethers.keccak256(ethers.toUtf8Bytes("detached-ack"));

        expect(
            await h
                .control(h.getPeer(0))
                .network.connectToChannel(target, { timeoutMs: 25 })
                .request()
        ).to.equal(true);
        await TestSession.settleDetached({
            expectedErrorIncludes: `connectToChannel failed for ${target}`
        });
    });

    it("detached unmatched matchmaking timeout false becomes the first detached error", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const target = ethers.keccak256(ethers.toUtf8Bytes("unmatched-false"));

        await h
            .control(h.getPeer(0))
            .network.connectToChannel(target, {
                autoOpen: true,
                timeoutMs: 25
            })
            .request();
        await TestSession.settleDetached({
            expectedErrorIncludes: `connectToChannel failed for ${target}`
        });
    });

    it("connectToChannel control surfaces a signer rejection as a detached error", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });

        expect(
            await h
                .control(h.getPeer(0))
                .network.connectToChannel("0x12")
                .request()
        ).to.equal(true);
        await TestSession.settleDetached({
            expectedErrorIncludes: "Channel ID must be exactly 32 bytes"
        });
    });

    it("connectToChannel control forwards options before detached dispatch", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const target = ethers.keccak256(ethers.toUtf8Bytes("forward-options"));

        const acknowledgement = await h
            .control(h.getPeer(0))
            .network.connectToChannel(target, {
                autoOpen: true,
                shouldJoin: true,
                encodedBalance: String(
                    Codec.encode({ amount: 321n, data: "0x1234" }, Type.Balance)
                ),
                timeoutMs: 25
            })
            .request();
        expect(acknowledgement).to.equal(true);
        await TestSession.settleDetached({
            expectedErrorIncludes: `connectToChannel failed for ${target}`
        });
    });

    it("accepted match remains collected past matchmaking timeout", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const target = ethers.id("detached-accepted-match");
        const releases = await Promise.all(
            h.peers.map((_, index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        try {
            await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .network.connectToChannel(target, {
                            autoOpen: true,
                            timeoutMs: 2_000
                        })
                        .request()
                )
            );
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            h.peers.map((peer) =>
                                h
                                    .control(peer)
                                    .stub.getHeldMatchedNegotiationCount()
                                    .request()
                            )
                        )
                    ).every((count) => count === 1),
                h.event.protocolEventTimeoutMs()
            );
            await sleep(2_100);
            await Promise.all(releases.map((release) => release()));
            await TestSession.settleDetached();
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("full-flow connect awaits detached success before test completion", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const target = ethers.id("detached-full-flow");

        await Promise.all(
            h.peers.map((peer) =>
                h
                    .control(peer)
                    .network.connectToChannel(target, { autoOpen: true })
                    .request()
            )
        );
        await TestSession.settleDetached();
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).query.getStatus().request()
                )
            )
        ).to.deep.equal([Status.PARTICIPATING, Status.PARTICIPATING]);
    });

    it("expected connect failure does not hide an unrelated detached error", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const target = ethers.id("detached-error-isolation");

        await h
            .control(h.getPeer(0))
            .network.connectToChannel(target, { timeoutMs: 25 })
            .request();
        TestSession.setFirstDetachedError(new Error("unrelated host failure"));
        await expect(
            TestSession.settleDetached({
                expectedErrorIncludes: `connectToChannel failed for ${target}`
            })
        ).to.be.rejectedWith("unrelated host failure");
    });
});
