# settledPathInboundGap.test.ts

Test file: [settledPathInboundGap.test.ts](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts)
Exercises: [DisputeValidationService.ts.md](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

No-fraud-proof checks inspect the honest auditors through the shared storage assertion. The deliberately malicious offender may already have been slashed and fully disposed; the test does not query its closed root. Both the healthy auditor and the lagging auditor remain required.

Real peers stage lost delivery separately from held event handling. Dispute audit recovers available inbound data or abstains without false fraud proofs, remains participating, and converges after release. The final-dispute case also checks the exact resulting fork. Posted empty inbound data cannot replace the local rebuild.

## Tests

- `recoverable inbound log → the auditor recovers it, audits for real and converges`: UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P1
- `final dispute over an unrecoverable gap → reduction deferred, then settles on the final dispute's fork`: UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P3
- `posted auditing data with an emptied inbound run → the auditor still rebuilds locally, nobody is slashed`: UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P4
