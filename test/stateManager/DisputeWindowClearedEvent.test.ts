import { Status } from "@/types";
import {
    eventPipelineOutcome,
    stageReasonlessInitialDispute
} from "@test/fixtures/DisputeAuditStaging";
import {
    stageFinalDisputeWhileAway,
    stageSpectatorAwayThroughDispute
} from "@test/fixtures/DisputeWindowGateStaging";
import {
    committedDisputeLogs,
    killedDisputeLogs
} from "@test/fixtures/DisputeWindowWorkflowStaging";
import { stageRemovedWhileAway } from "@test/fixtures/RemovedWhileAwayStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

const DISPUTE_EVENTS = ["DisputeCommitted", "DisputeCommittedWithAuditingData"];

/**
 * A peer paused through a whole dispute cycle, as a background browser tab
 * (`stageRemovedWhileAway`). Its held logs are then started in chain order,
 * the dispute events first, as the resumed runtime meets them after the chain
 * moved on. While the peer still participates on the disputed fork, the
 * disputes must be ignored: auditing them against the pruned chain, killing
 * them and building a state proof of the settled fork used to fail the event
 * pipeline. The snapshot update it never installed removed it: it leaves the
 * channel unless the chain lists it again. The same gate drops a cleared
 * threshold-final dispute without installing its output, and a synced
 * spectator's cleared disputes without persisting or scheduling them.
 */
describe("Dispute window cleared before handling", function () {
    it("a timed-out peer whose chain events were held through the disputes, the reduction and a same-fork snapshot update ignores the disputes and leaves", async function () {
        const h = TestSession.getHarness();
        const { pausedIndex, releaseLogs } = await stageRemovedWhileAway(h);
        const audits = await h.rpcStub.recordDisputeAudits(pausedIndex);

        const failures = [
            ...(await releaseLogs(DISPUTE_EVENTS)),
            ...(await releaseLogs())
        ];
        expect(failures).to.deep.equal([]);
        await h.event.waitUntilLeftChannel(pausedIndex);
        // a settled dispute is not shown to the app as a live one
        for (const hook of ["disputeStarted", "onDisputeUpdate"] as const)
            expect(
                h.event.getEventCallCount(pausedIndex, hook),
                `the paused peer reported a settled dispute (${hook})`
            ).to.equal(0);
        // nor audited, killed or answered with its own dispute
        expect(await audits.auditCount()).to.equal(0);
        expect(await killedDisputeLogs(h)).to.deep.equal([]);
        expect(
            (await committedDisputeLogs(h)).map((log) => log.disputer)
        ).to.not.include(h.getPeer(pausedIndex).address);
    });

    it("a double signer whose chain events were held through a threshold-final dispute, its reduction and a same-fork snapshot update ignores the final dispute without installing its output, and leaves", async function () {
        const h = TestSession.getHarness();
        const { pausedIndex, releaseLogs, genesisInstalls } =
            await stageFinalDisputeWhileAway(h);

        const failures = [
            ...(await releaseLogs(DISPUTE_EVENTS)),
            ...(await releaseLogs())
        ];
        expect(failures).to.deep.equal([]);
        await h.event.waitUntilLeftChannel(pausedIndex);
        expect(await genesisInstalls.count()).to.equal(0);
    });

    it("a synced spectator whose chain events were held through a dispute cycle and a same-fork snapshot update ignores the disputes: nothing persisted, no reduction scheduled, and its mirror holds the chain's snapshot", async function () {
        const h = TestSession.getHarness();
        const { forkId, spectatorIndex, releaseLogs } =
            await stageSpectatorAwayThroughDispute(h);
        const spectator = h.getPeer(spectatorIndex);
        const scheduled = await h.rpcStub.recordScheduledTasks(spectatorIndex);

        const failures = [
            ...(await releaseLogs(DISPUTE_EVENTS)),
            ...(await releaseLogs())
        ];
        expect(failures).to.deep.equal([]);
        expect(
            await h
                .control(spectator)
                .query.getDisputeConfirmationHashes()
                .request()
        ).to.deep.equal([]);
        expect(
            (await scheduled.tasks()).map((task) => task.taskName)
        ).to.not.include(`reduction-${forkId}`);
        expect(await eventPipelineOutcome(h, spectatorIndex)).to.deep.equal({
            failedBlocks: 0,
            isDisposed: false
        });
        expect((await h.query.getLocalStateSnapshot(spectator)).hash).to.equal(
            await h.query.getOnChainSnapshotHash()
        );
    });

    it("a timed-out peer removed by a same-fork snapshot update it never installed stays a participant while the chain lists it as a pending joiner", async function () {
        const h = TestSession.getHarness();
        const { pausedIndex, honestIndices, releaseLogs } =
            await stageRemovedWhileAway(h);
        // a timeout dispute of the idle writer would post a new snapshot and
        // replace the removing one
        for (const index of honestIndices)
            await h.rpcStub.suppressTimeoutCheck(index);
        const paused = h.getPeer(pausedIndex);
        await h.join.forceInboundJoinWait({ participant: paused.address });
        const removingSnapshotHash = await h.query.getOnChainSnapshotHash();
        const stub = h.control(paused).stub;
        await stub.recordMembershipEndChecks().request();

        const failures = [
            ...(await releaseLogs(DISPUTE_EVENTS)),
            ...(await releaseLogs())
        ];
        expect(failures).to.deep.equal([]);
        // the removal check reached its chain read, which lists the signer
        await waitFor(async () =>
            (
                await stub.getMembershipEndChecks().request()
            ).signerOnChainAnswers.includes(true)
        );
        expect(await h.query.getOnChainSnapshotHash()).to.equal(
            removingSnapshotHash
        );
        expect(
            (await stub.getMembershipEndChecks().request()).dropCount
        ).to.equal(0);
        expect(await h.control(paused).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
        expect(
            h.event.getEventCallCount(pausedIndex, "onLeftChannel")
        ).to.equal(0);
    });
});

/**
 * A fork's first dispute opens its window in the same transaction, and logs
 * arrive from every RPC node while a read goes to one. An auditor whose read
 * node has not yet imported the dispute's block must wait for it, not take
 * the missing window as a cleared one.
 */
describe("Dispute window not yet visible on a lagging read node", function () {
    it("an auditor whose read node is behind the block of a fork's first dispute waits for it, then acknowledges, audits and kills the invalid dispute", async function () {
        const h = TestSession.getHarness();
        const { spammer, submissions, chainView, waitUntilSettled } =
            await stageReasonlessInitialDispute(h, {
                hold: false,
                lagChainView: true
            });
        // the window read waits for the read node to reach the dispute's block
        await waitFor(
            async () => (await chainView!.chainHeadWaitsEntered()) > 0
        );
        expect(h.event.getEventCallCount(0, "disputeStarted")).to.equal(0);
        expect(await submissions.submissions()).to.deep.equal([]);

        await chainView!.release();
        await h.rpcStub.mineTransferBlock();
        await waitUntilSettled();
        const [submission] = await submissions.submissions();
        expect(submission.method).to.equal("multicallBestEffortLast");
        expect(submission.revert).to.equal(null);
        // onDisputeStarted fires only for the acknowledgment's first request
        expect(h.event.getEventCallCount(0, "disputeStarted")).to.equal(1);
        expect(
            (await killedDisputeLogs(h)).map((log) => log.disputer)
        ).to.deep.equal([spammer.address]);
    });
});
