import { expect } from "chai";
import { ethers } from "ethers";

import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { compareAddresses } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import { channelIdToTargetedJoinTopic, Codec, Type } from "@/utils";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";
import { sleep } from "@/utils";

describe("connectToChannel input validation", function () {
    const setup = async () => {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        return { h, signer: h.peers[0].p2pInstance.p2pSigner };
    };

    const assertClean = async (
        h: ReturnType<typeof TestSession.getHarness>
    ) => {
        expect(
            await h.control(h.peers[0]).query.getChannelId().request()
        ).to.equal(ethers.ZeroHash);
        expect(
            await h.control(h.peers[0]).query.getStatus().request()
        ).to.equal(Status.NOT_OPENED);
    };

    it("invalid channel ID rejects before state mutation", async function () {
        const { h, signer } = await setup();
        await expect(signer.connectToChannel("0x12")).to.be.rejectedWith(
            "exactly 32 bytes"
        );
        await assertClean(h);
    });

    it("non-boolean autoOpen rejects before state mutation", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("bad-auto-open"), {
                autoOpen: "yes" as never
            })
        ).to.be.rejectedWith("autoOpen must be a boolean");
        await assertClean(h);
    });

    it("balance missing amount rejects before port dispatch", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("missing-amount"), {
                balance: { data: "0x" } as never
            })
        ).to.be.rejected;
        await assertClean(h);
    });

    it("balance missing data rejects before port dispatch", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("missing-data"), {
                balance: { amount: 1n } as never
            })
        ).to.be.rejected;
        await assertClean(h);
    });

    it("negative balance amount rejects before port dispatch", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("negative-balance"), {
                balance: { amount: -1n, data: "0x" }
            })
        ).to.be.rejected;
        await assertClean(h);
    });

    it("fractional numeric balance amount rejects before port dispatch", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("fractional-balance"), {
                balance: { amount: 1.5, data: "0x" }
            })
        ).to.be.rejected;
        await assertClean(h);
    });

    it("unsafe numeric balance amount rejects before port dispatch", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("unsafe-balance"), {
                balance: { amount: Number.MAX_SAFE_INTEGER + 1, data: "0x" }
            })
        ).to.be.rejected;
        await assertClean(h);
    });

    it("uint256-overflow balance amount rejects before port dispatch", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("overflow-balance"), {
                balance: { amount: ethers.MaxUint256 + 1n, data: "0x" }
            })
        ).to.be.rejected;
        await assertClean(h);
    });

    it("invalid balance data rejects before port dispatch", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("bad-balance-data"), {
                balance: { amount: 1n, data: "not-hex" }
            })
        ).to.be.rejected;
        await assertClean(h);
    });

    it("zero timeout rejects before matching", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("zero-timeout"), {
                timeoutMs: 0
            })
        ).to.be.rejectedWith("positive finite integer");
        await assertClean(h);
    });

    it("negative timeout rejects before matching", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("negative-timeout"), {
                timeoutMs: -1
            })
        ).to.be.rejectedWith("positive finite integer");
        await assertClean(h);
    });

    it("fractional timeout rejects before matching", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("fractional-timeout"), {
                timeoutMs: 1.5
            })
        ).to.be.rejectedWith("positive finite integer");
        await assertClean(h);
    });

    it("non-finite timeout rejects before matching", async function () {
        const { h, signer } = await setup();
        await expect(
            signer.connectToChannel(ethers.id("infinite-timeout"), {
                timeoutMs: Number.POSITIVE_INFINITY
            })
        ).to.be.rejectedWith("positive finite integer");
        await assertClean(h);
    });

    it("omitted matchmaking timeout behaves as null", async function () {
        const { h, signer } = await setup();
        const channelId = ethers.id("omitted-and-null-timeout");
        const assertUnbounded = async (timeoutMs?: null) => {
            const pending = signer.connectToChannel(channelId, {
                autoOpen: true,
                ...(timeoutMs === null ? { timeoutMs } : {})
            });
            await waitFor(async () => {
                const availability = await h
                    .control(h.peers[0])
                    .query.getLobbyAvailability()
                    .request();
                return (
                    availability.topic ===
                        channelIdToTargetedJoinTopic(channelId) &&
                    availability.matching
                );
            });
            await sleep(50);
            expect(
                await h
                    .control(h.peers[0])
                    .query.getLobbyAvailability()
                    .request()
            ).to.include({ matching: true });
            expect(await signer.cancelConnectToChannel(channelId)).to.equal(
                true
            );
            expect(await pending).to.equal(false);
        };

        await assertUnbounded();
        await assertUnbounded(null);
    });

    it("null timeout is accepted as unbounded matching", async function () {
        const { h, signer } = await setup();
        const channelId = ethers.id("null-timeout");
        const pending = signer.connectToChannel(channelId, {
            autoOpen: true,
            timeoutMs: null
        });
        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return (
                availability.topic ===
                    channelIdToTargetedJoinTopic(channelId) &&
                availability.matching
            );
        });
        expect(await signer.cancelConnectToChannel(channelId)).to.equal(true);
        expect(await pending).to.equal(false);
    });
});

