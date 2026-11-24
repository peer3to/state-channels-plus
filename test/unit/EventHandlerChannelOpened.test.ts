import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

// the chain stores only the signed genesis hash; every runtime rebuilds the
// genesis from the genesis JOIN block and the opening data in
// EventHandler.onChannelOpened and installs it only when the hashes match

describe("Unit: EventHandler.onChannelOpened genesis rebuild", function () {
    it("installs the genesis it rebuilds from the genesis join block and the opening data", async function () {
        const h = TestSession.getHarness();
        const observer = 2;
        await h.setup(3, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-install"
        });

        await h.lifecycle.openChannelForParticipants([0, 1]);

        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        const query = h.control(h.getPeer(observer)).query;
        expect(await query.getForkId().request()).to.equal(snapshot.forkId);
        expect(await query.getLiveStateMachineStateHash().request()).to.equal(
            snapshot.snapshotData.stateMachineStateHash
        );
        expect(
            await query.getGenesisSnapshotHash(snapshot.forkId).request()
        ).to.not.equal(null);
        expect(h.event.getEventCallCount(observer, "onChannelOpened")).to.equal(
            1
        );
    });

    it("recovers a genesis join block it never received and installs", async function () {
        const h = TestSession.getHarness();
        await h.setup(2, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-recovery"
        });
        await h.lifecycle.openChannelForParticipants([0, 1]);
        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        const genesisJoinBlockHash =
            snapshot.snapshotData.latestInboundMessageBlockHash;
        // selects the channel only after it opened: it saw neither open log
        const observerIndex = h.peers.length;
        await h.createPeer(
            observerIndex,
            h.signerFor(slotAccountIndex(observerIndex))
        );
        const control = h.control(h.getPeer(observerIndex));
        await control.lifecycle.stageChannelId(String(h.channelId)).request();
        // premise - the genesis join block is not stored
        expect(
            await control.query
                .getInboundMessageBlock(genesisJoinBlockHash)
                .request()
        ).to.equal(null);

        expect(
            await h.lifecycle.applyChannelOpenedEvent(observerIndex)
        ).to.equal(true);

        expect(
            await control.query
                .getInboundMessageBlock(genesisJoinBlockHash)
                .request()
        ).to.not.equal(null);
        expect(await control.query.getForkId().request()).to.equal(
            snapshot.forkId
        );
        expect(
            await control.query.getLiveStateMachineStateHash().request()
        ).to.equal(snapshot.snapshotData.stateMachineStateHash);
    });

    it("waits for the open's genesis join log in flight instead of recovering it from the chain", async function () {
        const h = TestSession.getHarness();
        const lagging = 1;
        await h.setup(2, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-in-flight"
        });
        const ctl = h.control(h.getPeer(lagging));
        await ctl.stub.stubCountChainLogQueries().request();
        // the genesis join log's dispatch stays pending while ChannelOpened arrives
        const held = await h.rpcStub.holdInboundMessageEvents(lagging, {
            inFlight: true
        });

        await h.lifecycle.openChannelForParticipants([0, 1], {
            observePeerIndices: [0]
        });
        await waitFor(
            async () => (await held.heldCount()) > 0,
            h.event.protocolEventTimeoutMs()
        );
        // premise - the open's logs reached the lagging peer, nothing installed
        expect(h.event.getEventCallCount(lagging, "onChannelOpened")).to.equal(
            0
        );
        await held.release();

        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        await waitFor(
            () => h.event.getEventCallCount(lagging, "onChannelOpened") === 1,
            h.event.protocolEventTimeoutMs()
        );
        expect(await ctl.query.getForkId().request()).to.equal(snapshot.forkId);
        expect(
            await ctl.query.getLiveStateMachineStateHash().request()
        ).to.equal(snapshot.snapshotData.stateMachineStateHash);
        // the join block came from the held dispatch, not a chain query
        expect(await ctl.stub.getChainLogQueryCount().request()).to.equal(0);
        await ctl.stub.restoreChainLogQueries().request();
    });

    it("fails the open without aborting when the genesis join block stays unavailable", async function () {
        const h = TestSession.getHarness();
        const lagging = 2;
        await h.setup(3, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-unavailable"
        });
        // the handler swallows the genesis join log, so neither the live
        // dispatch nor a recovery query stores it
        const held = await h.rpcStub.holdInboundMessageEvents(lagging);

        await h.lifecycle.openChannelForParticipants([0, 1, 2], {
            observePeerIndices: [0, 1]
        });
        await TestSession.settleDetached({
            expectedErrorIncludes: "genesis join block unavailable"
        });

        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        for (const index of [0, 1]) {
            expect(
                await h.control(h.getPeer(index)).query.getForkId().request(),
                `peer ${index} installed the genesis`
            ).to.equal(snapshot.forkId);
        }
        expect(h.event.getEventCallCount(lagging, "onAbort")).to.equal(0);
        expect(runtimeIsClosed(h.getPeer(lagging).p2pInstance)).to.equal(false);
        expect(h.event.getEventCallCount(lagging, "onChannelOpened")).to.equal(
            0
        );
        expect(h.event.getEventCallCount(lagging, "onSetState")).to.equal(0);
        await held.release({ replay: false });
    });

    it("fails the open without aborting a listed participant whose genesis hook read fails without revert data", async function () {
        const h = TestSession.getHarness();
        const failing = 2;
        await h.setup(3, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-read-failure"
        });
        const ctl = h.control(h.getPeer(failing));
        // only the hook read fails, as a node's error answer: a call
        // exception without revert data
        await ctl.stub
            .stubFailManagerRead(
                "openChannelGenesis",
                "genesis read node error",
                "nodeError"
            )
            .request();

        await h.lifecycle.openChannelForParticipants([0, 1, failing], {
            observePeerIndices: [0, 1]
        });
        await TestSession.settleDetached({
            expectedErrorIncludes: "genesis read node error"
        });

        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        for (const index of [0, 1]) {
            expect(
                await h.control(h.getPeer(index)).query.getForkId().request(),
                `peer ${index} installed the genesis`
            ).to.equal(snapshot.forkId);
        }
        expect(h.event.getEventCallCount(failing, "onAbort")).to.equal(0);
        expect(runtimeIsClosed(h.getPeer(failing).p2pInstance)).to.equal(false);
        expect(h.event.getEventCallCount(failing, "onChannelOpened")).to.equal(
            0
        );
        expect(h.event.getEventCallCount(failing, "onSetState")).to.equal(0);
        await ctl.stub.restoreManagerRead().request();
    });

    it("fails the open without aborting a listed participant whose genesis hook read fails in transport", async function () {
        const h = TestSession.getHarness();
        const failing = 2;
        await h.setup(3, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-transport-failure"
        });
        const ctl = h.control(h.getPeer(failing));
        // only the hook read fails, and not with a call exception
        await ctl.stub
            .stubFailManagerRead(
                "openChannelGenesis",
                "genesis read transport down",
                "transport"
            )
            .request();

        await h.lifecycle.openChannelForParticipants([0, 1, failing], {
            observePeerIndices: [0, 1]
        });
        await TestSession.settleDetached({
            expectedErrorIncludes: "genesis read transport down"
        });

        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        for (const index of [0, 1]) {
            expect(
                await h.control(h.getPeer(index)).query.getForkId().request(),
                `peer ${index} installed the genesis`
            ).to.equal(snapshot.forkId);
        }
        expect(h.event.getEventCallCount(failing, "onAbort")).to.equal(0);
        expect(runtimeIsClosed(h.getPeer(failing).p2pInstance)).to.equal(false);
        expect(h.event.getEventCallCount(failing, "onChannelOpened")).to.equal(
            0
        );
        expect(h.event.getEventCallCount(failing, "onSetState")).to.equal(0);
        await ctl.stub.restoreManagerRead().request();
    });

    it("aborts a listed participant whose genesis hook reverts while the others install", async function () {
        const h = TestSession.getHarness();
        const failing = 2;
        await h.setup(3, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-hook-revert"
        });
        // only this participant's hook read reverts
        await h
            .control(h.getPeer(failing))
            .stub.stubFailManagerRead(
                "openChannelGenesis",
                "genesis hook revert",
                "revert"
            )
            .request();

        await h.lifecycle.openChannelForParticipants([0, 1, failing], {
            observePeerIndices: [0, 1]
        });
        await waitFor(
            () => h.event.getEventCallCount(failing, "onAbort") === 1,
            h.event.protocolEventTimeoutMs()
        );
        await waitFor(
            () => runtimeIsClosed(h.getPeer(failing).p2pInstance),
            h.event.protocolEventTimeoutMs() * 2
        );
        await TestSession.settleDetached({
            expectedErrorIncludes: "Opened genesis rejected: hook reverted"
        });

        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        for (const index of [0, 1]) {
            expect(
                await h.control(h.getPeer(index)).query.getForkId().request(),
                `peer ${index} installed the genesis`
            ).to.equal(snapshot.forkId);
        }
        expect(h.event.getEventCallCount(failing, "onChannelOpened")).to.equal(
            0
        );
        expect(h.event.getEventCallCount(failing, "onSetState")).to.equal(0);
    });

    it("aborts the listed participants and spares any other runtime when the opened hash matches no genesis", async function () {
        const h = TestSession.getHarness();
        const outsider = 2;
        await h.setup(3, {
            autoConnect: false,
            channelId: "channel-opened-rebuild-mismatch"
        });
        const junkHash = ethers.id("no genesis derives from this");

        const receipt = await h.lifecycle.openChannelWithGenesisHashWait(
            [0, 1],
            junkHash
        );

        expect(receipt?.status).to.equal(1);
        const [isOpen, snapshot] = await h.channelManager.isChannelOpen(
            h.channelId
        );
        expect(isOpen).to.equal(true);
        expect(snapshot.snapshotData.stateMachineStateHash).to.equal(junkHash);
        const participants = [h.getPeer(0), h.getPeer(1)];
        await waitFor(
            () =>
                participants.every(
                    (peer) =>
                        h.event.getEventCallCount(peer.index, "onAbort") === 1
                ),
            h.event.protocolEventTimeoutMs()
        );
        await waitFor(
            () =>
                participants.every((peer) => runtimeIsClosed(peer.p2pInstance)),
            h.event.protocolEventTimeoutMs() * 2
        );
        // the handler throws after the abort, so the log fails on each participant
        await TestSession.settleDetached({
            expectedErrorIncludes: "Opened genesis rejected: hash mismatch"
        });
        for (const peer of participants) {
            expect(
                h.event.getEventCallCount(peer.index, "onChannelOpened"),
                `peer ${peer.index} completed the open`
            ).to.equal(0);
            expect(
                h.event.getEventCallCount(peer.index, "onSetState"),
                `peer ${peer.index} installed a state`
            ).to.equal(0);
        }
        // a runtime outside the opened set installs nothing and keeps running
        await waitFor(
            () => h.event.getEventCallCount(outsider, "onChannelOpened") === 1,
            h.event.protocolEventTimeoutMs()
        );
        expect(h.event.getEventCallCount(outsider, "onAbort")).to.equal(0);
        expect(h.event.getEventCallCount(outsider, "onSetState")).to.equal(0);
        expect(runtimeIsClosed(h.getPeer(outsider).p2pInstance)).to.equal(
            false
        );
        expect(
            await h.control(h.getPeer(outsider)).query.getForkId().request()
        ).to.not.equal(snapshot.forkId);
    });
});
