import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("ValidationService - isBlockAuthorParticipant", function () {
    it("binds the resulting snapshot to the block's own coordinates", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        await h.transition.advanceState();

        const probe = await h
            .control(h.getPeer(0))
            .stub.probeBlockAuthorParticipant()
            .request();

        expect(
            probe.previousSnapshotMember,
            "author already in the previous snapshot counts as a participant"
        ).to.equal("true");
        expect(
            probe.matchingResultingSnapshotMember,
            "author in a resulting snapshot bound to the block's own coordinates counts"
        ).to.equal("true");
        expect(
            probe.staleResultingSnapshotMember,
            "author in a resulting snapshot from a different height must not count"
        ).to.equal("false");
        expect(
            probe.wrongForkResultingSnapshotMember,
            "author in a resulting snapshot from a different fork at the same height must not count"
        ).to.equal("false");
        expect(
            probe.noLocalAnchorKnownParticipant,
            "with no local anchor, a real on-chain participant falls back to the on-chain union"
        ).to.equal("true");
        expect(
            probe.noLocalAnchorUnknownAddress,
            "with no local anchor, an unrelated address is not a participant"
        ).to.equal("false");
    });
});
