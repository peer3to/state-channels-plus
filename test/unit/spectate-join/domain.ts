// Spectate -> sync -> join - subsystem domain (test/SUBSYSTEMS.md §11).
// Seam: SpectateService.applySyncResponse + StateManager.joinChannel /
// maybeInitiateForceJoinDispute.
//
// Reach note (DOMAIN_REVIEW.md): every payloadVerification option is a real
// abort branch, but only three are reachable with today's stubs
// (stubSpectateStaleProof, stubSpectateJunkPayload, the persistSyncPayload
// conflict driver). The rest need new NAMED tamper strategies mutating
// generateSyncPayload output on the serving peer (the tamperStrategies.ts
// pattern). The late aborts that wrap contract staticcalls
// (milestone-verify, balance-invariant, staticcall-multicall) are hard to
// hit in isolation - failing ONLY the target check without tripping an
// earlier one; cover representatives before insisting on all.

import { defineDomain, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "spectate-join",
    matrices: {
        sync: variants({
            desc: "sync payload verification (applySyncResponse)",
            fields: {
                // spectating = no fork requested; requested = catch up to a specific fork
                syncMode: ["spectating", "requested-fork"],
                disputeWindowsInPayload: ["zero", "one", "two-plus"],
                // ok + the abort points of applySyncResponse, in check order
                payloadVerification: [
                    "ok",
                    "decode-fail",
                    "rtt-exceeded",
                    "window-not-expired",
                    "multiple-needing-reduce",
                    "reduced-fork-mismatch",
                    "final-genesis-mismatch",
                    "onchain-height-exceeds-proved",
                    // the outbound chain is checked twice - two distinct branches
                    "outbound-onchain-to-genesis-mismatch",
                    "outbound-genesis-to-finalized-mismatch",
                    // the fork gate differs per sync mode - two branches
                    "spectating-fork-not-disputed",
                    "requested-fork-mismatch",
                    "milestone-verify-fail",
                    "finalized-state-hash-mismatch",
                    "balance-invariant-fail",
                    "staticcall-multicall-fail",
                    "persist-conflict",
                    "replay-fail",
                    // requested mode: proved height doesn't reach the request
                    "requested-blockheight-mismatch"
                ],
                // participant/pending peers only punish the peer; a spectator
                // aborts its state manager
                aborterStatus: ["participant-or-pending", "spectator"]
            }
        }),

        // mostly retag targets: E2E-Spectate + E2E-JoinChannelRaceConditions
        // already cover all timings and two of the race errors; the one
        // net-new cell is RaceConditionJoinChannelExpired
        join: variants({
            desc: "promotion paths and races",
            fields: {
                joinPath: ["none", "join-channel", "force-inbound-join"],
                joinTiming: [
                    "quiet",
                    "during-dispute",
                    "racing-snapshot-update",
                    "concurrent-joiner"
                ],
                // failures revert to SYNCED + abort
                joinRaceOutcome: [
                    "clean",
                    "RaceConditionJoinChannelExpired",
                    "SnapshotMismatch",
                    "ForkDisputed"
                ]
            }
        })
    }
});

export const covers = domain.covers;
