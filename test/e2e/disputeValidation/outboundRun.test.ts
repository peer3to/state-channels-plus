import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    eventPipelineOutcome,
    overflowingLatestHead,
    postForgedOutboundRunDispute
} from "@test/fixtures/DisputeAuditStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { MaxUint256 } from "ethers";

// the chain anchor holds outbound block 1 (the first leave), the latest state
// outbound block 2 (the second leave, its snapshot post held)
describe("E2E: dispute validation / outbound run", function () {
    it("a committed dispute posts auditing data whose outbound run misses the block above the chain anchor -> an auditing remaining peer kills it with DisputeInvalidOutboundRun", async function () {
        const h = TestSession.getHarness();
        const { forkId, remaining, auditorIndex, disputer, heldPost } =
            await postForgedOutboundRunDispute(h, (auditingData) => {
                auditingData.outboundMessageBlocks = [];
            });

        const kill = await readDisputeKill(h, disputer);
        // the poster's own SDK audits the bypassing upload too
        expect(remaining.map((index) => h.getPeer(index).address)).to.include(
            kill.killer
        );
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeInvalidOutboundRun
        ]);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [auditorIndex]
        });
        // the second leaver's parked exit post would keep its node busy
        await heldPost.release();
    });

    it("a committed dispute posts auditing data whose outbound block above the chain anchor (which holds the first leave's withdrawal) carries a message balance of MaxUint256 -> every auditing remaining peer's audit returns false without an error, a DisputeInvalidOutboundRun kill is accepted by the chain, and no event pipeline fails", async function () {
        const h = TestSession.getHarness();
        const { forkId, remaining, auditorIndex, disputer, heldPost } =
            await postForgedOutboundRunDispute(h, (auditingData) => {
                const [block] = auditingData.outboundMessageBlocks;
                auditingData.outboundMessageBlocks = [
                    {
                        ...block,
                        messages: block.messages.map((message, index) =>
                            index === 0
                                ? {
                                      ...message,
                                      balance: {
                                          ...message.balance,
                                          amount: MaxUint256
                                      }
                                  }
                                : message
                        )
                    }
                ];
            });

        const kill = await readDisputeKill(h, disputer);
        expect(remaining.map((index) => h.getPeer(index).address)).to.include(
            kill.killer
        );
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeInvalidOutboundRun
        ]);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [auditorIndex]
        });
        // no audit of the forged run failed: every dispute event settled
        for (const index of remaining) {
            await h.rpcStub.waitUntilDisputeMutexIdle(index);
            expect(
                await eventPipelineOutcome(h, index),
                `peer ${index}'s event pipeline`
            ).to.deep.equal({ failedBlocks: 0, isDisposed: false });
        }
        await heldPost.release();
    });

    it("the disputer signs a last block above its head that commits a forged latest snapshot whose outbound head is an overflowing block (message balance MaxUint256) right above the chain anchor -> the replay rejects the forged latest state before the outbound run is judged: a DisputeInvalidBlockInStateProofApplyFraudProof kill is accepted by the chain and no event pipeline fails", async function () {
        const h = TestSession.getHarness();
        const { forkId, remaining, auditorIndex, disputer, heldPost } =
            await postForgedOutboundRunDispute(h, overflowingLatestHead(h));

        const kill = await readDisputeKill(h, disputer);
        expect(remaining.map((index) => h.getPeer(index).address)).to.include(
            kill.killer
        );
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        ]);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [auditorIndex]
        });
        // no audit of the forged latest state failed: every dispute event settled
        for (const index of remaining) {
            await h.rpcStub.waitUntilDisputeMutexIdle(index);
            expect(
                await eventPipelineOutcome(h, index),
                `peer ${index}'s event pipeline`
            ).to.deep.equal({ failedBlocks: 0, isDisposed: false });
        }
        await heldPost.release();
    });
});
