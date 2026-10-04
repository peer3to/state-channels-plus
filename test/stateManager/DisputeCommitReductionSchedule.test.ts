import { stageAuditorOfflineThroughKillPeriod } from "@test/fixtures/OfflineAuditorStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * A committed dispute must schedule the fork's reduction even when the node
 * could add evidence but its own upload is skipped because it already holds
 * a commitment in the window. The node disputes a real
 * fraud while missing the commit deliveries; its dispute construction is then
 * staged to claim more than its committed dispute did, so the evidence
 * comparison finds an improvement; the missed commits are recovered through
 * the production query path inside the kill period.
 */
describe("Dispute commit reduction schedule", function () {
    it("a commit whose evidence-improvement upload is skipped as already initiated still schedules the reduction", async function () {
        const h = TestSession.getHarness();
        // The recovery must land inside the kill period: the expired branch
        // persists and schedules unconditionally and would mask the
        // audit-valid path under test.
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 16 }
        });
        const forkId = h.activeForkId!;
        const nodeIndex = 0;
        const node = h.getPeer(nodeIndex);
        const maliciousIndex = 2;

        const scheduled = await h.rpcStub.recordScheduledTasks(nodeIndex);
        const restoreCommits = await h.rpcStub.holdDisputeCommittedEvents(
            nodeIndex,
            { passFirst: false }
        );
        const reductionTasks = async () =>
            (await scheduled.tasks()).filter((task) =>
                task.taskName.startsWith("reduction-")
            ).length;
        try {
            await h.byzantine.submitInvalidStateTransitionBlock(maliciousIndex);
            await h.assert.dispute.initiatedWait({ peersIndices: [nodeIndex] });
            // From now on the node's constructible dispute claims one more
            // slash than the dispute it committed: an evidence improvement
            // whose upload is a no-op because the node already disputed.
            await h.tamper.stubConstructDispute(
                nodeIndex,
                (dispute, _sm, args) => {
                    dispute.input.onChainSlashes = [
                        ...dispute.input.onChainSlashes,
                        args.extraSlashedAddress as string
                    ];
                },
                { args: { extraSlashedAddress: h.getPeer(3).address } }
            );

            const before = await reductionTasks();
            // The window exists once the node's dispute is mined.
            await waitFor(
                async () =>
                    (await h.query.killPeriod(forkId, nodeIndex)).windowExists
            );
            const killPeriod = await h.query.killPeriod(forkId, nodeIndex);
            const remainingMs =
                (killPeriod.killPeriodEnd - killPeriod.blockTimestamp) * 1000;
            expect(
                remainingMs,
                "the recovery must land inside the kill period"
            ).to.be.greaterThan(2000);
            await restoreCommits();
            // One recovery pass answers null while a commitment's log is not
            // yet readable; retry inside the window.
            await waitFor(
                async () => {
                    const recovered = await h
                        .control(node)
                        .dispute.recoverCommittedDisputes(forkId)
                        .request();
                    return recovered !== null && recovered > 0;
                },
                remainingMs / 2,
                250
            );
            await waitFor(
                async () => (await reductionTasks()) > before,
                remainingMs - 1000,
                100
            );
        } finally {
            await h.byzantine.restoreDisputeConstruction(nodeIndex);
            await scheduled.restore();
        }

        await h.dispute.resolveDisputeWait({ forkId });
        expect(await h.control(node).query.getForkId().request()).to.not.equal(
            forkId
        );
    });

    it("a commit recovered after its kill period expired → audited in full: the replay stores the head state the peer missed, the confirmation is kept, nothing is killed", async function () {
        const h = TestSession.getHarness();
        // the fork stays current on every peer: no reduction runs
        const {
            forkId,
            offlineIndex: missedIndex,
            restoreCommits,
            headState,
            waitUntilKillPeriodExpired
        } = await stageAuditorOfflineThroughKillPeriod(h, "everyPeer");
        const missed = h.control(h.getPeer(missedIndex));
        expect(await headState(), "the peer missed the head").to.equal(null);
        await waitUntilKillPeriodExpired();

        await h.network.reconnectPeers([missedIndex]);
        await restoreCommits();
        // one recovery pass answers null while a commitment's log is not
        // yet readable
        await waitFor(async () => {
            const recovered = await missed.dispute
                .recoverCommittedDisputes(forkId)
                .request();
            return recovered !== null && recovered > 0;
        }, h.event.protocolEventTimeoutMs());
        await h.assert.storage.storedDisputeConfirmationsWait({
            peerIndices: [missedIndex],
            forkId
        });

        expect(await headState()).to.not.equal(null);
        expect(
            h.event.getEventCallCount(missedIndex, "onDisputeKilled")
        ).to.equal(0);
    });
});
