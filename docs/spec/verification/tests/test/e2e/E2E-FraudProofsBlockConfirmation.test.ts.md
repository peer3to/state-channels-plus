# E2E-FraudProofsBlockConfirmation.test.ts

Test file: [test/e2e/E2E-FraudProofsBlockConfirmation.test.ts](../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)

## Overview

The suite drives `onBlockConfirmation` under the live `BlockValidationStrategy` on real
multi-peer sessions, feeding blocks through the harness ingest RPC
(`ingestBlockConfirmationWait`) or through byzantine helpers that craft and gossip invalid blocks
from a real peer. One arm covers non-fault flows: a queued future block that is recovered through
the on-chain calldata path and executes only after its predecessor, queued and stored duplicates
(no double sign, trusted-timestamp merge without replaying the transition), and stray
non-participant signatures that are stripped with the supplying peer blacklisted while the block
itself survives. The other arm drives each objective fault class — double sign, wrong genesis,
unexpected next leader, invalid timestamp, broken inbound message chain, forged inbound message,
`applyTransaction` failure, and stateSnapshotHash mismatch — and asserts the dispute is initiated
and committed, every honest peer stored a fraud proof of the exact `FraudProofType` against the
malicious peer, and after on-chain dispute resolution only the honest peers remain in sync; the
snapshot-hash case additionally proves the honest VMs roll back the aborted transition. Oracles
are query-RPC reads of storage/queue/blacklist state, contract-instance state sums, event spies,
and the shared dispute/storage assertion helpers. Contract-side proof adjudication internals and
the validation predicate chain (unit `ValidationService` suite) are out of scope. Fault paths with
distinct executable oracles have declaration-sized permutations under
`REQ-BLOCK-PIPE-8-N529VH.T1`. Fault-class tests whose dispute resolution
removes the offender on-chain may also carry valid-application permutations from the
`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG` proof families (the predicate-only Foundry suite never
applies a proof); the remaining contract-side handler permutations (`REQ-FP-2-CH4DA1.T1`._`,
`REQ-ENFFP-_`) remain with the contract suites.

## Tests

- `queued future block accepts later calldata event and executes after predecessor`: REQ-BLOCK-PIPE-4-CF52J6.T1.P1, REQ-RPC-4-9VX0B9.T1.P2, REQ-GOSSIP-4-J5Z4DF.T1.P23
- `queued duplicate block does not fall through to double sign`: INV-FIN-2-MK27J6.T1.P7
- `stored duplicate merges trusted timestamp without replaying transition`: REQ-BLOCK-PIPE-1-SS24D1.T1.P2, REQ-RPC-4-9VX0B9.T1.P1, REQ-RPC-4-9VX0B9.T1.P5
- `stored duplicate drops a new signature from a non-participant without dropping or replaying the block`: REQ-BLOCK-PIPE-1-SS24D1.T1.P5, INTEGRATION-TEST-RPC-6-009EGG.P6, INTEGRATION-TEST-RPC-6-009EGG.P8
- `fresh block with a non-participant signature applies after dropping it`: REQ-BLOCK-PIPE-11-DCHAJ2.T1.P2, REQ-BLOCK-PIPE-11-DCHAJ2.T1.P3
- `double sign → BlockDoubleSign`: REQ-BLOCK-PIPE-8-N529VH.T1.P1, INV-FIN-2-MK27J6.T1.P4, UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P1
- `wrong genesis → WrongGenesis`: REQ-BLOCK-PIPE-8-N529VH.T1.P5, UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P7
- `unexpected next leader → BlockInvalidStateTransition`: REQ-FIN-5-DH29VZ.T1.P4
- `invalid timestamp → InvalidTimestamp`: REQ-BLOCK-PIPE-8-N529VH.T1.P6, UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P8
- `broken inbound chain → BlockInvalidStateTransition`: REQ-BLOCK-PIPE-8-N529VH.T1.P8
- `forged inbound message → ForgedInboundMessageBlock`: REQ-BLOCK-PIPE-8-N529VH.T1.P7, UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P9
- `applyTransaction failure → BlockInvalidStateTransition`: REQ-BLOCK-PIPE-8-N529VH.T1.P9
- `stateSnapshotHash mismatch → BlockInvalidStateTransition`: REQ-BLOCK-PIPE-8-N529VH.T1.P4
