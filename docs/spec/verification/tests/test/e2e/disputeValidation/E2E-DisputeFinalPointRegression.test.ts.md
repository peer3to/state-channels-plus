# E2E-DisputeFinalPointRegression.test.ts

Test file: [test/e2e/disputeValidation/E2E-DisputeFinalPointRegression.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-DisputeFinalPointRegression.test.ts)

## Overview

Alice and Bob post the chain anchor; Charlie then joins, and the honest history consumes his JOIN and is final past it with his signature. Alice posts a dispute with auditing data whose only hop jumps from the anchor above Charlie's final point, signed by Alice and Bob only, with an inbound head below Charlie's JOIN. The test checks that the chain accepts that walk, then waits for Charlie's node to store a `DisputeFinalPointRegression` and kill the dispute on chain. It decodes the applied proof: its snapshot is the hop's, and its final proof walks to a final point of Charlie's history past his JOIN. Only Alice is slashed.

## Tests

- `the colluders' posted-data dispute that hops from the chain anchor above seated Charlie's final point without his JOIN is killed on chain by Charlie's DisputeFinalPointRegression, and only its submitter is slashed`: REQ-FP-7-4DD0D7.T10.P14
