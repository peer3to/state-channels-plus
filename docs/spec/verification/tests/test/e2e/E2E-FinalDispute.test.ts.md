# E2E-FinalDispute.test.ts

Test file: [test/e2e/E2E-FinalDispute.test.ts](../../../../../../test/e2e/E2E-FinalDispute.test.ts)

## Overview

The suite stages threshold-final disputes (signed by the full participant set) on a real four-peer
channel via the harness helpers `submitFinalDispute` / `submitFinalDisputeFromStoredEvidence` and
resolves them on-chain with `resolveFinalDispute`. It asserts the final-dispute fast path in the
reduction stack: the exact final output (fork id and genesis timestamp) is installed without
running `validateDispute`, a queued ordinary reduction task released afterwards is a no-op (no
second `onSetState`; the completed reduction joins the final fork), duplicate completion via
`awaitReduction` is idempotent, and a peer whose `DisputeCommitted` delivery was withheld still
lands on the exact final output during reduction. A participant with a pending leave whose turn falls
after a direct final-dispute reduction has its leave re-homed onto the reduced fork and settled exactly once.
That case authors only after every honest peer reports the completed reduction and the honest mesh
is back in sync, because the reconnect after reduction outlasts one write's sync wait on a loaded farm.
A forced failure of final-dispute output
preparation propagates as a fatal host error while the peer stays `PARTICIPATING`. Oracles are
host-side queries (fork ids, genesis timestamps, completed-reduction lookups, status), event-spy
counts, and quiesced host errors. Ordinary (non-final) reduction submission outcomes are out of
scope (`E2E-ReductionManager`, `test/stateManager/ReductionManager.test.ts`).
The pending-leave case keeps the writer slot alive through the shared `keepAuthoringUntil` helper while the
exit snapshot lands, with the leaver marked AFK from its exit turn on.

## Tests

- `threshold-final dispute installs its exact output and can post the next snapshot`: REQ-ENFDIS-1-8CSA6B.T1.P4
- `direct final-dispute reduction re-homes a pending leave onto the reduced fork and settles it once`: REQ-DISPUTE-PIPE-3-PHE3SQ.T1.P19
- `threshold-final dispute makes a queued reduction timeout a no-op`: UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P4
- `duplicate completion is idempotent`: none
- `missed final-dispute delivery recovers the exact final output during reduction`: REQ-DIS-6-Y92H1M.T1.P16
- `failed final-dispute preparation propagates without abandoning participation`: REQ-DIS-6-Y92H1M.T1.P15
