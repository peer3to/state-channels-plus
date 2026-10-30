// @spec-test-coverage-ignore: harness membership-tracking contract test; the peer filters and leave waits are test infrastructure with no specification or implementation IDs

import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("PeerTestHarness current membership", function () {
    it("a runtime whose failed join emitted onLeftChannel joins again: the active-peer filter and sync barriers include it again, and its later leave wait needs a new onLeftChannel", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        const signer = joiner.p2pInstance.p2pSigner;
        const activeIndices = () =>
            h.getActiveHonestPeers().map((peer) => peer.index);
        await h.rpcStub.failMembershipReceipt(joiner.index, "joinChannel", {
            once: true
        });

        const refused = await h.join.buildJoinChannelConfirmation({
            joiner,
            channelId: h.channelId!
        });
        expect(
            await signer.joinChannel(
                refused.confirmation,
                refused.expectedSnapshotHash,
                refused.expectedForkId
            )
        ).to.equal(false);
        await h.event.waitUntilLeftChannel(joiner.index);
        expect(activeIndices()).to.not.include(joiner.index);

        // the same runtime joins again and is seated
        const accepted = await h.join.buildJoinChannelConfirmation({
            joiner,
            channelId: h.channelId!
        });
        expect(
            await signer.joinChannel(
                accepted.confirmation,
                accepted.expectedSnapshotHash,
                accepted.expectedForkId
            )
        ).to.equal(true);
        await h.assert.storage.honestPeersObserveInboundMessageWait({
            peerIndices: [0, 1, 2]
        });
        await h.transition.advanceState({ count: 1, waitForPeers: [0, 1, 2] });
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING);
        expect(activeIndices()).to.include(joiner.index);
        // the default barrier waits for the rejoined member too
        await h.assert.sync.peersInSyncWait();

        const leftBefore = h.event.getEventCallCount(
            joiner.index,
            "onLeftChannel"
        );
        expect(leftBefore).to.equal(1);
        await h.transition.keepAuthoringUntil({
            until: async () =>
                (await h.query.getNextPeerToWrite()).index === joiner.index,
            waitForPeers: [0, 1, 2, joiner.index],
            maximumBlocks: 4
        });
        // the leave's own sync waits use the active peers, the leaver included
        await h.transition.participantLeaveWait({ leaverIndex: joiner.index });
        await h.event.waitUntilLeftChannel(joiner.index, leftBefore);

        expect(
            h.event.getEventCallCount(joiner.index, "onLeftChannel")
        ).to.equal(2);
        expect(activeIndices()).to.not.include(joiner.index);
    });
});
