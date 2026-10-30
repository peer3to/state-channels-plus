# E2E-AuditingDataAvailability.test.ts

Test file: [test/e2e/disputeValidation/E2E-AuditingDataAvailability.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-AuditingDataAvailability.test.ts)

## Overview

Audits omitted and posted data from participant and pending peers with different local holdings. Checks omission routes, missing-data counters, reconstructed latest state and balance validation.

E11 staging installs pending-inbound inclusion controls before the anchor block and applies independent blind-peer controls concurrently. Snapshot publication still precedes the pending join, and both precede the tail; replay, availability, and signature oracles are unchanged.

Blind pending-auditor staging persistently disconnects the auditor before the participants finalize the withheld head. This excludes both gossip and sync delivery; the chain join and real audit still run, and tests retain the assertion that the auditor never finalized that head. The returned restoration handle explicitly reconnects it.

The anchored unfinalized-tail fixture uses a 10-second `p2pTime` for snapshot
posting and pending-join setup before tail authoring. Agreement-time validation
and the auditing-data assertions remain unchanged. Runtime verification of this
timing adjustment is pending.

## Tests

- `E11: a participant holding only the anchor state replays the unfinalized tail and accepts the dispute`: REQ-SP-9-RNXP56.T6.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P79
- `E11: a pending participant holding only the anchor state replays the unfinalized tail and accepts the dispute`: REQ-SP-9-RNXP56.T6.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P80
- `E12: with no anchor in the last milestone, a participant and a pending participant that never received the tail reconstruct the latest state from their own final head and accept the omitted-data dispute`: REQ-SP-9-RNXP56.T6.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P81
- `E13: a participant never signed → the availability counter kills the dispute before the later latest-state check`: REQ-FP-7-4DD0D7.T7.P15, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P82
- `E13: the pending participant never signed → the availability counter kills the dispute before the later latest-state check`: REQ-FP-7-4DD0D7.T7.P16, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P83
- `E14: auditors audit a valid dispute with the posted data and accept it`: REQ-SP-9-RNXP56.T6.P10, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P84
- `E14: the posted latest snapshot breaks the balance invariant; a pending auditor without a final block at the forged head → DisputeInvalidBalanceInvariant kills the dispute, then DisputeConflictsWithFinalState kills the colluders' real-head disputes`: REQ-FP-7-4DD0D7.T7.P17, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P85