describe("connectToChannel signer contract", function () {
    it("same-channel connect remains available for a participating runtime", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const peer = h.peers[0];
        let leaveTurnCount = 0;
        peer.p2pInstance.events.on(
            "p2pEventHooks",
            "onLeaveTurn",
            () => leaveTurnCount++
        );

        expect(
            await peer.p2pInstance.p2pSigner.connectToChannel(h.channelId)
        ).to.equal(true);
        expect(await h.control(peer).query.getChannelId().request()).to.equal(
            h.channelId
        );
        expect(await h.control(peer).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
        expect(leaveTurnCount).to.equal(0);
    });

    it("harness channel staging selects the external ID without opening or discovery", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            configOverrides: { DEBUG_LOCAL_TRANSPORT: false }
        });
        const channelId = ethers.id("externally-opened-staging");

        await h.setChannelId(channelId);

        for (const peer of h.peers) {
            expect(
                await h.control(peer).query.getChannelId().request()
            ).to.equal(channelId);
            expect(await h.control(peer).query.getStatus().request()).to.equal(
                Status.NOT_OPENED
            );
            const availability = await h
                .control(peer)
                .query.getLobbyAvailability()
                .request();
            expect(availability.role).to.equal("none");
            expect(availability.candidateCount).to.equal(0);
            expect(availability.matching).to.equal(false);
            expect(
                await h.control(peer).query.getJoinedHolepunchTopics().request()
            ).to.deep.equal([]);
            expect(await h.query.getConnectionCount(peer.index)).to.equal(0);
        }
    });

    it("cross-channel connect preserves a synced observer runtime", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const channelId = ethers.id("synced-owner-channel");
        await Promise.all(
            h.peers.slice(0, 2).map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                    autoOpen: true
                })
            )
        );
        const observer = h.peers[2];
        expect(
            await observer.p2pInstance.p2pSigner.connectToChannel(channelId)
        ).to.equal(true);
        const before = {
            channelId: await h.control(observer).query.getChannelId().request(),
            status: await h.control(observer).query.getStatus().request(),
            forkId: await h.control(observer).query.getForkId().request(),
            participants: await h
                .control(observer)
                .query.getParticipants()
                .request(),
            connections: await h
                .control(observer)
                .query.getOpenConnectionCount()
                .request()
        };

        await expect(
            observer.p2pInstance.p2pSigner.connectToChannel(
                ethers.id("synced-rejected-channel")
            )
        ).to.be.rejectedWith("already owns channel");

        expect({
            channelId: await h.control(observer).query.getChannelId().request(),
            status: await h.control(observer).query.getStatus().request(),
            forkId: await h.control(observer).query.getForkId().request(),
            participants: await h
                .control(observer)
                .query.getParticipants()
                .request(),
            connections: await h
                .control(observer)
                .query.getOpenConnectionCount()
                .request()
        }).to.deep.equal(before);
    });

    it("cross-channel connect preserves a pending participant runtime", async function () {
        const h = TestSession.getHarness();
        const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
        const joiner = h.getPeer(prepared.joiner.index);
        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            )
        ).to.equal(true);
        const before = {
            channelId: await h
                .control(prepared.joiner)
                .query.getChannelId()
                .request(),
            status: await h
                .control(prepared.joiner)
                .query.getStatus()
                .request(),
            forkId: await h
                .control(prepared.joiner)
                .query.getForkId()
                .request(),
            participants: await h
                .control(prepared.joiner)
                .query.getParticipants()
                .request()
        };

        await expect(
            prepared.joiner.p2pInstance.p2pSigner.connectToChannel(
                ethers.id("pending-rejected-channel")
            )
        ).to.be.rejectedWith("already owns channel");

        expect({
            channelId: await h
                .control(prepared.joiner)
                .query.getChannelId()
                .request(),
            status: await h
                .control(prepared.joiner)
                .query.getStatus()
                .request(),
            forkId: await h
                .control(prepared.joiner)
                .query.getForkId()
                .request(),
            participants: await h
                .control(prepared.joiner)
                .query.getParticipants()
                .request()
        }).to.deep.equal(before);
    });

    it("cross-channel connect preserves a participating runtime", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const peer = h.peers[1];
        const before = {
            channelId: await h.control(peer).query.getChannelId().request(),
            status: await h.control(peer).query.getStatus().request(),
            forkId: await h.control(peer).query.getForkId().request(),
            participants: await h
                .control(peer)
                .query.getParticipants()
                .request(),
            connections: await h
                .control(peer)
                .query.getOpenConnectionCount()
                .request()
        };

        await expect(
            peer.p2pInstance.p2pSigner.connectToChannel(
                ethers.id("participant-rejected-channel")
            )
        ).to.be.rejectedWith("already owns channel");

        expect({
            channelId: await h.control(peer).query.getChannelId().request(),
            status: await h.control(peer).query.getStatus().request(),
            forkId: await h.control(peer).query.getForkId().request(),
            participants: await h
                .control(peer)
                .query.getParticipants()
                .request(),
            connections: await h
                .control(peer)
                .query.getOpenConnectionCount()
                .request()
        }).to.deep.equal(before);
    });

    it("worker ports round-trip the full balance for joinLobby and connectToChannel", async function () {
        const h = TestSession.getHarness();
        await h.setup(4, { autoConnect: false });
        const balance = { amount: 321n, data: "0x1234" };
        const lobbyTopic = ethers.id("full-balance-worker-lobby");
        const target = ethers.id("full-balance-worker-target");

        const [ordinary, targeted] = await Promise.all([
            Promise.all(
                h.peers.slice(0, 2).map((peer) =>
                    peer.p2pInstance.p2pSigner.joinLobby(lobbyTopic, {
                        balance
                    })
                )
            ),
            Promise.all(
                h.peers.slice(2).map((peer) =>
                    peer.p2pInstance.p2pSigner.connectToChannel(target, {
                        autoOpen: true,
                        shouldJoin: true,
                        balance
                    })
                )
            )
        ]);

        expect(
            ordinary.every((match) => match?.channelId !== undefined)
        ).to.equal(true);
        expect(targeted).to.deep.equal([true, true]);
    });

    it("worker direct joinChannel receipt failure restores SYNCED", async function () {
        const h = TestSession.getHarness();
        const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
        const restore = await h.rpcStub.failMembershipReceipt(
            prepared.joiner.index,
            "joinChannel"
        );
        try {
            expect(
                await prepared.joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(false);
            expect(
                await h.control(prepared.joiner).query.getStatus().request()
            ).to.equal(Status.SYNCED);
            expect(
                await new TargetedChannelJoinFixture(h).isDisposed(
                    prepared.joiner
                )
            ).to.equal(false);
        } finally {
            await restore();
        }
    });

    it("already-open target with balance but no shouldJoin syncs without membership", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const channelId = ethers.id("observer-dormant-balance");
        const opened = await Promise.all(
            h.peers.slice(0, 2).map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                    autoOpen: true
                })
            )
        );
        expect(opened).to.deep.equal([true, true]);

        expect(
            await h.peers[2].p2pInstance.p2pSigner.connectToChannel(channelId, {
                balance: { amount: 321n, data: "0x1234" }
            })
        ).to.equal(true);
        expect(
            await h.control(h.peers[2]).query.getStatus().request()
        ).to.equal(Status.SYNCED);
        const participants = await h.channelManager.getParticipants(channelId);
        expect(
            participants
                .map(String)
                .map((address: string) => address.toLowerCase())
        ).not.to.include(h.peers[2].address.toLowerCase());
    });

    it("autoOpen without shouldJoin opens and syncs without membership", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const channelId = ethers.id("auto-open-without-join");
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                        autoOpen: true,
                        balance: { amount: 654n, data: "0xabcd" }
                    })
                )
            )
        ).to.deep.equal([true, true]);
        const participants = await h.channelManager.getParticipants(channelId);
        expect(participants).to.have.length(2);
        const opening = await h
            .control(h.peers[0])
            .lifecycle.getEncodedOpening(channelId)
            .request();
        expect(opening).not.to.equal(null);
        const decoded = Codec.decode(
            opening!.encodedOpenChannel,
            Type.OpenChannel
        );
        expect(decoded.balances).to.deep.equal([
            { amount: 654n, data: "0xabcd" },
            { amount: 654n, data: "0xabcd" }
        ]);
    });

    it("shouldJoin on an already-open target uses the default balance when omitted", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const channelId = ethers.id("already-open-default-join");
        await Promise.all(
            h.peers.slice(0, 2).map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                    autoOpen: true
                })
            )
        );

        expect(
            await h.peers[2].p2pInstance.p2pSigner.connectToChannel(channelId, {
                shouldJoin: true
            })
        ).to.equal(true);
        expect(
            await h.control(h.peers[2]).query.getStatus().request()
        ).to.equal(Status.PENDING_PARTICIPANT);
    });

    it("shouldJoin on an already-open target preserves supplied amount and data", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const channelId = ethers.id("already-open-full-balance-join");
        await Promise.all(
            h.peers.slice(0, 2).map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                    autoOpen: true
                })
            )
        );

        expect(
            await h.peers[2].p2pInstance.p2pSigner.connectToChannel(channelId, {
                shouldJoin: true,
                balance: { amount: 321n, data: "0x1234" }
            })
        ).to.equal(true);
        expect(
            await h.control(h.peers[2]).query.getStatus().request()
        ).to.equal(Status.PENDING_PARTICIPANT);
        const inboundHash = await h
            .control(h.peers[2])
            .query.getLatestInboundMessageHash()
            .request();
        expect(inboundHash).not.to.equal(null);
        const inbound = await h
            .control(h.peers[2])
            .query.getInboundMessageBlock(inboundHash!)
            .request();
        expect(inbound).not.to.equal(null);
        const decoded = Codec.decode(
            inbound!.encodedMessageBlock,
            Type.MessageBlock
        );
        const join = decoded.messages.find(
            (message) => message.participant === h.peers[2].address
        );
        expect(join?.balance).to.deep.equal({
            amount: 321n,
            data: "0x1234"
        });
    });

    it("autoOpen with shouldJoin uses the default balance when omitted", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const channelId = ethers.id("auto-open-default-join");
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                        autoOpen: true,
                        shouldJoin: true
                    })
                )
            )
        ).to.deep.equal([true, true]);
    });

    it("autoOpen with shouldJoin preserves supplied amount and data", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const channelId = ethers.id("auto-open-full-balance-join");
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                        autoOpen: true,
                        shouldJoin: true,
                        balance: { amount: 432n, data: "0x4321" }
                    })
                )
            )
        ).to.deep.equal([true, true]);
    });

    it("cancelConnectToChannel uses its own worker request and channel ID", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;
        const channelId = ethers.id("dedicated-target-cancel-route");
        const connect = signer.connectToChannel(channelId, {
            autoOpen: true
        });
        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.matching;
        });

        expect(await signer.cancelConnectToChannel(channelId)).to.equal(true);
        expect(await connect).to.equal(false);
        expect(await signer.leaveLobby(channelId)).to.equal(false);
    });

    it("matching cancellation returns true and settles false before acceptance", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;
        const channelId = ethers.id("cancel-before-target-match");
        const connect = signer.connectToChannel(channelId, {
            autoOpen: true,
            timeoutMs: null
        });
        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.matching;
        });

        expect(await signer.cancelConnectToChannel(channelId)).to.equal(true);
        expect(await connect).to.equal(false);
        expect(
            await h.control(h.peers[0]).query.getChannelId().request()
        ).to.equal(channelId);
    });

    it("matching cancellation returns false after acceptance", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const channelId = ethers.id("cancel-after-target-match");
        const releases = await Promise.all(
            h.peers.map((_, index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        const connects = h.peers.map((peer) =>
            peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                autoOpen: true
            })
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
                await h.peers[0].p2pInstance.p2pSigner.cancelConnectToChannel(
                    channelId
                )
            ).to.equal(false);
            await Promise.all(releases.map((release) => release()));
            expect(await Promise.all(connects)).to.deep.equal([true, true]);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("targeted connect starts fixed-ID negotiation from the returned match", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const target = ethers.id("fixed-id-negotiation-owner");
        const releases = await Promise.all(
            h.peers.map((_, index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        const connects = h.peers.map((peer) =>
            peer.p2pInstance.p2pSigner.connectToChannel(target, {
                autoOpen: true
            })
        );
        try {
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
            expect(
                await Promise.all(
                    h.peers.map((peer) =>
                        h.control(peer).query.getChannelId().request()
                    )
                )
            ).to.deep.equal([target, target]);
            await Promise.all(releases.map((release) => release()));
            expect(await Promise.all(connects)).to.deep.equal([true, true]);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("targeted cancellation and leaveLobby do not cross-cancel", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;
        const channelId = ethers.id("target-cancel-isolation");
        const connect = signer.connectToChannel(channelId, {
            autoOpen: true
        });
        await waitFor(async () => {
            const availability = await h
                .control(h.peers[0])
                .query.getLobbyAvailability()
                .request();
            return availability.matching;
        });

        expect(await signer.leaveLobby(ethers.id("ordinary-topic"))).to.equal(
            false
        );
        expect(
            await signer.cancelConnectToChannel(ethers.id("wrong-channel"))
        ).to.equal(false);
        expect(await signer.cancelConnectToChannel(channelId)).to.equal(true);
        expect(await connect).to.equal(false);
    });

    it("manifest-loaded custom RPC filter rejects an authenticated peer before matching", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            customRpcManifest: {
                module: `${__dirname}/../fixtures/customRpc/RejectAllLobbyRpcManifest.ts`,
                exportName: "RejectAllLobbyRpc"
            }
        });
        const channelId = ethers.id("manifest-filtered-target");
        const results = await Promise.all(
            h.peers.map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                    autoOpen: true,
                    timeoutMs: 150
                })
            )
        );

        expect(results).to.deep.equal([false, false]);
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).query.getNegotiationAttempt().request()
                )
            )
        ).to.deep.equal([null, null]);
    });
});

