# test/unit/EvmDiamondStateMachineReduction.test.ts — Test Report

> **Test file:** [test/unit/EvmDiamondStateMachineReduction.test.ts](../../../../../../test/unit/EvmDiamondStateMachineReduction.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EvmDiamondStateMachine.ts](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Five cases drive the real `reduceAndFinalizeLocally` of participant 2's `EvmDiamondStateMachine`
against its real local diamond. Each teleports a session to a reducible disputed fork whose reduce
applies a top-up of peer 0, with every peer's reduction tasks held, fetches peer 0's sync payload for it, and persists the chain's
unreduced window into participant 2's local diamond; the premise check reads the local window as
unreduced. A harness endpoint decodes the payload's window and passes its disputes, snapshot,
encoded state, inbound list and claimed reduced fork to the method.

With the served inputs the call returns true and the local window records the claimed fork. A
second identical call returns false and the fork stays. A second call that expects another fork
throws `RaceConditionReductionExpectationDoesntMatch`, and the committed fork stays. Disputes that
name a fork with no dispute window return false and leave the window unreduced, which is why sync
checks the disputes' window before the call. An inbound list with an extra fabricated successor
throws `ErrorDisputeInboundMessageBlocksInvalid` and leaves the window unreduced.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                       | Covers                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: EvmDiamondStateMachine reduceAndFinalizeLocally > expired unreduced window with its served inputs → true, the local window records the expected fork`](../../../../../../test/unit/EvmDiamondStateMachineReduction.test.ts#L11) (line 11)                      | [`UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P1`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-3-g1kmvc) |
| [`Unit: EvmDiamondStateMachine reduceAndFinalizeLocally > window already reduced to the expected fork → false, the local window keeps that fork`](../../../../../../test/unit/EvmDiamondStateMachineReduction.test.ts#L21) (line 21)                                   | [`UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P2`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-3-g1kmvc) |
| [`Unit: EvmDiamondStateMachine reduceAndFinalizeLocally > window already reduced to another fork than expected → throws the expectation mismatch, the local window keeps its fork`](../../../../../../test/unit/EvmDiamondStateMachineReduction.test.ts#L32) (line 32) | [`UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P3`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-3-g1kmvc) |
| [`Unit: EvmDiamondStateMachine reduceAndFinalizeLocally > disputes naming a fork without a dispute window → false, the local window stays unreduced`](../../../../../../test/unit/EvmDiamondStateMachineReduction.test.ts#L48) (line 48)                               | [`UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P4`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-3-g1kmvc) |
| [`Unit: EvmDiamondStateMachine reduceAndFinalizeLocally > inbound list with a fabricated successor → throws the inbound validation revert, the local window stays unreduced`](../../../../../../test/unit/EvmDiamondStateMachineReduction.test.ts#L57) (line 57)       | [`UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P5`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-3-g1kmvc) |
