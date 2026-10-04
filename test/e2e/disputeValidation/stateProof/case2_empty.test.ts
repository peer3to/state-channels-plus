import { MathTestSession as TestSession } from "@test/harness";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";

// Case 2: empty stateProof. Wrong-genesis / latest-hash rejection cases live in
// disputeInputFields/latestStateSnapshotHash.test.ts "(1) stateProof empty".
describe("E2E: dispute validation / stateProof / Case 2 (empty stateProof)", function () {
    it("empty genesis timeout dispute resolves without honest slash", async function () {
        const h = TestSession.getHarness();
        // no block is ever authored: peer 0 times out at genesis and the
        // others dispute it with the normal construction of an empty proof
        await h.lifecycle.timeoutSetup(4);
        h.contextApi.markAfkPeer({ afkPeerIndex: 0 });
        const forkId = h.activeForkId!;
        const honest = [1, 2, 3];

        await h.assert.dispute.initiatedWait({ peersIndices: honest });
        const dispute = h.getPeer(1).eventSpies.onInitiatingDispute!.lastCall
            .args[1] as DisputeStruct;
        expect(dispute.input.stateProof.milestones).to.have.length(0);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: honest
        });
        const slashed = await h.query.onChainSlashedParticipants(honest[0]);
        for (const index of honest)
            expect(slashed).to.not.include(h.getPeer(index).address);
    });
});
