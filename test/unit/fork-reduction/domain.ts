// Fork reduction & finalization - subsystem domain (test/SUBSYSTEMS.md §9).
// Seam: StateManager.tryReduce / performReduction + the reduceLocally
// single-flight convergence and setForkIfLatestAndCurrent (both landed with
// PR 382 - EventHandler.ts:849).
//
// The net-new value of this domain is pinning PR 382's winner/loser
// convergence with a PER-PEER local reduced-genesis assertion - the existing
// fourPeersDisputeResolutionAndSnapshotUpdateWait scenario only checks the
// on-chain snapshot, not each loser's local state.

import { defineDomain, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "fork-reduction",
    matrices: {
        reduction: variants({
            desc: "reduce / finalize / challenge branches",
            // happy-path defaults: a reduction test tags only its deviation;
            // the default cell is covered implicitly (and the report flags a
            // field where ONLY the default is exercised).
            defaults: {
                baseFork: "original",
                reducedOutput: "normal",
                reductionValidity: "valid",
                raceOutcome: "clean"
            },
            fields: {
                // none = no dispute committed in the window -> the reducer
                // self-disputes first, then reduces (still 1 dispute on-chain)
                disputesInWindow: [
                    "none-self-dispute-first",
                    "one",
                    "two-plus"
                ],
                // already-reduced = the fork being reduced has a genesis that
                // is itself a prior reduction's output (fork A -> B -> C)
                baseFork: ["original", "already-reduced"],
                // genesis case = no blocks in reducedOutput
                reducedOutput: ["normal", "genesis-case"],
                // invalid -> challengeDisputeReduction + disconnect reducer.
                reductionValidity: ["valid", "invalid-challenge"],
                finalityAtObservation: ["challenge-open", "expired"],
                raceOutcome: [
                    "clean",
                    "RaceConditionReductionExpectationDoesntMatch"
                ]
            }
        })
    }
});

export const covers = domain.covers;
