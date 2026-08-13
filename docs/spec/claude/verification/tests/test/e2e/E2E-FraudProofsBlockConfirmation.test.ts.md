# test/e2e/E2E-FraudProofsBlockConfirmation.test.ts — Test Report

> **Test file:** [test/e2e/E2E-FraudProofsBlockConfirmation.test.ts](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [BlockValidationStrategy.ts](../../../../implementation/source/src/stateManager/validationStrategy/BlockValidationStrategy.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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
the validation predicate chain (unit `ValidationService` suite) are out of scope. The formerly
bundled "each fault class" permutations are now split per class, so each fault-class test carries
its own [`REQ-BLOCK-PIPE-8-N529VH.T1`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh.t1) scenario; contract-side handler permutations ([`REQ-FP-2-CH4DA1.T1`](../../../../specification/disputes/fraud-proofs.md#req-fp-2-ch4da1.t1)._`,
`REQ-ENFFP-_`) remain with the contract suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                               | Covers                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Block Fraud Proofs > queued future block accepts later calldata event and executes after predecessor`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L15) (line 15)            | [`REQ-BLOCK-PIPE-4-CF52J6.T1.P1`](../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6.t1.p1), [`REQ-BCP-1-X3J4KY.T1.P1`](../../../../implementation/views/architecture/sdk/block-confirmation-pipeline.md#req-bcp-1-x3j4ky.t1.p1) |
| [`E2E: Block Fraud Proofs > queued duplicate block does not fall through to double sign`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L171) (line 171)                              | [`INV-FIN-2-MK27J6.T1.P7`](../../../../specification/protocol-model/finality.md#inv-fin-2-mk27j6.t1.p7)                                                                                                                                                               |
| [`E2E: Block Fraud Proofs > stored duplicate merges trusted timestamp without replaying transition`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L209) (line 209)                   | [`REQ-BLOCK-PIPE-1-SS24D1.T1.P2`](../../../../specification/block-progression/block-processing.md#req-block-pipe-1-ss24d1.t1.p2)                                                                                                                                      |
| [`E2E: Block Fraud Proofs > stored duplicate drops a new signature from a non-participant without dropping the block`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L275) (line 275) | [`REQ-BLOCK-PIPE-1-SS24D1.T1.P5`](../../../../specification/block-progression/block-processing.md#req-block-pipe-1-ss24d1.t1.p5)                                                                                                                                      |
| [`E2E: Block Fraud Proofs > fresh block with a non-participant signature applies after dropping it`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L327) (line 327)                   | —                                                                                                                                                                                                                                                                     |
| [`E2E: Block Fraud Proofs > double sign → BlockDoubleSign`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L395) (line 395)                                                            | [`REQ-BLOCK-PIPE-8-N529VH.T1.P1`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh.t1.p1), [`INV-FIN-2-MK27J6.T1.P4`](../../../../specification/protocol-model/finality.md#inv-fin-2-mk27j6.t1.p4)                             |
| [`E2E: Block Fraud Proofs > wrong genesis → WrongGenesis`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L412) (line 412)                                                             | [`REQ-BLOCK-PIPE-8-N529VH.T1.P5`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh.t1.p5)                                                                                                                                      |
| [`E2E: Block Fraud Proofs > unexpected next leader → BlockInvalidStateTransition`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L431) (line 431)                                     | [`REQ-FIN-5-DH29VZ.T1.P4`](../../../../specification/protocol-model/finality.md#req-fin-5-dh29vz.t1.p4)                                                                                                                                                               |
| [`E2E: Block Fraud Proofs > invalid timestamp → InvalidTimestamp`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L449) (line 449)                                                     | [`REQ-BLOCK-PIPE-8-N529VH.T1.P6`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh.t1.p6)                                                                                                                                      |
| [`E2E: Block Fraud Proofs > broken inbound chain → BlockInvalidStateTransition`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L469) (line 469)                                       | —                                                                                                                                                                                                                                                                     |
| [`E2E: Block Fraud Proofs > forged inbound message → ForgedInboundMessageBlock`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L491) (line 491)                                       | [`REQ-BLOCK-PIPE-8-N529VH.T1.P7`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh.t1.p7)                                                                                                                                      |
| [`E2E: Block Fraud Proofs > applyTransaction failure → BlockInvalidStateTransition`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L513) (line 513)                                   | —                                                                                                                                                                                                                                                                     |
| [`E2E: Block Fraud Proofs > stateSnapshotHash mismatch → BlockInvalidStateTransition`](../../../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts#L534) (line 534)                                 | [`REQ-BLOCK-PIPE-8-N529VH.T1.P4`](../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh.t1.p4), [`INV-BCP-2-BVPQF4.T1.P1`](../../../../implementation/views/architecture/sdk/block-confirmation-pipeline.md#inv-bcp-2-bvpqf4.t1.p1) |
