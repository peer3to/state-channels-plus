# latestStateSnapshotHash.test.ts

Test file: [test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts)
Exercises: [DisputeValidationService](../../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

Nine cases cover empty, unfinalized genesis-zero milestone, and threshold-final milestone proofs across direct and calldata-posted disputes. Synced and intentionally isolated auditors prove the latest snapshot hash remains bound to the authoritative proof state. The synced empty-proof and milestone-only no-calldata cases construct the honest replacement after the auditor observes the kill, so a pre-kill output cannot become final under the smaller post-kill threshold.

## Tests

- `[no calldata] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T8.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P95
- `[no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T8.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P96
- `[no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 3)`: REQ-FP-7-4DD0D7.T8.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P97
- `[calldata posted] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T8.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P98
- `[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`: REQ-FP-7-4DD0D7.T8.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P99
- `[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 1)`: REQ-FP-7-4DD0D7.T8.P6, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P100
- `[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 0)`: REQ-FP-7-4DD0D7.T8.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P101
- `E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (2) unfinalized genesis block-0 milestone — last block commits to hash > auditor peer 2 disconnected — local storage genesis-only, pipeline still kills > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)`: REQ-FP-7-4DD0D7.T8.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P102
- `E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (2) unfinalized genesis block-0 milestone — last block commits to hash > peers not synced — auditor peer 2 disconnected (proof replay held) > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)`: REQ-FP-7-4DD0D7.T8.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P103
