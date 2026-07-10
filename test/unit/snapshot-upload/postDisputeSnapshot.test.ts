import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

describe("snapshot-upload / postDisputeSnapshot", function () {
    it(
        "should post updated state snapshot after fork resolution",
        covers(
            {
                composition: "fork-only"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdateWait();

                await h.assert.sync.onlyHonestPeersInSync();
                await h.transition.fromHonestPeersOnly((c) => c.add(1));
                h.event.resetEventSpies();
                const expectedSnapshot2 = await h.transition.postSnapshot({
                    peerIndex: 0
                });

                await h.assert.snapshot.onChainSnapshotChangedDetached({
                    expectedSnapshot: expectedSnapshot2
                });
                return;
            }
        )
    );
});
