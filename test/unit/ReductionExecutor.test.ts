import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import * as factory from "@test/factory";
import {
    compareSubmittedInboundTarget,
    tryReadInboundMessageBlocksFailure
} from "@/stateManager/reduction/ReductionExecutor";
import { CustomEvmError } from "@/utils/evmErrorHandler";
import { errorAbis } from "@/utils/GeneratedArtifacts";
import { ethers } from "ethers";

// Built from the real contract ABI, not a hand-written signature: a rename or
// reordering in Errors.sol must break these tests rather than silently feed the
// decoder `undefined` or the neighbouring field's value.
const errorInterface = new ethers.Interface(errorAbis);

/** A real encoded revert, decoded the way the executor decodes one. */
function inboundBlocksRevert(
    overrides: Partial<{
        submittedSnapshotInboundHash: string;
        expectedTargetInboundHash: string;
        runningInboundHash: string;
        breakIndex: number;
        submittedBlockCount: number;
        failureReason: number;
    }> = {}
): CustomEvmError {
    const args = {
        submittedSnapshotInboundHash: factory.hash(),
        expectedTargetInboundHash: factory.hash(),
        runningInboundHash: factory.hash(),
        breakIndex: 0,
        submittedBlockCount: 2,
        failureReason: 0,
        ...overrides
    };
    const encoded = errorInterface.encodeErrorResult(
        "ErrorDisputeInboundMessageBlocksInvalid",
        [
            args.submittedSnapshotInboundHash,
            args.expectedTargetInboundHash,
            args.runningInboundHash,
            args.breakIndex,
            args.submittedBlockCount,
            args.failureReason
        ]
    );
    return new CustomEvmError(errorInterface.parseError(encoded)!, {});
}

