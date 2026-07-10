import { addressesEqual } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { covers } from "./domain";

describe("fork-reduction / disputeResolution", function () {
    it(
        "should reduce invalid state transition disputes and create new fork",
        covers(
            {
                disputesInWindow: "one"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({ peerCount: 4 });
                const nextPeer = await h.query.getNextPeerToWrite();
                await h.byzantine.submitInvalidStateTransitionBlock(
                    nextPeer.index
                );
                await h.assert.dispute.initiatedAndCommitedWait();
                await h.dispute.resolveDisputeWait();
            }
        )
    );

    // what: two DISTINCT participants each file a valid self-removal on the SAME open window
    //       within the evidence period -> both accumulate, then ONE reduction removes both.

    it(
        "two distinct self-removals accumulate in one window and reduce together → both removed",
        covers(
            {
                disputesInWindow: "two-plus"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup({
                    peerCount: 4,
                    timeConfig: { agreementTime: 8, evidenceTime: 8 }
                });

                const leaverA = 1;
                const leaverB = 2;
                const leaverAddrA = h.getPeer(leaverA).address;
                const leaverAddrB = h.getPeer(leaverB).address;

                // both are voluntary leavers: skip sync barriers, don't mark malicious.
                h.context.leftChannelPeerIndices = [
                    ...h.context.leftChannelPeerIndices,
                    leaverA,
                    leaverB
                ];

                // disputer A opens the window with a valid self-removal.
                await h
                    .control(h.getPeer(leaverA))
                    .dispute.setForceExit(true)
                    .request();
                await h.tamper.postTamperedDispute(leaverA, () => {}, {
                    markMalicious: false
                });

                // disputer B (distinct -> not throttled) joins the SAME window in-period: 2nd commitment.
                await h
                    .control(h.getPeer(leaverB))
                    .dispute.setForceExit(true)
                    .request();
                await h.tamper.postTamperedDispute(leaverB, () => {}, {
                    markMalicious: false
                });

                const remainingPeers = h
                    .getPeersExcludingMaliciousAndLeavers()
                    .map((p) => p.index);

                await h.assert.dispute.committedWait({
                    peersIndices: remainingPeers,
                    expectedCount: 2
                });

                await h.dispute.resolveDisputeWait({
                    honestPeerIndices: remainingPeers
                });

                expect(
                    h.event.getEventCallCount(
                        remainingPeers[0],
                        "onDisputeReducedResultCommitted"
                    ),
                    "both disputes should resolve in a single reduction"
                ).to.equal(1);

                await h.assert.sync.participantCount({ expectedCount: 2 });
                const participants = await h
                    .control(h.getPeer(0))
                    .query.getParticipants()
                    .request();
                expect(
                    participants.some((p) => addressesEqual(p, leaverAddrA)),
                    "leaver A should be removed by the combined reduction"
                ).to.equal(false);
                expect(
                    participants.some((p) => addressesEqual(p, leaverAddrB)),
                    "leaver B should be removed by the combined reduction"
                ).to.equal(false);
            }
        )
    );
});
