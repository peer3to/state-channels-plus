import { eventPipelineOutcome } from "@test/fixtures/DisputeAuditStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// The dispute update hook reads the window's commitments from the chain. The
// observed peer is an honest auditor of an invalid block; its mirror and
// chain reads are recorded, and every read still reaches the real contracts.
describe("Unit: dispute update hook window commitments", function () {
    const stageDispute = async (
        h: ReturnType<typeof TestSession.getHarness>,
        faultTheFirstChainRead: boolean
    ) => {
        await h.scenario.preDisputeSetup({ peerCount: 4 });
        const forkId = h.activeForkId!;
        const offender = await h.query.getNextPeerToWrite();
        const observed = h.peers.find((peer) => peer.index !== offender.index)!;
        const reads = await h.mirror.observe(
            observed.index,
            "getWindowCommitments"
        );
        try {
            if (faultTheFirstChainRead)
                await h.mirror.failNextChainRead(
                    observed.index,
                    "getWindowCommitments",
                    "revert"
                );
            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            await h.assert.dispute.initiatedAndCommitedWait({
                initiatedWithAuditingData: false
            });
            await h.dispute.resolveDisputeWait({ forkId });
            await h.event.settleContractEvents(observed.index);
            return {
                commits: h.event.getEventCallCount(
                    observed.index,
                    "onDisputeCommitted"
                ),
                observed,
                observation: await reads.observation()
            };
        } finally {
            await reads.restore();
        }
    };

    it("a committed dispute's update notification follows a chain read of the window's commitments, and no mirror read", async function () {
        const h = TestSession.getHarness();
        const { observed, observation, commits } = await stageDispute(h, false);

        expect(observation.local.reads).to.equal(0);
        expect(observation.chain.reads).to.be.greaterThan(0);
        expect(observation.chain.failures).to.deep.equal([]);
        // each committed dispute notified the app once
        expect(commits).to.be.greaterThan(0);
        expect(
            h.event.getEventCallCount(observed.index, "onDisputeUpdate")
        ).to.equal(commits);
    });

    it("a failed chain read of the window's commitments skips that update notification and leaves the event pipeline running", async function () {
        const h = TestSession.getHarness();
        const { observed, observation, commits } = await stageDispute(h, true);
        expect(commits).to.be.greaterThan(1);

        expect(observation.local.reads).to.equal(0);
        expect(observation.chain.failures).to.have.length(1);
        expect(
            h.event.getEventCallCount(observed.index, "onDisputeUpdate")
        ).to.equal(commits - 1);
        expect(await eventPipelineOutcome(h, observed.index)).to.deep.equal({
            failedBlocks: 0,
            isDisposed: false
        });
    });
});
