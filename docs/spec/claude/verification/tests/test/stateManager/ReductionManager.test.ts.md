# test/stateManager/ReductionManager.test.ts — Test Report

> **Test file:** [test/stateManager/ReductionManager.test.ts](../../../../../../../test/stateManager/ReductionManager.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ReductionManager.ts](../../../../implementation/source/src/stateManager/reduction/ReductionManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `ReductionManager.tryReduce` on real peers via `execOnHost`, staging live
channels, byzantine invalid-transition blocks, and fully resolved final disputes through the
harness. The oracles observe the returned reduction outcome, `hasOperation` retention, spy
counters on record-only wrappers around the manager's chain queries (`isForkDisputed`,
`isKillPeriodExpired`), and the peer's `onSetState` event count. The cases assert: a
non-disputed fork returns `undefined` without retaining an operation; the future-timer state
stays independent of reduction completion; duplicate terminal triggers reuse one resolved
outcome without re-installing state; the dispute status is checked exactly once before reduction
starts; and concurrent ordinary reduction attempts are serialized (one active chain probe, the
second attempt deferred). Reduction computation itself (successor equivalence across orders) and
completion-mismatch handling are out of scope. The manager's and executor's planned permutations
bundle multi-path and convergence-classification scenarios these single cases do not fully
demonstrate, so they stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                             | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`ReductionManager > returns undefined without retaining an operation for a non-disputed fork`](../../../../../../../test/stateManager/ReductionManager.test.ts#L5) (line 5) | —      |
| [`ReductionManager > keeps future timer state independent from reduction completion`](../../../../../../../test/stateManager/ReductionManager.test.ts#L26) (line 26)         | —      |
| [`ReductionManager > reuses one resolved outcome for duplicate terminal triggers`](../../../../../../../test/stateManager/ReductionManager.test.ts#L40) (line 40)            | —      |
| [`ReductionManager > checks the dispute status before starting reduction`](../../../../../../../test/stateManager/ReductionManager.test.ts#L85) (line 85)                    | —      |
| [`ReductionManager > serializes concurrent ordinary reduction attempts`](../../../../../../../test/stateManager/ReductionManager.test.ts#L131) (line 131)                    | —      |