describe("Unit: ReductionExecutor", function () {
    describe("tryReadInboundMessageBlocksFailure", function () {
        it("reads every compared value out of the revert", function () {
            const expected = {
                submittedSnapshotInboundHash: factory.hash(),
                expectedTargetInboundHash: factory.hash(),
                runningInboundHash: factory.hash(),
                breakIndex: 1,
                submittedBlockCount: 3,
                failureReason: "hash-link" as const
            };

            expect(
                tryReadInboundMessageBlocksFailure(
                    inboundBlocksRevert({ ...expected, failureReason: 0 })
                )
            ).to.deep.equal(expected);
        });

        // a broken hash link and a broken height sequence both stop at the same
        // breakIndex, so the reason code is the only thing separating them
        it("maps each contract failure code to its reason", function () {
            const reasons = [0, 1, 2].map(
                (failureReason) =>
                    tryReadInboundMessageBlocksFailure(
                        inboundBlocksRevert({ failureReason })
                    )?.failureReason
            );

            expect(reasons).to.deep.equal([
                "hash-link",
                "height-sequence",
                "final-target"
            ]);
        });

        it("an unrecognised failure code reads as unknown, not a wrong reason", function () {
            expect(
                tryReadInboundMessageBlocksFailure(
                    inboundBlocksRevert({ failureReason: 99 })
                )?.failureReason
            ).to.equal("unknown");
        });

        it("a different custom error carries no inbound comparison", function () {
            const encoded = errorInterface.encodeErrorResult(
                "ErrorInvalidLatestState",
                []
            );
            const other = new CustomEvmError(
                errorInterface.parseError(encoded)!,
                {}
            );

            expect(tryReadInboundMessageBlocksFailure(other)).to.equal(
                undefined
            );
        });
    });

    describe("compareSubmittedInboundTarget", function () {
        // the chain derived a different target than we did, so our candidate
        // went stale between compute and submission
        it("on-chain target differs from ours → chain-target-moved", function () {
            const failure = tryReadInboundMessageBlocksFailure(
                inboundBlocksRevert({
                    expectedTargetInboundHash: factory.hash()
                })
            )!;

            expect(
                compareSubmittedInboundTarget(failure, factory.hash())
            ).to.equal("chain-target-moved");
        });

        // same target on both sides, so the target was never the problem - our
        // own supplied blocks failed to link
        it("on-chain target equals ours → local-chain-diverged", function () {
            const submittedTarget = factory.hash();
            const failure = tryReadInboundMessageBlocksFailure(
                inboundBlocksRevert({
                    expectedTargetInboundHash: submittedTarget
                })
            )!;

            expect(
                compareSubmittedInboundTarget(failure, submittedTarget)
            ).to.equal("local-chain-diverged");
        });
    });

    describe("getSyncedForkDisputes", function () {
        // a dispute commitment lands on-chain before our onDisputeCommitted
        // handler stores the struct. tryReduce firing in that gap used to
        // hit AgreementManager.getForkDisputes and throw "Missing Dispute in
        // storage" - getSyncedForkDisputes now recovers via
        // EventSyncService.ensureDisputesProcessed before reading storage.
        it("committed dispute missing locally → recovers via event replay, then reduces", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const maliciousPeerIndex = 2;

            await h.lifecycle.start(4, 2);
            const forkId = h.activeForkId!;

            // hold every reduction entry point so nothing auto-reduces -
            // we call tryReduce by hand below
            const race = await h.rpcStub.holdReductionRace(observerIndex);

            // drop the observer's incoming dispute-committed events before
            // any dispute happens: the other honest peers' commitments are
            // then genuinely never delivered here (not merely cleared from
            // storage, which the event-dedup cache would treat as already
            // processed and refuse to redeliver)
            const restoreEvents = await h.rpcStub.holdDisputeCommittedEvents(
                observerIndex,
                { passFirst: false }
            );

            // real invalid transition -> honest peers dispute + commit on-chain
            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedWait();
            // exclude the observer - its own onDisputeCommitted delivery is held
            await h.assert.dispute.committedWait({ peersIndices: [1, 3] });

            // wait out the kill period - before it expires tryReduce
            // returns undefined at the gate and never reaches recovery
            await waitFor(
                async () =>
                    h.execOnHost(
                        h.getPeer(observerIndex),
                        async (sm, a) => {
                            const { isExpired } =
                                await sm.reductionManager.isKillPeriodExpiredCached(
                                    a.forkId
                                );
                            return isExpired;
                        },
                        { forkId }
                    ),
                20000
            );

            const outcome = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    const commitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            args.forkId
                        );
                    const missingBefore = commitments.filter(
                        (c) => !sm.storage.disputes.getDispute(c)
                    );

                    let threw = "";
                    try {
                        await sm.reductionManager.tryReduce(args.forkId);
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }

                    const recoveredAll = commitments.every((c) =>
                        Boolean(sm.storage.disputes.getDispute(c))
                    );
                    // the point of the recovery: the disputes the reduction
                    // path now hands to reduce() are the WHOLE on-chain window,
                    // not the subset whose events happened to arrive
                    const reducedDisputes =
                        await sm.reductionManager.getSyncedForkDisputes(
                            args.forkId
                        );
                    return {
                        commitmentCount: commitments.length,
                        missingBeforeCount: missingBefore.length,
                        threw,
                        recoveredAll,
                        reducedDisputeCount: reducedDisputes.length
                    };
                },
                { forkId }
            );

            // sanity: we actually staged a genuinely-missing commitment
            expect(
                outcome.commitmentCount,
                "window must hold commitments"
            ).to.be.greaterThan(0);
            expect(
                outcome.missingBeforeCount,
                "at least one commitment must be missing locally before recovery"
            ).to.be.greaterThan(0);

            expect(outcome.threw, "tryReduce must recover, not throw").to.equal(
                ""
            );
            expect(
                outcome.recoveredAll,
                "every dispute must be recovered locally"
            ).to.equal(true);
            // the substantive check: reduction runs over the COMPLETE on-chain
            // window
            expect(
                outcome.reducedDisputeCount,
                "reduction must consume every commitment in the on-chain window"
            ).to.equal(outcome.commitmentCount);

            // the manual tryReduce already completed the reduction - release
            // the held race/event entry points without replaying stale work
            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);

            await h.assert.dispute.reductionCompletedWait({
                sourceForkId: forkId,
                peerIndices: [observerIndex, 1, 3]
            });
        });
    });
});