describe("discovery runtime port", function () {
    it("internal leave route completes without disposing the host runtime", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const peer = h.peers[0];
        expect(
            "setChannelId" in
                (peer.p2pInstance.p2pSigner as unknown as Record<
                    string,
                    unknown
                >)
        ).to.equal(false);
        expect(
            await peer.p2pInstance.p2pSigner.connectToChannel(
                ethers.id("internal-leave-route")
            )
        ).to.equal(false);

        await peer.p2pInstance.p2pSigner.leaveChannel();

        expect(await peer.p2pInstance.p2pSigner.getChannelStatus()).to.equal(
            Status.NOT_OPENED
        );
    });

    it("public leave immediately disposes an attached NOT_OPENED runtime", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const peer = h.peers[0];
        let leaveTurnCount = 0;
        peer.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            leaveTurnCount += 1;
        });
        expect(
            await peer.p2pInstance.p2pSigner.connectToChannel(
                ethers.id("not-opened-public-leave")
            )
        ).to.equal(false);
        expect(
            await h.control(peer).query.getLeaveChannelWatchdogMs().request()
        ).to.equal(15_000);

        await peer.p2pInstance.leaveChannel();

        expect(leaveTurnCount).to.equal(0);
        await expect(
            peer.p2pInstance.p2pSigner.getChannelStatus()
        ).to.be.rejectedWith("disposed");
    });

    it("public leave immediately disposes a synced observer runtime", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const channelId = ethers.id("synced-observer-public-leave");
        await Promise.all(
            h.peers.slice(0, 2).map((peer) =>
                peer.p2pInstance.p2pSigner.connectToChannel(channelId, {
                    autoOpen: true
                })
            )
        );
        const observer = h.peers[2];
        expect(
            await observer.p2pInstance.p2pSigner.connectToChannel(channelId)
        ).to.equal(true);
        expect(await h.control(observer).query.getStatus().request()).to.equal(
            Status.SYNCED
        );

        await observer.p2pInstance.leaveChannel();

        await expect(
            observer.p2pInstance.p2pSigner.getChannelStatus()
        ).to.be.rejectedWith("disposed");
    });

    it("participating public leave emits leave turn, settles removal, and disposes once", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const leaver = h.peers[1];
        let leaveTurnCount = 0;
        let leaverNormalTurnCount = 0;
        let otherPeerTurnCount = 0;
        let exitPromise: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            leaveTurnCount += 1;
            exitPromise = leaver.p2pInstance.p2pContractInstance.leaveChannel();
        });
        leaver.p2pInstance.events.on("p2pEventHooks", "onTurn", (address) => {
            if (address === leaver.address) leaverNormalTurnCount += 1;
        });
        h.peers[0].p2pInstance.events.on("p2pEventHooks", "onTurn", () => {
            otherPeerTurnCount += 1;
        });

        const firstLeave = leaver.p2pInstance.leaveChannel();
        const secondLeave = leaver.p2pInstance.leaveChannel();
        expect(firstLeave === secondLeave).to.equal(true);
        await waitFor(async () => {
            const state = await h
                .control(leaver)
                .query.getLeaveChannelState()
                .request();
            return state?.phase === "awaiting-exit";
        });
        expect(await h.control(leaver).query.getForceExit().request()).to.equal(
            true
        );
        expect(
            (await h.control(leaver).query.getLeaveChannelState().request())
                ?.participantCount
        ).to.equal(3);
        await expect(
            leaver.p2pInstance.p2pSigner.connectToChannel(h.channelId)
        ).to.be.rejectedWith("terminal channel leave is pending");

        await h.transition.advanceState();
        await waitFor(() => exitPromise !== undefined);
        await exitPromise;
        await firstLeave;

        expect(leaveTurnCount).to.equal(1);
        expect(leaverNormalTurnCount).to.equal(0);
        expect(otherPeerTurnCount > 0).to.equal(true);
        expect(
            (await h.channelManager.getParticipants(h.channelId)).includes(
                leaver.address
            )
        ).to.equal(false);
        await expect(
            leaver.p2pInstance.p2pSigner.getChannelStatus()
        ).to.be.rejectedWith("disposed");
    });

    it("outer disposal failure rejects leave after the settled runtime becomes terminal", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const leaver = h.peers[1];
        let exitPromise: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            exitPromise = leaver.p2pInstance.p2pContractInstance.leaveChannel();
        });
        const originalDispose = leaver.p2pInstance.dispose.bind(
            leaver.p2pInstance
        );
        leaver.p2pInstance.dispose = async () => {
            await originalDispose();
            throw new Error("injected outer disposal failure");
        };

        const leave = leaver.p2pInstance.leaveChannel();
        await h.transition.advanceState();
        await waitFor(() => exitPromise !== undefined);
        await exitPromise;
        await expect(leave).to.be.rejectedWith(
            "injected outer disposal failure"
        );
        expect(
            (await h.channelManager.getParticipants(h.channelId)).includes(
                leaver.address
            )
        ).to.equal(false);
        await expect(
            leaver.p2pInstance.p2pSigner.getChannelStatus()
        ).to.be.rejectedWith("disposed");
    });

    it("failed fast snapshot post falls back to a settled self-removal dispute", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0, {
            timeConfig: { evidenceTime: 20 }
        });
        const leaver = h.peers[1];
        const originalForkId = h.activeForkId!;
        const recorder = await h.rpcStub.recordDisputeSubmissions(leaver.index);
        await h.control(leaver).stub.failPostStateSnapshotWait().request();
        let exitPromise: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            exitPromise = leaver.p2pInstance.p2pContractInstance.leaveChannel();
        });

        const leaveStartedAt = Date.now();
        const leave = leaver.p2pInstance.leaveChannel();
        await h.transition.advanceState();
        await waitFor(() => exitPromise !== undefined);
        await exitPromise;
        await waitFor(
            async () => (await recorder.submissions()).length === 1,
            h.event.protocolEventTimeoutMs()
        );

        const submissions = await recorder.submissions();
        expect(
            Codec.decode(submissions[0].encodedDispute, Type.Dispute).input
                .selfRemoval
        ).to.equal(true);
        await recorder.restore();
        await h.control(leaver).stub.restorePostStateSnapshotWait().request();
        await h.assert.dispute.committedWait({
            peersIndices: [0, 2],
            expectedCount: 1
        });
        await h.dispute.resolveDisputeWait({
            forkId: originalForkId,
            honestPeerIndices: [0, 2],
            assertMaliciousRemoved: false
        });
        const leaveOutcome = await Promise.race([
            leave.then(() => ({ kind: "resolved" as const })),
            sleep(45_000).then(() => ({ kind: "pending" as const }))
        ]);
        expect(leaveOutcome).to.deep.equal({ kind: "resolved" });
        expect(Date.now() - leaveStartedAt).to.be.greaterThan(30_000);

        expect(
            (await h.channelManager.getParticipants(h.channelId)).includes(
                leaver.address
            )
        ).to.equal(false);
        await expect(
            leaver.p2pInstance.p2pSigner.getChannelStatus()
        ).to.be.rejectedWith("disposed");
    });

    it("leave watchdog starts a dispute carrying self-removal with no new blocks", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0, {
            configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 50 }
        });
        const leaver = h.peers[1];
        const recorder = await h.rpcStub.recordDisputeSubmissions(leaver.index);
        const pendingLeave = leaver.p2pInstance.p2pSigner.leaveChannel();
        void pendingLeave.catch(() => undefined);

        await waitFor(async () => (await recorder.submissions()).length === 1);

        const submissions = await recorder.submissions();
        expect(submissions).to.have.length(1);
        expect(
            Codec.decode(submissions[0].encodedDispute, Type.Dispute).input
                .selfRemoval
        ).to.equal(true);
        expect(
            (await h.control(leaver).query.getLeaveChannelState().request())
                ?.ingestedBlockCount
        ).to.equal(0);
        await leaver.p2pInstance.dispose();
        await expect(pendingLeave).to.be.rejectedWith("disposed");
    });

    it("fixed N plus one block bound starts the same self-removal dispute", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0, {
            configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 60_000 }
        });
        const leaver = h.peers[1];
        const recorder = await h.rpcStub.recordDisputeSubmissions(leaver.index);
        const pendingLeave = leaver.p2pInstance.p2pSigner.leaveChannel();
        void pendingLeave.catch(() => undefined);
        await waitFor(async () => {
            const state = await h
                .control(leaver)
                .query.getLeaveChannelState()
                .request();
            return state?.phase === "awaiting-exit";
        });

        await h.transition.advanceState({ count: 4 });
        await waitFor(async () => (await recorder.submissions()).length === 1);

        const submissions = await recorder.submissions();
        expect(submissions).to.have.length(1);
        expect(
            Codec.decode(submissions[0].encodedDispute, Type.Dispute).input
                .selfRemoval
        ).to.equal(true);
        await leaver.p2pInstance.dispose();
        await expect(pendingLeave).to.be.rejectedWith("disposed");
    });

    it("pending participant keeps one leave operation through promotion and exit", async function () {
        const h = TestSession.getHarness();
        const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
        const joiner = h.getPeer(prepared.joiner.index);
        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            )
        ).to.equal(true);
        let exitPromise: Promise<unknown> | undefined;
        joiner.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            exitPromise = joiner.p2pInstance.p2pContractInstance.leaveChannel();
        });

        const leave = joiner.p2pInstance.leaveChannel();
        await waitFor(async () => {
            const state = await h
                .control(joiner)
                .query.getLeaveChannelState()
                .request();
            return state?.phase === "awaiting-exit";
        });
        expect(
            (await h.control(joiner).query.getLeaveChannelState().request())
                ?.participantCount
        ).to.equal(3);

        await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2, joiner.index]
        });
        await waitFor(() => exitPromise !== undefined);
        await exitPromise;
        await leave;

        expect(
            (await h.channelManager.getParticipants(h.channelId)).includes(
                joiner.address
            )
        ).to.equal(false);
    });

    it("rejects invalid join input before changing lifecycle state", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const signer = h.peers[0].p2pInstance.p2pSigner;

        await expect(signer.joinLobby("0x12")).to.be.rejectedWith(
            "Rendezvous topic must be exactly 32 bytes"
        );
        await expect(
            signer.joinLobby(ethers.id("invalid-lobby-options"), {
                balance: {
                    amount: Number.POSITIVE_INFINITY,
                    data: "0x"
                }
            })
        ).to.be.rejectedWith("Codec.encode failed for Type.Balance");
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
        expect(
            await signer.connectToChannel(ethers.id("targeted-channel"))
        ).to.equal(false);

        await expect(
            signer.joinLobby(ethers.id("blocked-lobby-topic"))
        ).to.be.rejectedWith("no selected channel");
    });

    it("targeted connect leaves an unmatched ordinary lobby to its owner", async function () {
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
        const target = ethers.id("replacement-target-channel");
        expect(await signer.connectToChannel(target)).to.equal(false);
        expect(
            await h.control(peer).query.getLobbyAvailability().request()
        ).to.deep.include({ topic, matching: true });
        expect(await signer.leaveLobby(topic)).to.equal(true);
        expect(await pendingJoin).to.equal(undefined);
        expect(await h.control(peer).query.getChannelId().request()).to.equal(
            target
        );
        expect(await h.control(peer).query.getStatus().request()).to.equal(
            Status.NOT_OPENED
        );
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

    it("joinLobby starts ordinary negotiation from the returned match", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, { autoConnect: false });
        const topic = ethers.id("runtime-port-host-owned-lobby");

        const [first, second] = await Promise.all(
            h.peers.map((peer) =>
                peer.p2pInstance.p2pSigner.joinLobby(topic, {
                    balance: { amount: 321, data: "0x" }
                })
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
