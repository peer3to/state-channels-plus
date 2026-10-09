# notLatestState.test.ts

Test file: [test/e2e/disputeValidation/notLatestState.test.ts](../../../../../../../test/e2e/disputeValidation/notLatestState.test.ts)

## Overview

The single test targets the truncated-suffix check: a disputer must present its own latest signed
state. After `preDisputeSetup` the channel advances three more transitions (peer 0 has signed up
to block 4), then peer 0's `constructDispute` is stubbed to call
`truncateStateProofToHeight(dispute, 2)`, so the uploaded dispute claims block 2 as latest while
peer 0's signature exists on block 4. Peer 1's double-sign block provokes the dispute. The oracles
assert peer 0's dispute is initiated and committed without auditing data, at least one honest peer
fires `onDisputeKilled`, honest peers store a `DisputeNotLatestState` dispute fraud proof, and the
fork resolves to a successor. What evidence the killer used to prove the newer signed block is not
inspected. After the permutation atomization, the disputer-latest-state check failure, its proof
family, and its mirrored-predicate agreement exist as single-scenario IDs, and this test covers
them in full.

## Tests

- `dispute.input.stateProof truncated below disputer's last signed block → DisputeNotLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P14, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P9, REQ-DISPUTE-PIPE-5-RZZB48.T1.P1
