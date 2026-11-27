# DisputeManagerLocalFirst.test.ts

Test file: [test/unit/DisputeManagerLocalFirst.test.ts](../../../../../../test/unit/DisputeManagerLocalFirst.test.ts)
Exercises: [DisputeManager.ts](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md)

## Overview

The suite builds peer 0's own dispute with `fetchConstructedDispute` on a Math session and watches
the `isAuditingDataOmissionAllowed` probe on both sides with a record-only observer: the
local diamond's reads and the chain manager's reads, answers, failures and error codes. The staged
states are a late joiner whose head milestone still waits for its signature (the chain says "not
final") and a plain three-peer start (the chain says "final"). Failure injection makes the next chain read fail as a
transport error.

The oracles are `dispute.postedAuditingData`, the auditing-data hash committed in the dispute
input (it must equal the hash of the auditing data that was built), the observed local and chain
read counts and answers, and the error thrown by construction. In every case the chain is read
once and the local diamond is not read; the slashed-participants cases check the same for the on-chain
slashes.

## Tests

- `chain not final (a late joiner's signature is missing) -> one chain read, no mirror read, the auditing data is posted`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P10
- `chain final -> one chain read, no mirror read, the auditing data is left out`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P13
- `chain RPC refuses the connection -> construction throws it, no mirror read`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P15, REQ-MIRROR-6-0WSB4V.T2.P5
- `chain reads proven -> the on-chain slashed participants are read from the chain, not the mirror`: UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P25, REQ-MIRROR-6-0WSB4V.T3.P7
- `the on-chain slashed participants are read from the chain, not the mirror`: REQ-MIRROR-6-0WSB4V.T1.P7
