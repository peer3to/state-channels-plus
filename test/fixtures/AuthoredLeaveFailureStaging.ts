// @spec-test-coverage-ignore: authored-leave fallback staging for mapped runtime cases
import { addressesEqual } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * A leaver authors its exit while each of its snapshot posts fails, so the
 * leave watchdog's self-removal dispute is the fallback. That dispute's send
 * fails: an unrecognized failure is fatal for the runtime and leaves no
 * dispute marker; with an expired evidence period the leave waits for the
 * window's reduction.
 */
export async function assertAuthoredLeaveFallback(
    failure: "unrecognized-upload-failure" | "evidence-expired"
) {
    const h = TestSession.getHarness();
    await h.lifecycle.start(3, 0, {
        timeConfig: { evidenceTime: 20 },
        // the production default
        configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 15_000 }
    });
    const leaver = h.getPeer(1);
    const forkId = h.activeForkId!;
    await h.control(leaver).stub.failStateSnapshotPost().request();
    const recorder = await h.rpcStub.recordDisputeSubmissions(leaver.index, {
        failWith: {
            customError:
                failure === "evidence-expired"
                    ? "RaceConditionDisputeEvidencePeriodExpired"
                    : undefined,
            message: "Dispute send failed",
            at: "send"
        }
    });
    let restored = false;
    let authored: Promise<unknown> | undefined;
    leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
        authored = leaver.p2pInstance.p2pContractInstance.leaveChannel();
    });
    leaver.p2pInstance.leaveChannel();
    try {
        // The exit can start before a generic tip wait observes the trigger block.
        // Wait for the explicit leave barriers below.
        await h.transition.advanceState({ waitForSync: false });
        await h.event.waitForPeers("onLeaveTurn", [leaver.index], 1);
        await authored;
        await h.event.waitUntilLeaveState(leaver.index, "isExitBlockCommitted");
        // the remaining participants keep authoring until the watchdog's
        // dispute, so no idle writer is timed out meanwhile
        await h.transition.keepAuthoringUntil({
            until: async () => (await recorder.submissions()).length > 0,
            waitForPeers: [0, 2],
            excludePeerIndices: [leaver.index],
            maximumBlocks: 6
        });
        expect(await recorder.submissions()).to.have.length(1);
        if (failure === "evidence-expired") {
            // the chain refuses the fallback when the fork's window already
            // holds commitments -> the refused upload rolls its marker back
            // and the leave waits for that window's reduction
            await waitFor(
                async () =>
                    !(await h
                        .control(leaver)
                        .query.didIDispute(forkId)
                        .request())
            );
            await recorder.restore();
            await h.control(leaver).stub.restoreStateSnapshotPost().request();
            restored = true;
            // a committed self-removal stands in for that window; its
            // reduction drops the leaver
            await h.dispute.suppressDisputeInitiation([leaver.index]);
            await h.dispute.selfRemoveViaDisputeWait({
                leaverIndex: leaver.index,
                forkId
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: [0, 2],
                assertMaliciousRemoved: false
            });
            await h.event.waitUntilLeftChannel(leaver.index);
            for (const peer of [h.getPeer(0), h.getPeer(2)]) {
                const participants = await h
                    .control(peer)
                    .query.getParticipants()
                    .request();
                expect(
                    participants.some((participant) =>
                        addressesEqual(participant, leaver.address)
                    )
                ).to.equal(false);
            }
        } else {
            // the unrecognized upload failure is fatal for the runtime, and
            // no dispute marker stays behind
            await waitFor(
                async () =>
                    !(await h
                        .control(leaver)
                        .query.didIDispute(forkId)
                        .request())
            );
            await TestSession.settleDetached({
                expectedErrorIncludes: "Dispute send failed"
            });
            expect(leaver.eventSpies.onLeftChannel?.called).to.equal(false);
        }
    } finally {
        if (!restored) {
            await recorder.restore();
            await h.control(leaver).stub.restoreStateSnapshotPost().request();
        }
    }
}
