// Timeouts - subsystem domain (test/SUBSYSTEMS.md §10).
// Seam: StateManager.tryTimeoutParticipant / createTimeOutDispute.
//
// This is the CONSTRUCTING side (does our timeout dispute detect and build
// the struct right). The AUDITING side of a received Timeout struct is
// dispute-validation's `timeout` matrix - same struct, different seam.
// A FORGED signature has no constructing-side branch (createTimeOutDispute
// copies whatever signature is stored) - it lives on the auditing seam.
//
// The struct fields have no direct host-side read today (query.getTimeout
// returns only {isForced, participant}) - assert them via the resulting
// dispute proof type (TimeoutCalldataPosted vs TimeoutThreshold), or extend
// getTimeout to return the full struct.

import { defineDomain, product, variants } from "../framework/domain";

export const domain = defineDomain({
    subsystem: "timeouts",
    matrices: {
        detection: variants({
            desc: "tryTimeoutParticipant branches",
            fields: {
                // note: all four early exits share one observable (no timeout,
                // no dispute) - the cells differ by setup, not by outcome
                earlyExit: [
                    "self",
                    "not-participant",
                    "block-exists",
                    "wait-not-elapsed"
                ],
                // the previous block's calldata may grant the leader extra
                // time (this is the data-availability service's only
                // timeout-visible behavior - it has no domain of its own)
                previousCalldataRace: [
                    "none",
                    "scheduled-defer",
                    "extra-time-granted"
                ],
                // forced = calldata posted on-chain but the block is junk
                outcome: ["no-timeout", "normal", "forced"]
            }
        }),

        // what createTimeOutDispute writes into the struct - these two fields
        // interact (the signature forfeits the extra time only when the
        // calldata claim is checked)
        structFields: product({
            desc: "TimeoutStruct fields as built",
            axes: {
                previousBlockProducerPostedCalldata: ["true", "false"],
                participantSignatureOnPreviousBlock: ["present", "absent"]
            }
        })
    }
});

export const covers = domain.covers;
