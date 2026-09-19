// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { Status } from "@/types";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * A participant leaves while its exit post is parked at the contract send,
 * so it stays PARTICIPATING and keeps ingesting the blocks the others author
 * after its leave block. It must relay none of them: it is outside their
 * participant union, and a relay would reach peers that already applied its
 * exit as a copy from a source they no longer admit.
 */
export async function assertLeaverRelaysNothingAfterItsLeave() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 1);
    // the leave is authored on the leaver's own turn, so leave from there
    const leaver = await h.query.getNextPeerToWrite();
    const remaining = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== leaver.index);
    const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
    try {
        await h.transition.participantLeaveStateTransition({
            leaverIndex: leaver.index,
            waitForPeers: remaining,
            waitForFinalization: true
        });
        // count only what the leaver sends after its own leave block
        await h.control(leaver).stub.observeAdmission().request();
        await h.transition.advanceState({
            count: 2,
            waitForPeers: remaining,
            waitForFinalization: false
        });
        const forkId = h.activeForkId!;
        const height = await h
            .control(h.getPeer(remaining[0]))
            .query.getLatestBlockHeight(forkId)
            .request();
        await waitFor(
            async () =>
                (await h
                    .control(leaver)
                    .query.getLatestBlockHeight(forkId)
                    .request()) === height,
            h.event.protocolEventTimeoutMs()
        );
        // the parked exit keeps the leaver PARTICIPATING: silence here comes
        // from the participant union, not from a status change
        expect(await h.control(leaver).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
        expect(
            (await h.control(leaver).stub.getAdmissionObservation().request())
                .broadcasts
        ).to.equal(0);
    } finally {
        await h.control(leaver).stub.restoreAdmissionObservation().request();
        await send.release();
    }
}

/**
 * The full exit and return: the leaver's exit snapshot lands, the remaining
 * peers must not have blacklisted it over anything it sent while leaving,
 * and a forced re-join brings it back into block production.
 */
export async function assertLeaverCanBeForceJoinedBackAfterExit() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 1);
    const leaver = await h.query.getNextPeerToWrite();
    const remaining = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== leaver.index);
    await h.transition.participantLeaveStateTransition({
        leaverIndex: leaver.index,
        waitForPeers: remaining
    });
    // SYNCED on the leaver means the chain no longer lists it at all
    await h.transition.keepAuthoringUntilPeersStatus({
        peerIndices: [leaver.index],
        status: Status.SYNCED,
        waitForPeers: remaining,
        excludePeerIndices: [leaver.index]
    });
    for (const index of remaining) {
        expect(
            await h
                .control(h.getPeer(index))
                .query.isBlacklisted(leaver.address)
                .request(),
            `peer ${index} blacklisted the leaver`
        ).to.equal(false);
    }
    await h.join.forceInboundJoinWait({
        participant: leaver.address,
        observePeerIndices: remaining
    });
    await h.transition.advanceState({
        count: 1,
        waitForPeers: remaining,
        waitForFinalization: false
    });
    await h.event.waitUntilPeerStatus(leaver.index, Status.PARTICIPATING);
}
