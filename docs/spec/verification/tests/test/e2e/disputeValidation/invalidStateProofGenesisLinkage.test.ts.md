# invalidStateProofGenesisLinkage.test.ts

Test file: [test/e2e/disputeValidation/invalidStateProofGenesisLinkage.test.ts](../../../../../../../test/e2e/disputeValidation/invalidStateProofGenesisLinkage.test.ts)

## Overview

The single test proves that a failing `DisputeInvalidStateProof` submission slashes its submitter
and leaves its honest target untouched. `lifecycle.timeoutSetup(4)` produces natural timeout
disputes; the test confirms the honest disputer's dispute is a non-posted genesis dispute (empty
`stateProof`, `postedAuditingData === false`). Byzantine peer 2 fetches the real auditing data for
that empty proof via `dispute.getAuditingData`, corrupts
`genesisStateSnapshotData.stateMachineStateHash` so `keccak256(genesisStateSnapshotData)` no
longer equals the forkId (unlinked genesis), and applies the proof against the honest dispute
through `applyDisputeFraudProofs`. The oracles read the on-chain slash set directly: the honest
disputer must not appear in it, and the byzantine submitter must. Dispute resolution and reduction
are out of scope — the test ends at the slash assertions. The other permutations of the same plan
item (declared-vs-proven mismatch, mirror preflight) are separate scenarios and stay unassigned.

## Tests

- `unlinked genesisStateSnapshotData against a valid genesis dispute → submitter slashed, honest disputer survives`: REQ-ENFFP-1-BREACW.T1.P1
