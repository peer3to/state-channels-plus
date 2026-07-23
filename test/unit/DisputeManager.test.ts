import { expect } from "chai";

import { MathTestSession as TestSession, sleep } from "@test/harness";

describe("Unit: DisputeManager", function () {
    describe("dispute", function () {
        // Ported from origin/unit-test-dispute-manager (was it.skip / ~10% flaky).
        // Forces the losing-peer ErrorDisputeInboundMessageBlocksInvalid path
        // after another reducer has already committed, so the swallow is
        // deterministic rather than left to a natural race.
        it("fault-free writer-timeout on a pending-join fork → losing reducer's stale reduceAndFinalize revert is swallowed, no detached rejection", async function () {
            this.timeout(90000);
            const h = TestSession.getHarness();

            // a pending inbound join leaves the head not-final-by-everyone, so a
            // dispute here carries postedAuditingData=true (auditing calldata)
            await h.scenario.preDisputeSetupCalldataPath({
                timeConfig: { chainFallbackTime: 2, evidenceTime: 3 }
            });
            const sourceForkId = h.activeForkId!;

            // no block is produced -> the next writer's turn lapses -> the honest
            // peers dispute the timed-out writer. a timeout has no fraud proof, so
            // on this calldata-backed fork dispute() takes the no-multicall +
            // uploadDisputeWithCalldata path (the branch this test covers)
            const darkWriter = await h.query.getNextPeerToWrite();
            const disputers = h.peers
                .filter((p) => p.index !== darkWriter.index)
                .map((p) => p.index);

            // Stage every peer's reduction entry points so the
            // ErrorDisputeInboundMessageBlocksInvalid race is forced, not left
            // to chance (~10% natural flake on the unstaged path).
            const races = new Map(
                await Promise.all(
                    h.peers.map(
                        async (peer) =>
                            [
                                peer.index,
                                await h.rpcStub.holdReductionRace(peer.index)
                            ] as const
                    )
                )
            );

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: disputers,
                expectedCount: disputers.length,
                initiatedWithAuditingData: true, // the calldata upload we wanted
                timeoutMs: 30000
            });

            await sleep(h.event.evidencePeriodWaitMs(2));

            const winnerIndex = disputers[0];
            const loserIndices = disputers.slice(1);

            // Winner reduces for real and commits on-chain first.
            await races.get(winnerIndex)!.release({
                runHeldTasks: true,
                replayEvents: true
            });
            races.delete(winnerIndex);
            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: [winnerIndex]
            });

            // Local completion can race ahead of the detached on-chain submit;
            // the loser's swallow gate needs the commit visible. Await the
            // winner observing its own reduced-result commit (event-driven, not
            // a ground-truth poll).
            await h.event.waitForPeers(
                "onDisputeReducedResultCommitted",
                [winnerIndex],
                1,
                { timeoutMs: 20000, mode: "atLeast" }
            );

            // Force each remaining honest peer through the inbound-blocks race
            // error on simulateSubmission; the fix must confirm getReducedResult
            // and swallow with zero unhandled rejections.
            for (const loserIndex of loserIndices) {
                await h
                    .control(h.getPeer(loserIndex))
                    .stub.stubNextReductionSimulationError(
                        "ErrorDisputeInboundMessageBlocksInvalid"
                    )
                    .request();
                await races.get(loserIndex)!.release({
                    runHeldTasks: true,
                    // Drive tryReduce via the held timer, not snapshot replay
                    // (which could complete without hitting the injected error).
                    replayEvents: false
                });
                races.delete(loserIndex);
            }

            // Dark writer was held too; release without replaying so teardown
            // is clean (they are not expected to settle the fork).
            for (const [peerIndex, race] of races) {
                await race.release({
                    runHeldTasks: false,
                    replayEvents: false
                });
                races.delete(peerIndex);
            }

            await h.assert.dispute.reductionCompletedWait({
                sourceForkId,
                peerIndices: loserIndices
            });

            const hostErrors = await h.quiesceHosts();
            expect(hostErrors).to.deep.equal([]);
            expect(TestSession.getFirstDetachedError()).to.equal(undefined);
        });
    });
});
