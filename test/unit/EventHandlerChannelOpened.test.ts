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

    it("aborts every runtime without installing when the opened hash matches no genesis", async function () {
        const h = TestSession.getHarness();
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
        await waitFor(
            () =>
                h.peers.every(
                    (peer) =>
                        h.event.getEventCallCount(peer.index, "onAbort") === 1
                ),
            h.event.protocolEventTimeoutMs()
        );
        await waitFor(
            () => h.peers.every((peer) => runtimeIsClosed(peer.p2pInstance)),
            h.event.protocolEventTimeoutMs() * 2
        );
        // the handler throws after the abort, so the log fails on every runtime
        await TestSession.settleDetached({
            expectedErrorIncludes: "Opened genesis rejected: hash mismatch"
        });
        for (const peer of h.peers) {
            expect(
                h.event.getEventCallCount(peer.index, "onChannelOpened"),
                `peer ${peer.index} completed the open`
            ).to.equal(0);
            expect(
                h.event.getEventCallCount(peer.index, "onSetState"),
                `peer ${peer.index} installed a state`
            ).to.equal(0);
        }
    });
});
