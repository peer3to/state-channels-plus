import { expect } from "chai";
import { ethers } from "ethers";

import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { compareAddresses } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";

describe("discovery runtime port", function () {
    it("rejects invalid join input before changing lifecycle state", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;

        await expect(signer.joinLobby("0x12")).to.be.rejectedWith(
            "Rendezvous topic must be exactly 32 bytes"
        );
        await expect(
            signer.joinLobby(ethers.id("invalid-lobby-options"), {
                amount: Number.POSITIVE_INFINITY
            })
        ).to.be.rejectedWith("Invalid local opening amount");
        await expect(
            signer.joinLobby(ethers.id("invalid-lobby-timeout"), {
                matchTimeoutMs: 0
            })
        ).to.be.rejectedWith("positive integer");
        expect(
            await h.control(h.peers[0]).query.getStatus().request()
        ).to.equal(Status.NOT_OPENED);
    });

    it("forwards the caller topic and resolves pending discovery on explicit leave", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;
        const topic = ethers.id("runtime-port-discovery-topic");
        const pendingJoin = signer.joinLobby(topic);

        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.topic === topic && availability.matching;
        });
        expect(await signer.leaveLobby(topic)).to.equal(true);

        expect(await pendingJoin).to.equal(undefined);
        expect(
            await h.control(h.peers[0]).query.getStatus().request()
        ).to.equal(Status.NOT_OPENED);

        const replacementTopic = ethers.id("runtime-port-after-leave");
        const replacementJoin = signer.joinLobby(replacementTopic);
        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.topic === replacementTopic;
        });
        expect(await signer.leaveLobby(replacementTopic)).to.equal(true);
        expect(await replacementJoin).to.equal(undefined);
    });

    it("rejects discovery while a concrete channel ID is selected", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;
        await signer.setChannelId(ethers.id("targeted-channel"));

        await expect(
            signer.joinLobby(ethers.id("blocked-lobby-topic"))
        ).to.be.rejectedWith("no selected channel");
    });

    it("rejects a targeted channel connection while discovery is active", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const peer = h.peers[0];
        const signer = peer.p2pInstance.p2pSigner;
        const topic = ethers.id("runtime-port-exclusive-lobby");
        const pendingJoin = signer.joinLobby(topic);

        await waitFor(async () => {
            const availability = await h
                .control(peer)
                .query.getLobbyAvailability()
                .request();
            return availability.topic === topic && availability.matching;
        });
        await expect(
            signer.connectToChannel(ethers.id("blocked-target-channel"))
        ).to.be.rejectedWith("Leave the active lobby");
        expect(await h.control(peer).query.getChannelId().request()).to.equal(
            ethers.ZeroHash
        );
        expect(await h.control(peer).query.getStatus().request()).to.equal(
            Status.DISCOVERING
        );

        await signer.leaveLobby(topic);
        expect(await pendingJoin).to.equal(undefined);
    });

    it("settles and cleans the previous lobby before replacement entry", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;
        const firstTopic = ethers.id("runtime-port-first-lobby");
        const secondTopic = ethers.id("runtime-port-second-lobby");
        const firstJoin = signer.joinLobby(firstTopic);

        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.topic === firstTopic;
        });
        const secondJoin = signer.joinLobby(secondTopic);

        expect(await firstJoin).to.equal(undefined);
        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.topic === secondTopic && availability.matching;
        });
        await signer.leaveLobby(secondTopic);
        expect(await secondJoin).to.equal(undefined);
    });

    it("forwards an explicit match timeout while the default remains caller-controlled", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;

        expect(
            await signer.joinLobby(ethers.id("runtime-port-timed-lobby"), {
                matchTimeoutMs: 20
            })
        ).to.equal(undefined);
        expect(
            await h.control(h.peers[0]).query.getStatus().request()
        ).to.equal(Status.NOT_OPENED);

        const indefiniteTopic = ethers.id("runtime-port-indefinite-lobby");
        const indefiniteJoin = signer.joinLobby(indefiniteTopic, {
            matchTimeoutMs: null
        });
        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.topic === indefiniteTopic;
        });
        expect(await signer.leaveLobby(indefiniteTopic)).to.equal(true);
        expect(await indefiniteJoin).to.equal(undefined);
    });

    it("does not let leaveLobby cancel negotiation after matching handoff", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("runtime-port-handoff-boundary");
        const releases = await Promise.all(
            h.peers.map((_, index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        const joins = h.peers.map((peer) =>
            peer.p2pInstance.p2pSigner.joinLobby(topic)
        );

        try {
            await waitFor(async () => {
                const counts = await Promise.all(
                    h.peers.map((peer) =>
                        h
                            .control(peer)
                            .stub.getHeldMatchedNegotiationCount()
                            .request()
                    )
                );
                return counts.every((count) => count === 1);
            });
            expect(
                await h.peers[0].p2pInstance.p2pSigner.leaveLobby(topic)
            ).to.equal(false);
            await expect(
                h.peers[0].p2pInstance.p2pSigner.joinLobby(
                    ethers.id("runtime-port-handoff-replacement")
                )
            ).to.be.rejectedWith("already handed off");

            await Promise.all(releases.map((release) => release()));
            const [first, second] = await Promise.all(joins);
            expect(first?.channelId).to.equal(second?.channelId);
            expect(first?.channelId).not.to.equal(ethers.ZeroHash);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("chains matching and negotiation on the host and returns the opened channel", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("runtime-port-host-owned-lobby");

        const [first, second] = await Promise.all(
            h.peers.map((peer) =>
                peer.p2pInstance.p2pSigner.joinLobby(topic, { amount: 321 })
            )
        );

        expect(first?.channelId).to.equal(second?.channelId);
        expect(first?.channelId).not.to.equal(ethers.ZeroHash);
        expect(first?.peerAddress.toLowerCase()).to.equal(
            h.peers[1].address.toLowerCase()
        );
        expect(second?.peerAddress.toLowerCase()).to.equal(
            h.peers[0].address.toLowerCase()
        );
        for (const peer of h.peers) {
            const availability = await h
                .control(peer)
                .query.getLobbyAvailability()
                .request();
            expect(availability.topic).to.equal(undefined);
        }
    });

    it("settles joinLobby when the runtime is disposed after local signing", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const lowerIndex =
            compareAddresses(h.peers[0].address, h.peers[1].address) < 0
                ? 0
                : 1;
        const higherIndex = lowerIndex === 0 ? 1 : 0;
        const release = await h.rpcStub.holdNegotiationReply(
            higherIndex,
            "openProposal"
        );
        const topic = ethers.id("runtime-port-dispose-signed-attempt");
        const joins = h.peers.map((peer) =>
            peer.p2pInstance.p2pSigner.joinLobby(topic)
        );

        try {
            await waitFor(async () => {
                return (
                    (await h
                        .control(h.peers[higherIndex])
                        .stub.getHeldNegotiationReplyCount()
                        .request()) === 1
                );
            });
            h.contextApi.markAfkPeer({ afkPeerIndex: lowerIndex });
            await h.peers[lowerIndex].p2pInstance.dispose();
            expect(await joins[lowerIndex]).to.equal(undefined);
        } finally {
            await release();
            void joins[higherIndex].catch(() => undefined);
        }
    });
});
