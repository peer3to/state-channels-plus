# E2E-DisputeConflictsWithFinalState.test.ts

Test file: [test/e2e/disputeValidation/E2E-DisputeConflictsWithFinalState.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-DisputeConflictsWithFinalState.test.ts)

## Overview

Audits conflicting final heads from real peers, including a pending auditor. Checks conflict counters and the resulting dispute kills and slashes.

## Tests

- `the colluders' omitted-data dispute that forks right after the chain anchor is killed on chain by pending Charlie's DisputeConflictsWithFinalState from his own final state, and its submitter is slashed`: REQ-FP-7-4DD0D7.T5.P20, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P195
- `control: the participants' real history from the chain anchor, audited by a pending auditor that holds no conflicting final block and lacks the anchor state → no conflict counter, the missing replay state stays fatal`: REQ-SP-9-RNXP56.T4.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P38
