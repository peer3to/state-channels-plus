// Participant lifecycle - subsystem domain (test/SUBSYSTEMS.md §12,
// highest-priority new suite).
// Seam: EventHandler.onStateSnapshotUpdated / handleChannelClose +
// StateManager.startMaybeExitOnChain / computeParticipantChanges.
//
// Two matrices: snapshot-driven status transitions (EventHandler's branches)
// vs the shapes a leave can take (StateManager side) - they answer different
// questions and mix badly in one list.

import { defineDomain, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "participant-lifecycle",
    matrices: {
        snapshotTransitions: variants({
            desc: "status transitions driven by on-chain snapshots (EventHandler)",
            fields: {
                transition: [
                    // left the channel
                    "participating-to-synced",
                    // 0 participants remain
                    "channel-close"
                ],
                // the onStateSnapshotUpdated unknown-snapshot branch (the
                // PR 377 fatal-throw race lives here)
                unknownSnapshotStatus: [
                    "synced-resync",
                    "signer-removed-abort",
                    "else-fatal"
                ]
            }
        }),

        leaveShapes: variants({
            desc: "the shapes a leave / set change can take (StateManager)",
            fields: {
                leavePath: [
                    // everyone signed -> snapshot post
                    "cooperative",
                    // forceExit -> self-removal dispute
                    "self-removal-dispute",
                    // slashed by others' dispute
                    "removed-by-dispute"
                ],
                leaverBehavior: ["stops-signing", "does-not-dispute"],
                setChangeShape: [
                    "single-leaver",
                    "multi-leavers-across-milestones",
                    "leaver-plus-pending-joiner",
                    "last-participant-close"
                ],
                // N = 1, 2 - induction covers N
                repetition: ["join-leave", "join-leave-rejoin"]
            }
        })
    }
});

export const covers = domain.covers;
