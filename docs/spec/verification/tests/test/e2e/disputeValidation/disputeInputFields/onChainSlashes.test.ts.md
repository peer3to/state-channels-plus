# onChainSlashes.test.ts

Test file: [test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts)

## Overview

Three tests attack `dispute.input.onChainSlashes`. First, a disputer appends an address that was
never slashed on-chain; the dispute commits, an honest peer kills it, and honest peers store a
`DisputeOnChainSlashesNotSubset` proof (resolution runs without asserting attacker removal, since
the winning counter-dispute is not controlled). Second, a participant is genuinely slashed and
evicted through a full dispute-and-resolve cycle, then a later dispute lists that address even
though it is no longer in the snapshot's participants — killed as `InvalidDisputeReason`. That dispute
commits without auditing data: its list removes the slashed member from the historic threshold set, so
no data is owed whether or not the member's JOIN is still walkable from the anchor. Third, a
dispute lists 8 random addresses (more than `maxSlashCount`); the oracle is that reduction must
not out-of-bounds panic, the fork resolves, and `slashedOnChainExactly` pins the final on-chain
slash set to exactly the two real offenders. Each test covers one side of the subset rule; after
the permutation atomization the slash-subset and stated-reason check failures, their proof
families, their mirrored-predicate agreements, and the adversarial-input reduction case are
single-scenario IDs covered below.

## Tests

- `dispute.input.onChainSlashes includes address not slashed on-chain → DisputeOnChainSlashesNotSubset`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P12, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P7, REQ-DISPUTE-PIPE-5-RZZB48.T1.P8
- `dispute.input.onChainSlashes contains address not in latestStateSnapshot participants → InvalidDisputeReason`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P20, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P13, REQ-DISPUTE-PIPE-5-RZZB48.T1.P16, REQ-DIS-1-XAJ1VA.T1.P5
- `dispute.input.onChainSlashes has > maxSlashCount distinct addresses → reduce must not OOB-panic, both offenders slashed`: none
