# timeout.test.ts

Test file: [test/e2e/disputeValidation/disputeInputFields/timeout.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts)

## Overview

Eight tests audit the `dispute.input.timeout` claim conditions end-to-end, mostly by letting a
natural timeout fire (a peer that never writes) while one disputer's `constructDispute` or posted
dispute is tampered. Linkage and schedule violations are each killed by the matching proof type:
wrong `timeout.blockHeight` → `TimeoutNotLinkedToLatestState`; wrong `timeout.participant` →
`TimeoutParticipantNotNext`; a timeout posted before its wait period elapses → `TimeoutTooEarly`
plus an on-chain slash of the disputer; a forced timeout for a block whose calldata is already
on-chain → `TimeoutCalldataPosted`, with the honest killers verified absent from the slash set.
The `TimeoutTooEarly` group also covers the upload-side race guard (revert with
`RaceConditionDisputeTimeoutWindowCreatedTooEarly` when the window predates the claimed deadline),
a false-positive guard where a valid timeout dispute stores zero dispute fraud proofs, and a
forged `TimeoutTooEarly` against a legitimate dispute that slashes its author. A lifecycle test
asserts a peer that left the channel never initiates a phantom timeout dispute. After the
permutation atomization, the per-check timeout failures, their proof families, their
mirrored-predicate agreements, the upload race guard, and the valid-timeout scenarios are
single-scenario IDs covered by the individual tests below.

The existing-window race case opens with a valid self-removal reason before constructing the timeout
whose deadline is later than that window. Its refusal therefore exercises the timeout admission guard.

## Tests

- `dispute.input.timeout.blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P15, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P15, REQ-DISPUTE-PIPE-5-RZZB48.T1.P11
- `dispute.input.timeout.participant != next writer → TimeoutParticipantNotNext`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P16, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P16, REQ-DISPUTE-PIPE-5-RZZB48.T1.P12
- `existing window predates timeout deadline → upload reverts with race-condition guard`: REQ-DIS-10-SAHJBN.T1.P21
- `dispute.input.timeout posted before wait period elapses → honest peers store TimeoutTooEarly`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P17, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P17, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P14, REQ-DISPUTE-PIPE-5-RZZB48.T1.P13, REQ-DIS-3-C4KYSF.T1.P6, REQ-DIS-10-SAHJBN.T1.P5
- `valid timeout dispute → no TimeoutTooEarly fraud proof stored (false-positive guard)`: REQ-DIS-10-SAHJBN.T1.P1, REQ-DISPUTE-PIPE-5-RZZB48.T1.P23
- `forged TimeoutTooEarly against a legitimate timeout dispute → proof author slashed`: none
- `leaver does not dispute a timeout after leaving the channel`: none
- `dispute.input.timeout.blockHeight = block whose calldata is on-chain; isForced=true → TimeoutCalldataPosted`: REQ-ENFFP-1-BREACW.T1.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P19, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P18, REQ-DISPUTE-PIPE-5-RZZB48.T1.P10
