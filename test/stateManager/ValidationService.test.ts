import { expect } from "chai";

import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

const AUTHOR_GATE = "blockAuthorIsNotParticipant";

describe("ValidationService - block author participant gate", function () {
    it("binds the author to the previous snapshot and to a coordinate-matched resulting snapshot", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const { peer: joiner } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2, 3],
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const peer = h.control(h.getPeer(0));

        expect(
            await peer.stub.probeAuthorGatePreviousSnapshotMember().request(),
            "author listed in the previous snapshot is accepted"
        ).to.not.equal(AUTHOR_GATE);

        expect(
            await peer.stub
                .probeAuthorGateMatchingResultingSnapshot()
                .request(),
            "author in a resulting snapshot bound to the block's own coordinates is accepted"
        ).to.not.equal(AUTHOR_GATE);

        expect(
            await peer.stub.probeAuthorGateStaleHeightSnapshot().request(),
            "author whose only snapshot is from a different height is rejected"
        ).to.equal(AUTHOR_GATE);

        expect(
            await peer.stub.probeAuthorGateWrongForkSnapshot().request(),
            "author whose only snapshot is from a different fork is rejected"
        ).to.equal(AUTHOR_GATE);

        expect(
            await peer.stub
                .probeAuthorGateMatchingSnapshotExcludingAuthor()
                .request(),
            "author absent from a coordinate-matched snapshot is rejected"
        ).to.equal(AUTHOR_GATE);

        expect(
            await peer.stub
                .probeAuthorGateMissingSnapshotPreviousMember()
                .request(),
            "missing declared snapshot falls back to the previous snapshot, which lists the author"
        ).to.not.equal(AUTHOR_GATE);

        expect(
            await peer.stub.probeAuthorGateMissingSnapshotOutsider().request(),
            "missing declared snapshot rejects an author the previous snapshot omits"
        ).to.equal(AUTHOR_GATE);

        expect(
            await peer.stub
                .probeAuthorGateNoAnchorCurrentParticipant()
                .request(),
            "with no local anchor, a current on-chain participant is accepted"
        ).to.not.equal(AUTHOR_GATE);

        expect(
            await peer.stub.probeAuthorGateNoAnchorUnknownAddress().request(),
            "with no local anchor, an unrelated address is rejected"
        ).to.equal(AUTHOR_GATE);

        // a real pending participant: joined on-chain but not yet in the
        // current set, so only the pending half of the union can admit it
        await h.event.waitUntilPeerStatus(joiner.index, Status.SYNCED);
        await h.join.joinChannelWait({ joiner });
        expect(
            await h.control(joiner).query.getStatus().request(),
            "joiner is a pending participant"
        ).to.equal(Status.PENDING_PARTICIPANT);
        const currentParticipants = await peer.query
            .getParticipants()
            .request();
        expect(
            currentParticipants.map((p) => p.toLowerCase()),
            "joiner is not yet in the current participant set"
        ).to.not.include(joiner.address.toLowerCase());

        expect(
            await peer.stub
                .probeAuthorGateNoAnchorPendingParticipant(joiner.address)
                .request(),
            "with no local anchor, a pending on-chain participant is accepted via the current+pending union"
        ).to.not.equal(AUTHOR_GATE);
    });
});
