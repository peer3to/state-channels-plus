# test/unit/FraudProofService.test.ts — Test Report

> **Test file:** [test/unit/FraudProofService.test.ts](../../../../../../test/unit/FraudProofService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [FraudProofService.ts](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs the live strategy's `FraudProofService` builders host-side on a live harness
channel through two validation probes: `probeInvalidStateTransitionProof` returns the stored fraud
proof (or `null` when the builder returns none) and `probeInvalidTimestampProof` returns the built
timestamp proof. Blocks are crafted with the test factory and signed by real channel peers. The
probe option `predecessorHeight` passes the stored block at that height, with its snapshot and
state, as the explicit predecessor, as dispute replay does (`-1` passes the fork genesis); without
it the builder reads storage, as live gossip does.

The live transition cases show that a non-leader block linked to stored block 1 yields a
`BlockInvalidStateTransition` proof naming the block's author whose previous block is block 1, and
that a block whose `previousBlockHash` names no stored block yields no proof. The dispute-replay
cases show that a passed predecessor is the proof's base even for a block whose
`previousBlockHash` is random: the previous block is block 1, the previous snapshot is at height 1,
and the packed state is the stored state of that snapshot; and that a passed fork-genesis
predecessor yields an empty previous block (`0x`) and the genesis snapshot. The timestamp case
builds a block at height 3 linked to block 0: with block 0 passed as the predecessor the proof
carries block 0 and its snapshot; without it the proof carries the stored block 2 below height 3
and its snapshot. Oracles are the decoded proof structs and the stored state. On-chain verification
of these proofs is out of scope here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: FraudProofService > createInvalidStateTransitionProof > live: a non-leader block linked to a stored block → proof against its author from that block`](../../../../../../test/unit/FraudProofService.test.ts#L15) (line 15)                  | [`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P6`](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md#unit-test-fraud-proof-service-1-rf6j18.p6)                                                                                                                                                                                |
| [`Unit: FraudProofService > createInvalidStateTransitionProof > live: a block whose predecessor is not stored → abstains, no proof`](../../../../../../test/unit/FraudProofService.test.ts#L58) (line 58)                                            | [`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P7`](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md#unit-test-fraud-proof-service-1-rf6j18.p7)                                                                                                                                                                                |
| [`Unit: FraudProofService > createInvalidStateTransitionProof > dispute replay: the passed predecessor is the proof's base, also for a block the stored history does not link`](../../../../../../test/unit/FraudProofService.test.ts#L82) (line 82) | [`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P9`](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md#unit-test-fraud-proof-service-1-rf6j18.p9)                                                                                                                                                                                |
| [`Unit: FraudProofService > createInvalidStateTransitionProof > dispute replay from the fork genesis → an empty previous block and the genesis snapshot`](../../../../../../test/unit/FraudProofService.test.ts#L129) (line 129)                     | [`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P10`](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md#unit-test-fraud-proof-service-1-rf6j18.p10)                                                                                                                                                                              |
| [`Unit: FraudProofService > buildInvalidTimestampProof > a passed predecessor → its block and snapshot, not the stored block below the block's height`](../../../../../../test/unit/FraudProofService.test.ts#L172) (line 172)                       | [`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P11`](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md#unit-test-fraud-proof-service-1-rf6j18.p11), [`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P12`](../../../../implementation/source/src/stateManager/utils/FraudProofService.ts.md#unit-test-fraud-proof-service-1-rf6j18.p12) |
