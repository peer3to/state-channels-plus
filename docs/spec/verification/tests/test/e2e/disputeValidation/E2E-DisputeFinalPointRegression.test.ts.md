# E2E-DisputeFinalPointRegression.test.ts

Test file: [test/e2e/disputeValidation/E2E-DisputeFinalPointRegression.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-DisputeFinalPointRegression.test.ts)

## Overview

Alice and Bob post the chain anchor; Charlie then joins, and the honest history consumes his JOIN and is final past it with his signature. Alice posts a dispute with auditing data whose only hop jumps from the anchor above Charlie's final point, signed by Alice and Bob only, with an inbound head below Charlie's JOIN. The test checks that the chain accepts that walk, then waits for Charlie's node to store a `DisputeFinalPointRegression` and kill the dispute on chain. It decodes the applied proof: its snapshot is the hop's, and its final proof walks to a final point of Charlie's history past his JOIN. Only Alice is slashed.

A second case lets both disputes reach one window: Charlie's kill lands with his own dispute, the window expires, and the reduction installs a successor fork whose genesis state continues Charlie's latest state with his balance and without the slashed Alice and Bob; exactly Alice and Bob are slashed on chain. Charlie's dispute does not list the slashes his kill lands first, so it is not final at upload: it takes the normal window, and the reduction at window end removes Alice and Bob. A further case omits the auditing data and lists Charlie in the slash list; Charlie's node kills the dispute with `DisputeOnChainSlashesNotSubset` and only Alice is slashed. A third case has Charlie post his honest dispute; Alice applies a regression and a conflict counter built from side-chain final points below his JOIN, both checked first as valid walks the chain predicates refuse. The chain keeps Charlie's dispute committed and slashes Alice.

## Tests

- `the colluders' posted-data dispute that hops from the chain anchor above seated Charlie's final point without his JOIN is killed on chain by Charlie's DisputeFinalPointRegression, and exactly Alice and Bob, who signed both final points, are slashed`: REQ-FP-7-4DD0D7.T10.P14, REQ-FP-7-4DD0D7.T11.P21
- `the colluders' bypass dispute, and Charlie's regression kill does not fit his per-transaction calldata limit while his own upload does -> he stores the counter but sends no kill, his own dispute still lands in the window, and nobody is slashed`: REQ-FP-7-4DD0D7.T11.P23
- `the colluders' bypass dispute and Charlie's honest dispute share one window: Charlie kills the bypass, and after the window expires the reduction continues Charlie's history on the successor fork, with exactly Alice and Bob, who signed both final points, slashed`: REQ-FP-7-4DD0D7.T10.P25, REQ-DIS-13-SNWKMF.T1.P5
- `the colluders' dispute omits its auditing data and lists seated Charlie in onChainSlashes, which drops him from the set that must sign its hop -> Charlie's DisputeOnChainSlashesNotSubset kills it on chain, and only its submitter is slashed`: REQ-FP-7-4DD0D7.T10.P22
- `the colluders offer side-chain final points below seated Charlie's JOIN against his honest dispute -> the chain refuses both the regression and the conflict counter, the kill attempt slashes its sender, and Charlie's dispute stays committed`: REQ-FP-7-4DD0D7.T10.P23
