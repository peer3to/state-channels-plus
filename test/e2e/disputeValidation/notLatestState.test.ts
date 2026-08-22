import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / notLatestState", function () {
    it("dispute.input.stateProof truncated below disputer's last signed block → DisputeNotLatestState", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const forkId = h.activeForkId!;

        await h.transition.advanceState({ count: 3 });
        //  now it is peer 2 turn, current block height is 4 (5 transactions done)

        // Stub peer 0's constructDispute: truncate state proof to height 2 so the dispute
        // shows latest at block 2, while peer 0 has actually signed block 4.
        await h.tamper.stubConstructDispute(0, async (dispute, sm) => {
            await sm.p2pManager.localRpc.dispute.truncateStateProofToHeight(
                dispute,
                2
            );
        });

        //  peer 1 submits a double sign block
        await h.byzantine.submitDoubleSignBlock(1);

        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [0],
            initiatedWithAuditingData: false
        });

        await h.event.waitForPeers("onDisputeKilled", [0], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProof({
            disputeFraudProofType: DisputeFraudProofType.DisputeNotLatestState,
            atLeastOneHonestPeer: true
        });
        // The malformed dispute is dead, but the replacement-dispute race does
        // not guarantee which valid counter-dispute supplies the reduced fork.
        await h.dispute.resolveDisputeWait({
            forkId,
            assertMaliciousRemoved: false
        });
    });
});
