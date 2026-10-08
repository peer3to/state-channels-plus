# disputeAuditingDataHash.test.ts

Test file: [test/e2e/disputeValidation/disputeInputFields/disputeAuditingDataHash.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/disputeAuditingDataHash.test.ts)

## Overview

Negative-control test for `dispute.input.disputeAuditingDataHash` on the no-calldata path: the
on-chain validator audits the field only when calldata is posted with the upload, so a tampered
hash must be silently ignored. Peer 0's `constructDispute` is stubbed with
`DisputeTampering.tamperAuditingDataHash` (auto-restored, not marked malicious); peer 1's
double-sign block provokes the dispute. The oracles assert the dispute is initiated and committed,
honest peers store the underlying `BlockDoubleSign` block fraud proof against peer 1, no honest
peer fires `onDisputeKilled` during a 3-second quiet window (no `DisputeInvalid*` proof against
the tampered dispute), and resolution excludes the double-signer, leaving 2 participants. The
calldata-path counterpart, where the upload itself reverts with `ErrorAuditingDataHashMismatch`,
lives in `disputeValidation/uploadRevert/disputeAuditingDataHash.test.ts`. After the permutation
atomization, this negative control is the valid-case demonstration that kill decisions stay
grounded in the canonical Solidity predicates (no false kill on a field the path never audits).

## Tests

- `no calldata: dispute.input.disputeAuditingDataHash tampered → dispute commits, no DisputeInvalidStateProof or other audit-data fraud proof`: INV-DVP-2-Q13TVQ.T1.P1
