# E2E-DisputeConflictsWithFinalState.test.ts

Test file: [test/e2e/disputeValidation/E2E-DisputeConflictsWithFinalState.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-DisputeConflictsWithFinalState.test.ts)

## Overview

Audits conflicting final heads from real peers, including a pending auditor. Checks conflict counters and the resulting dispute kills and slashes.

## Tests

- `the colluders' omitted-data dispute that forks right after the chain anchor is killed on chain by pending Charlie's DisputeConflictsWithFinalState from his own final state, and nobody is slashed: the conflicting blocks are tail blocks of the colluders' last milestone, no final point of theirs`: REQ-FP-7-4DD0D7.T5.P20, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P195
- `the colluders' omitted-data dispute also carries a forged final point at pending Charlie's final height, authored by colluder 1 and confirmed by colluder 2 but not signed by the disputer → Charlie's DisputeConflictsWithFinalState kill lands on chain and slashes exactly colluders 1 and 2, who signed both conflicting final points`: REQ-FP-7-4DD0D7.T11.P22
- `control: the participants' real history from the chain anchor, audited by a pending auditor that holds no conflicting final block and lacks the anchor state → no conflict counter, the tail is not judged: no throw, no counter, true`: REQ-SP-9-RNXP56.T4.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P38
