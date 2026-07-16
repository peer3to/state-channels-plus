import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import type { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import type sinon from "sinon";

async function runTransactionCountTamperingScenario(
    recoverMissedDispute: boolean
): Promise<void> {
    const h = TestSession.getHarness();
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 3 }
    });
    await h.byzantine.disconnect(3);
    await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
    const disputedForkId = h.activeForkId;
    if (!disputedForkId) throw new Error("Expected an active fork");
    h.event.resetEventSpies();

    const releaseHeldDisputes = recoverMissedDispute
        ? await h.rpcStub.holdDisputeCommittedEvents(2)
        : undefined;

    await h.tamper.stubConstructDispute(0, async (dispute, sm) => {
        const svc = sm.p2pManager.localRpc.dispute;
        await svc.rewriteLastMilestoneBlockConfirmationInDispute(
            dispute,
            (block) => {
                block.transaction.header.transactionCnt =
                    BigInt(block.transaction.header.transactionCnt) + 5n;
                return block;
            }
        );
    });

    await h.byzantine.submitInvalidStateTransitionBlock(1);
    await h.assert.dispute.initiatedAndCommitedWait({
        peersIndices: [0],
        initiatedWithAuditingData: false
    });

    await h.event.waitForAllPeers("onDisputeKilled", 1, {
        mode: "atLeast",
        timeoutMs: 10000
    });
    await h.assert.dispute.slashedOnChain(h.getPeer(0).address);
    await h.tamper.restoreConstructDispute(0);

    await h.assert.dispute.committedWait({
        expectedCount: 2,
        peersIndices: recoverMissedDispute ? [3] : undefined,
        mode: "atLeast",
        timeoutMs: 10000
    });
    if (releaseHeldDisputes) {
        expect(
            await h.rpcStub.getHeldDisputeCommittedCount(2)
        ).to.be.greaterThan(0);
        await releaseHeldDisputes(false);
    }
    expect(
        await h.channelManager.getWindowCommitments(h.channelId, disputedForkId)
    ).to.not.have.length(0);
    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
        disputeFraudProofType:
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
        peerIndices: recoverMissedDispute ? [0, 1, 3] : undefined,
        timeoutMs: 10000
    });
    let finalCommit: sinon.SinonSpyCall | undefined;
    await h.eventCountsBarrier.waitFor(
        () => {
            finalCommit = h
                .getPeer(3)
                .eventSpies.onDisputeCommitted?.getCalls()
                .find((call) => call.args[3] === true);
            return finalCommit !== undefined;
        },
        {
            timeoutMs: 30000,
            timeoutMessage: "Expected threshold-final replacement dispute"
        }
    );
    if (!finalCommit) {
        throw new Error("Expected threshold-final replacement dispute");
    }
    const finalConfirmation = finalCommit.args[1] as DisputeConfirmationStruct;
    const finalDispute = Codec.decode(
        finalConfirmation.signedDispute.encodedDispute,
        Type.Dispute
    );
    await h.dispute.resolveDisputeWait({
        forkId: disputedForkId,
        // The final dispute output predates the asynchronously observed slash;
        // this test asserts validation/final convergence, not later eviction.
        assertMaliciousRemoved: false,
        expectedResolution: {
            kind: "final-dispute",
            forkId: finalDispute.outputSnapshotDataHash,
            genesisTimestamp: Number(finalCommit.args[2])
        }
    });

    // The final dispute was constructed before peer 0's slash event reached
    // every peer, so its output may still contain peer 0. Reconnect the final
    // dispute author and drive one successor dispute: the locally persisted
    // on-chain slash must now evict peer 0 from the reduced participant set.
    await h.network.connectPeers([3]);
    await h.transition.advanceState({
        waitForPeers: [2, 3],
        waitForFinalization: false
    });
    await h.dispute.resolveSuccessorDisputeAndAssertEvicted({
        maliciousPeerIndex: 2,
        evictedPeerIndices: [0],
        honestPeerIndices: [3]
    });
}

describe("E2E: dispute validation / stateProof / milestone block content integrity", function () {
    describe("stateProof.milestones[-1].blockConfirmations[-1].header.transactionCnt", function () {
        it("transactionCnt += 5 → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            await runTransactionCountTamperingScenario(false);
        });

        it("transactionCnt += 5 → DisputeInvalidBlockInStateProofApplyFraudProof with missed-event recovery", async function () {
            await runTransactionCountTamperingScenario(true);
        });
    });
});
