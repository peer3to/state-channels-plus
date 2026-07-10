// State snapshot upload / update - subsystem domain (test/SUBSYSTEMS.md §8).
// Seam: StateManager.postStateSnapshot / prepareUpdate*.
//
// The snapshotData matrix holds only the POST-TIME REJECTS - tampers the
// StateSnapshotFacet itself reverts on. Tampers the facet ACCEPTS (bad
// state hash, omitted/injected participants, deflated withdrawals) commit
// on-chain and are caught downstream by dispute - they live in
// dispute-validation's snapshotData matrix.

import { defineDomain, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "snapshot-upload",
    matrices: {
        posting: variants({
            desc: "snapshot posting behavioral branches",
            // one traversed window, everyone-signed, no race = the baseline
            // post; a test tags only its deviation
            defaults: {
                disputeWindowsTraversed: "one",
                everyoneSigned: "yes",
                raceOutcome: "clean"
            },
            fields: {
                composition: [
                    "same-fork-only",
                    "fork-only",
                    // one multicall traversing the dispute window then advancing
                    "fork-plus-same-fork",
                    "no-op"
                ],
                // the prepareUpdateStateSnapshotFork while-loop: zero (fork not
                // disputed) / one / two-plus (catch up across A->B->C windows)
                disputeWindowsTraversed: ["zero", "one", "two-plus"],
                // no -> maybePostBlockOnChain posts the block too
                everyoneSigned: ["yes", "no"],
                // racy concurrent-poster cells (expect flaky)
                raceOutcome: [
                    "clean",
                    "RaceConditionSnapshotForkMismatch",
                    "RaceConditionBlockHeightTooOld",
                    "RaceConditionPendingInboundNotConsumed",
                    "RaceConditionReductionExpectationDoesntMatch"
                ]
                // no `poster` field: postStateSnapshot has no caller gate and
                // updateStateSnapshotSameFork has no msg.sender/turn check -
                // who posts is not a branch
            }
        }),

        snapshotData: variants({
            desc: "posted-snapshot tampers the facet REJECTS (post-time reverts)",
            fields: {
                // wrong -> ErrorInvalidStateSnapshot
                originForkId: ["correct", "wrong"],
                // -> ErrorOutboundMessageBlocksInvalid
                latestOutboundMessageBlockHash: ["valid", "not-in-chain"],
                latestOutboundMessageBlockHeight: ["valid", "mismatch"],
                // -> CantWithdrawMoreThanDeposits
                totalWithdrawals: ["valid", "inflated"]
            }
        })
    }
});

export const covers = domain.covers;
