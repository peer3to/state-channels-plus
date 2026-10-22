# E2E-DisputeFinalPointRegression.test.ts

Test file: [test/e2e/disputeValidation/E2E-DisputeFinalPointRegression.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-DisputeFinalPointRegression.test.ts)

## Overview

Seats a joiner whose JOIN the honest history consumes and finalizes, then has the original participants post a dispute that hops from the chain anchor above the joiner's final point without the JOIN, with its auditing data. Checks that the joiner's node builds `DisputeFinalPointRegression`, the chain kills the dispute, and only its submitter is slashed.

## Tests

- `the colluders' posted-data dispute that hops from the chain anchor above seated Charlie's final point without his JOIN is killed on chain by Charlie's DisputeFinalPointRegression, and only its submitter is slashed`: REQ-FP-7-4DD0D7.T10.P10, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P223
