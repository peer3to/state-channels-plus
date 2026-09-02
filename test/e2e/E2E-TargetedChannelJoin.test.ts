import { expect } from "chai";
import { ethers } from "ethers";

import { Status } from "@/types";
import { sleep } from "@/utils";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

const testTime = {
    agreementTime: 4,
    p2pTime: 2,
    chainFallbackTime: 2,
    evidenceTime: 2
};

describe("E2E: Targeted channel join", function () {
    const unopened = async (
        label: string,
        peerCount = 2,
        timeConfig = testTime
    ) => {
        const h = TestSession.getHarness();
        const channelId = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(["string"], [label])
        );
        await h.setup(peerCount, {
            autoConnect: false,
            channelId: label,
            timeConfig
        });
        return {
            h,
            channelId,
            targeted: new TargetedChannelJoinFixture(h)
        };
    };

    const openedWithFreshObservers = async (
        label: string,
        observerCount = 1,
        timeConfig = testTime
    ) => {
        const setup = await unopened(label, 2, timeConfig);
        await setup.h.lifecycle.openChannelForParticipants([0, 1]);
        for (let i = 0; i < observerCount; i++) {
            await setup.targeted.addFreshPeer();
        }
        await setup.h.network.joinSelectedKey([0, 1], setup.channelId);
        return setup;
    };

    const status = async (
        h: ReturnType<typeof TestSession.getHarness>,
        peerIndex: number
    ) => await h.control(h.getPeer(peerIndex)).query.getStatus().request();

    const waitForHeldMatchedNegotiation = async (
        h: ReturnType<typeof TestSession.getHarness>,
        peerIndices: number[]
    ) => {
        await waitFor(async () => {
            const counts = await Promise.all(
                peerIndices.map((index) =>
                    h
                        .control(h.getPeer(index))
                        .stub.getHeldMatchedNegotiationCount()
                        .request()
                )
            );
            return counts.every((count) => count === 1);
        }, 20_000);
    };

    it("unopened target without autoOpen and without balance returns false without discovery", async function () {
        const { h, channelId, targeted } = await unopened("target-no-open");
        expect(await targeted.connect(h.getPeer(0), channelId)).to.equal(false);
        expect(
            await h.control(h.getPeer(0)).query.getLobbyAvailability().request()
        ).to.include({ matching: false });
        expect(await h.query.getConnectionCount(0)).to.equal(0);
    });

    it("rejects a second target without changing the selected channel", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-cross-channel-protection"
        );
        const observer = h.getPeer(2);
        expect(await targeted.connect(observer, channelId)).to.equal(true);
        const before = {
            channelId: await h.control(observer).query.getChannelId().request(),
            status: await status(h, 2),
            connections: await h.query.getConnectionCount(2)
        };

        await expect(
            targeted.connect(observer, ethers.id("different-target"))
        ).to.be.rejectedWith("already owns channel");

        expect({
            channelId: await h.control(observer).query.getChannelId().request(),
            status: await status(h, 2),
            connections: await h.query.getConnectionCount(2)
        }).to.deep.equal(before);
    });

    it("terminal leave settles before a fresh runtime connects another channel", async function () {
        const { h, channelId } = await unopened(
            "target-terminal-leave",
            3
        );
        await h.lifecycle.openChannelForParticipants([0, 1, 2]);
        await h.network.joinSelectedKey([0, 1, 2], channelId);
        const leaver = h.getPeer(1);
        let exit: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on(
            "p2pEventHooks",
            "onLeaveTurn",
            () => {
                exit = leaver.p2pInstance.p2pContractInstance.leaveChannel();
            }
        );
        const leave = leaver.p2pInstance.leaveChannel();
        await h.transition.advanceState();
        await waitFor(() => exit !== undefined);
        await exit;
        await leave;
        expect(
            (await h.channelManager.getParticipants(channelId)).includes(
                leaver.address
            )
        ).to.equal(false);

        const freshFixture = new TargetedChannelJoinFixture(h);
        const freshPeers = [];
        for (let index = 0; index < 3; index += 1) {
            freshPeers.push(await freshFixture.addFreshPeer());
        }
        const nextChannelId = ethers.id("target-after-terminal-leave");
        expect(
            await Promise.all(
                freshPeers.map((peer) =>
                    peer.p2pInstance.p2pSigner.connectToChannel(
                        nextChannelId,
                        { autoOpen: true }
                    )
                )
            )
        ).to.deep.equal([true, true, true]);
        expect(
            await h.control(freshPeers[0]).query.getChannelId().request()
        ).to.equal(nextChannelId);
        await expect(
            leaver.p2pInstance.p2pSigner.getChannelStatus()
        ).to.be.rejectedWith("disposed");
    });

    it("unopened target without autoOpen and with balance returns false without discovery", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-dormant-balance"
        );
        expect(
            await targeted.connect(h.getPeer(0), channelId, {
                balance: { amount: 321n, data: "0x1234" }
            })
        ).to.equal(false);
        expect(await status(h, 0)).to.equal(Status.NOT_OPENED);
        expect(await h.query.getConnectionCount(0)).to.equal(0);
    });

    it("initial observer sync accepts one valid response without probing another peer", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-one-sync",
            1,
            {
                ...testTime,
                chainFallbackTime: 30,
                evidenceTime: 30
            }
        );
        const restore = await h.rpcStub.recordSpectateSync(2, {
            forward: true
        });
        try {
            const result = await targeted.connect(h.getPeer(2), channelId);
            const diagnostic = {
                status: await status(h, 2),
                channelId: await h
                    .control(h.getPeer(2))
                    .query.getChannelId()
                    .request(),
                syncCalls: await h.rpcStub.spectateSyncCallCount(2),
                disposed: await targeted.isDisposed(h.getPeer(2))
            };
            expect(result, JSON.stringify(diagnostic)).to.equal(true);
            expect(await h.rpcStub.spectateSyncCallCount(2)).to.equal(1);
            expect(await status(h, 2)).to.equal(Status.SYNCED);
        } finally {
            await restore();
        }
    });

    it("initial observer sync silence aborts without probing another ready peer", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-sync-silence"
        );
        const restoreRecord = await h.rpcStub.recordSpectateSync(2, {
            forward: true
        });
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
        );
        try {
            expect(await targeted.connect(h.getPeer(2), channelId)).to.equal(
                false
            );
            expect(await h.rpcStub.spectateSyncCallCount(2)).to.equal(1);
            expect(await targeted.isDisposed(h.getPeer(2))).to.equal(true);
        } finally {
            await Promise.all(releases.map((release) => release()));
            await restoreRecord();
        }
    });

    it("initial observer sync disconnect aborts without probing another ready peer", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-sync-disconnect"
        );
        const restore = await h.rpcStub.recordSpectateSync(2, {
            forward: true
        });
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
        );
        const connect = targeted.connect(h.getPeer(2), channelId);
        try {
            const [selected] = await h.rpcStub.spectateSyncTargetsWait(2, 1);
            const selectedIndex = h.peers.find(
                (peer) => peer.address.toLowerCase() === selected.toLowerCase()
            )!.index;
            await h.network.blacklistAndDisconnectPeer(selectedIndex);
            expect(await connect).to.equal(false);
            expect(await h.rpcStub.spectateSyncCallCount(2)).to.equal(1);
            expect(await targeted.isDisposed(h.getPeer(2))).to.equal(true);
        } finally {
            await Promise.all(releases.map((release) => release()));
            await restore();
        }
    });

    it("initial observer sync timeout aborts without probing another ready peer", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-sync-timeout"
        );
        const restore = await h.rpcStub.recordSpectateSync(2, {
            forward: true
        });
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
        );
        try {
            expect(await targeted.connect(h.getPeer(2), channelId)).to.equal(
                false
            );
            expect(await h.rpcStub.spectateSyncCallCount(2)).to.equal(1);
            expect(await targeted.isDisposed(h.getPeer(2))).to.equal(true);
        } finally {
            await Promise.all(releases.map((release) => release()));
            await restore();
        }
    });

    it("initial observer sync invalid response aborts without probing another ready peer", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-sync-invalid"
        );
        const restoreRecord = await h.rpcStub.recordSpectateSync(2, {
            forward: true
        });
        const restoreJunk = await h.rpcStub.stubSpectateJunkPayload([0, 1]);
        try {
            expect(await targeted.connect(h.getPeer(2), channelId)).to.equal(
                false
            );
            expect(await h.rpcStub.spectateSyncCallCount(2)).to.equal(1);
            expect(await targeted.isDisposed(h.getPeer(2))).to.equal(true);
        } finally {
            await restoreJunk();
            await restoreRecord();
        }
    });

    it("already-open join preserves a supplied full balance and internal deadline", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-full-balance"
        );
        expect(
            await targeted.connect(h.getPeer(2), channelId, {
                shouldJoin: true,
                balance: { amount: 321n, data: "0x1234" }
            })
        ).to.equal(true);
        expect([Status.PENDING_PARTICIPANT, Status.PARTICIPATING]).to.include(
            await status(h, 2)
        );
    });

    it("already-open join uses the default balance and internal deadline", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-default-balance"
        );
        expect(
            await targeted.connect(h.getPeer(2), channelId, {
                shouldJoin: true
            })
        ).to.equal(true);
        expect([Status.PENDING_PARTICIPANT, Status.PARTICIPATING]).to.include(
            await status(h, 2)
        );
    });

    it("four targeted callers converge on one opened channel", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-four-callers",
            4
        );
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    targeted.connect(peer, channelId, { autoOpen: true })
                )
            )
        ).to.deep.equal([true, true, true, true]);
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).query.getChannelId().request()
                )
            )
        ).to.deep.equal([channelId, channelId, channelId, channelId]);
    });

    it("target open at the post-match recheck skips negotiation initialization", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-post-match-open",
            4
        );
        const refreshReleases = await Promise.all(
            [2, 3].map((index) => h.rpcStub.holdPostMatchTargetRefresh(index))
        );
        const negotiationReleases = await Promise.all(
            [2, 3].map((index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        const connects = [2, 3].map((index) =>
            targeted.connect(h.getPeer(index), channelId, { autoOpen: true })
        );
        try {
            await waitFor(async () => {
                const counts = await Promise.all(
                    [2, 3].map((index) =>
                        h
                            .control(h.getPeer(index))
                            .stub.getHeldPostMatchTargetRefreshCount()
                            .request()
                    )
                );
                return counts.every((count) => count === 1);
            });
            const opening = h.lifecycle.openChannelForParticipants([0, 1]);
            await waitFor(
                () =>
                    h
                        .control(h.getPeer(0))
                        .query.isChannelOpen(channelId)
                        .request(),
                h.event.protocolEventTimeoutMs()
            );
            await h.network.joinSelectedKey([0, 1], channelId);
            await Promise.all(refreshReleases.map((release) => release()));
            await opening;
            expect(await Promise.all(connects)).to.deep.equal([true, true]);
            expect(
                await Promise.all(
                    [2, 3].map((index) =>
                        h
                            .control(h.getPeer(index))
                            .stub.getHeldMatchedNegotiationCount()
                            .request()
                    )
                )
            ).to.deep.equal([0, 0]);
        } finally {
            await Promise.all(refreshReleases.map((release) => release()));
            await Promise.all(negotiationReleases.map((release) => release()));
        }
    });

    it("targeted observed-open handoff syncs only from the selected channel", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-observed-open-sync"
        );
        const restore = await h.rpcStub.recordSpectateSync(2, {
            forward: true
        });
        try {
            expect(
                await targeted.connect(h.getPeer(2), channelId, {
                    autoOpen: true
                })
            ).to.equal(true);
            const [source] = await h.rpcStub.spectateSyncTargetsWait(2, 1);
            expect(
                h.peers.slice(0, 2).map((peer) => peer.address.toLowerCase())
            ).to.include(source.toLowerCase());
            expect(await status(h, 2)).to.equal(Status.SYNCED);
        } finally {
            await restore();
        }
    });

    it("targeted observed-open participation waits for selected-channel sync", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-observed-open-join"
        );
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
        );
        let settled = false;
        const connect = targeted
            .connect(h.getPeer(2), channelId, { shouldJoin: true })
            .then((result) => {
                settled = true;
                return result;
            });
        try {
            await waitFor(async () =>
                (
                    await Promise.all(
                        [0, 1].map((index) =>
                            h
                                .control(h.getPeer(index))
                                .stub.getHeldSpectateResponseCount()
                                .request()
                        )
                    )
                ).some((count) => count === 1)
            );
            expect(settled).to.equal(false);
            await Promise.all(releases.map((release) => release()));
            expect(await connect).to.equal(true);
            expect([
                Status.PENDING_PARTICIPANT,
                Status.PARTICIPATING
            ]).to.include(await status(h, 2));
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("targeted observed-open participant failure aborts without retry", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-observed-open-failure"
        );
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
        );
        try {
            expect(
                await targeted.connect(h.getPeer(2), channelId, {
                    autoOpen: true
                })
            ).to.equal(false);
            expect(await targeted.isDisposed(h.getPeer(2))).to.equal(true);
            expect(
                await targeted.connect(h.getPeer(2), channelId, {
                    autoOpen: true
                })
            ).to.equal(false);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("matchmaking timeout stops only an unmatched rendezvous", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-match-timeout"
        );
        expect(
            await targeted.connect(h.getPeer(0), channelId, {
                autoOpen: true,
                timeoutMs: 40
            })
        ).to.equal(false);
        expect(await targeted.isDisposed(h.getPeer(0))).to.equal(false);
        expect(
            await h.control(h.getPeer(0)).query.getChannelId().request()
        ).to.equal(channelId);
    });

    it("accepted match is irrevocable past matchmaking timeout", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-irrevocable-match"
        );
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        const connects = [0, 1].map((index) =>
            targeted.connect(h.getPeer(index), channelId, {
                autoOpen: true,
                timeoutMs: 3_000
            })
        );
        try {
            await waitForHeldMatchedNegotiation(h, [0, 1]);
            await sleep(3_100);
            expect(
                await h
                    .getPeer(0)
                    .p2pInstance.p2pSigner.cancelConnectToChannel(channelId)
            ).to.equal(false);
            await Promise.all(releases.map((release) => release()));
            expect(await Promise.all(connects)).to.deep.equal([true, true]);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("already-open discovery ignores finite and null matchmaking timeouts", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-open-timeout-options",
            2
        );
        expect(
            await Promise.all([
                targeted.connect(h.getPeer(2), channelId, { timeoutMs: 20 }),
                targeted.connect(h.getPeer(3), channelId, { timeoutMs: null })
            ])
        ).to.deep.equal([true, true]);
        expect(await status(h, 2)).to.equal(Status.SYNCED);
        expect(await status(h, 3)).to.equal(Status.SYNCED);
    });

    it("finite matchmaking timeout does not settle a first-join receipt", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-join-receipt-timeout"
        );
        const release = await h.rpcStub.holdMembershipReceipt(2, "joinChannel");
        let settled = false;
        const connect = targeted
            .connect(h.getPeer(2), channelId, {
                shouldJoin: true,
                timeoutMs: 30
            })
            .then((result) => {
                settled = true;
                return result;
            });
        try {
            await waitFor(
                async () =>
                    (await h
                        .control(h.getPeer(2))
                        .stub.getHeldMembershipReceiptCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs(),
                200
            );
            await sleep(50);
            expect(settled).to.equal(false);
            await release();
            expect(await connect).to.equal(true);
        } finally {
            await release();
        }
    });

    it("finite matchmaking timeout does not settle a top-up receipt", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-topup-receipt-timeout"
        );
        expect(
            await targeted.connect(h.getPeer(2), channelId, {
                shouldJoin: true
            })
        ).to.equal(true);
        const release = await h.rpcStub.holdMembershipReceipt(
            2,
            "topUpBalance"
        );
        let settled = false;
        const topUp = targeted
            .connect(h.getPeer(2), channelId, {
                shouldJoin: true,
                balance: { amount: 9n, data: "0xbeef" },
                timeoutMs: 30
            })
            .then((result) => {
                settled = true;
                return result;
            });
        try {
            await waitFor(
                async () =>
                    (await h
                        .control(h.getPeer(2))
                        .stub.getHeldMembershipReceiptCount()
                        .request()) === 1
            );
            await sleep(50);
            expect(settled).to.equal(false);
            await release();
            expect(await topUp).to.equal(true);
        } finally {
            await release();
        }
    });

    it("pre-sync refusal returns false without starting sync", async function () {
        const { h, channelId, targeted } = await unopened("target-refusal");
        const restore = await h.rpcStub.recordSpectateSync(0, {
            forward: true
        });
        const releases = await Promise.all(
            [0, 1].map((index) =>
                h.rpcStub.holdNegotiationReply(index, "exchangeTerms")
            )
        );
        try {
            expect(
                await Promise.all(
                    [0, 1].map((index) =>
                        targeted.connect(h.getPeer(index), channelId, {
                            autoOpen: true
                        })
                    )
                )
            ).to.deep.equal([false, false]);
            expect(await h.rpcStub.spectateSyncCallCount(0)).to.equal(0);
        } finally {
            await Promise.all(releases.map((release) => release()));
            await restore();
        }
    });

    it("matching cancellation settles false only before acceptance", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-cancel-boundary"
        );
        const connect = targeted.connect(h.getPeer(0), channelId, {
            autoOpen: true
        });
        await waitFor(async () =>
            Boolean(
                (
                    await h
                        .control(h.getPeer(0))
                        .query.getLobbyAvailability()
                        .request()
                ).matching
            )
        );
        expect(
            await h
                .getPeer(0)
                .p2pInstance.p2pSigner.cancelConnectToChannel(channelId)
        ).to.equal(true);
        expect(await connect).to.equal(false);

        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdMatchedNegotiation(index))
        );
        const accepted = [0, 1].map((index) =>
            targeted.connect(h.getPeer(index), channelId, { autoOpen: true })
        );
        try {
            await waitForHeldMatchedNegotiation(h, [0, 1]);
            expect(
                await h
                    .getPeer(0)
                    .p2pInstance.p2pSigner.cancelConnectToChannel(channelId)
            ).to.equal(false);
            await Promise.all(releases.map((release) => release()));
            expect(await Promise.all(accepted)).to.deep.equal([true, true]);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("preserves the target listener after unsigned targeted negotiation failure", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-listener-retention"
        );
        const releases = await Promise.all(
            [0, 1].map((index) =>
                h.rpcStub.holdNegotiationReply(index, "exchangeTerms")
            )
        );
        try {
            expect(
                await Promise.all(
                    [0, 1].map((index) =>
                        targeted.connect(h.getPeer(index), channelId, {
                            autoOpen: true
                        })
                    )
                )
            ).to.deep.equal([false, false]);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
        await h.lifecycle.openChannelForParticipants([0, 1]);
        expect(await status(h, 0)).not.to.equal(Status.NOT_OPENED);
        expect(
            await h.control(h.getPeer(0)).query.getChannelId().request()
        ).to.equal(channelId);
    });

    it("starts a fresh same-ID targeted attempt only after another explicit call", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-explicit-retry"
        );
        await Promise.all(
            [0, 1].map((index) => h.rpcStub.failNextMatchedNegotiation(index))
        );
        expect(
            await Promise.all(
                [0, 1].map((index) =>
                    targeted.connect(h.getPeer(index), channelId, {
                        autoOpen: true
                    })
                )
            )
        ).to.deep.equal([false, false]);
        await targeted.addFreshPeer();
        expect(
            await Promise.all(
                [0, 2].map((index) =>
                    targeted.connect(h.getPeer(index), channelId, {
                        autoOpen: true
                    })
                )
            )
        ).to.deep.equal([true, true]);
    });

    it("initial sync accepts a response in the second agreement window", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-deferred-readiness"
        );
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
        );
        let settled = false;
        const connect = targeted
            .connect(h.getPeer(2), channelId)
            .finally(() => {
                settled = true;
            });
        try {
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            [0, 1].map((index) =>
                                h
                                    .control(h.getPeer(index))
                                    .stub.getHeldSpectateResponseCount()
                                    .request()
                            )
                        )
                    ).reduce((sum, count) => sum + count, 0) === 1,
                h.event.protocolEventTimeoutMs()
            );
            await sleep(testTime.agreementTime * 1_050);
            expect(settled).to.equal(false);
            await Promise.all(releases.map((release) => release()));
            expect(await connect).to.equal(true);
            expect(await status(h, 2)).to.equal(Status.SYNCED);
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("initial requester expiry aborts and disposes without retry", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-requester-expiry"
        );
        const releases = await Promise.all(
            [0, 1].map((index) => h.rpcStub.holdSpectateResponses(index))
        );
        const sentAt = Date.now();
        const connect = targeted.connect(h.getPeer(2), channelId);
        try {
            await waitFor(
                async () =>
                    (
                        await Promise.all(
                            [0, 1].map((index) =>
                                h
                                    .control(h.getPeer(index))
                                    .stub.getHeldSpectateResponseCount()
                                    .request()
                            )
                        )
                    ).reduce((sum, count) => sum + count, 0) === 1,
                h.event.protocolEventTimeoutMs()
            );
            expect(await connect).to.equal(false);
            expect(Date.now() - sentAt).to.be.at.least(
                testTime.agreementTime * 2 * 1000
            );
            expect(await targeted.isDisposed(h.getPeer(2))).to.equal(true);
            expect(await targeted.connect(h.getPeer(2), channelId)).to.equal(
                false
            );
        } finally {
            await Promise.all(releases.map((release) => release()));
        }
    });

    it("accepted pending join result does not wait for later inclusion", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-pending-result"
        );
        expect(
            await targeted.connect(h.getPeer(2), channelId, {
                shouldJoin: true
            })
        ).to.equal(true);
        expect(await status(h, 2)).to.equal(Status.PENDING_PARTICIPANT);
    });

    it("pending runtime survives later operational failure", async function () {
        const { h, channelId, targeted } = await openedWithFreshObservers(
            "target-pending-preserved"
        );
        expect(
            await targeted.connect(h.getPeer(2), channelId, {
                shouldJoin: true
            })
        ).to.equal(true);
        await h.execOnHost(
            h.getPeer(2),
            async (sm, args: { offender: string }) => {
                await sm.p2pManager.localRpc.spectateService.sync(
                    args.offender,
                    sm.channelId
                );
            },
            { offender: ethers.Wallet.createRandom().address }
        );
        expect(await targeted.isDisposed(h.getPeer(2))).to.equal(false);
        expect(await status(h, 2)).to.equal(Status.PENDING_PARTICIPANT);
    });

    it("participating runtime survives later operational failure", async function () {
        const { h, channelId, targeted } = await unopened(
            "target-participant-preserved"
        );
        expect(
            await Promise.all(
                [0, 1].map((index) =>
                    targeted.connect(h.getPeer(index), channelId, {
                        autoOpen: true,
                        shouldJoin: true
                    })
                )
            )
        ).to.deep.equal([true, true]);
        await h.execOnHost(
            h.getPeer(0),
            async (sm, args: { offender: string }) => {
                await sm.p2pManager.localRpc.spectateService.sync(
                    args.offender,
                    sm.channelId
                );
            },
            { offender: ethers.Wallet.createRandom().address }
        );
        expect(await targeted.isDisposed(h.getPeer(0))).to.equal(false);
        expect(await status(h, 0)).to.equal(Status.PARTICIPATING);
    });

    it("preserves the successful matched-opening transport for the first channel sync", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            customRpcManifest: {
                module: `${__dirname}/../fixtures/customRpc/PingPongRpcManifest.ts`,
                exportName: "PingPongRpc"
            }
        });
        const control = h.control(
            h.getPeer(0)
        ) as unknown as RemoteRpcProxyType<PingPongRpc>;
        const probe = await control.p2pManagerProbe
            .probeLobbyProtocol()
            .request();
        expect(probe.selectedTransportHeldBeforeCompletion).to.equal(true);
        expect(probe.selectedTransportPromotedAfterCompletion).to.equal(true);
        expect(probe.ordinaryHookCountAfterCompletion).to.equal(1);
    });

    it("manifest-loaded local policy blocks targeted matching without a worker policy payload", async function () {
        const h = TestSession.getHarness();
        const channelId = ethers.id("target-manifest-policy");
        await h.setup(2, {
            autoConnect: false,
            channelId,
            timeConfig: testTime,
            customRpcManifest: {
                module: `${__dirname}/../fixtures/customRpc/RejectAllLobbyRpcManifest.ts`,
                exportName: "RejectAllLobbyRpc"
            }
        });
        const targeted = new TargetedChannelJoinFixture(h);
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    targeted.connect(peer, channelId, {
                        autoOpen: true,
                        timeoutMs: 100
                    })
                )
            )
        ).to.deep.equal([false, false]);
        expect(
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).query.getNegotiationAttempt().request()
                )
            )
        ).to.deep.equal([null, null]);
    });
});
