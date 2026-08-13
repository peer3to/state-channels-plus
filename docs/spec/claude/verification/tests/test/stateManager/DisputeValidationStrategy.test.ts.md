# test/stateManager/DisputeValidationStrategy.test.ts — Test Report

> **Test file:** [test/stateManager/DisputeValidationStrategy.test.ts](../../../../../../../test/stateManager/DisputeValidationStrategy.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeValidationStrategy.ts](../../../../implementation/source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `DisputeValidationStrategy` inside a live four-peer harness runtime: each case
runs a harness-control stub (`probeDisputeStrategyResultMatrix`, `probeCleanCommittedDivergence`,
`probeMissingParticipantSnapshots`) in the peer's worker realm against the real strategy instance.
The first case enumerates every `BlockValidationResult` value through
`interpretFinalValidationResult` and asserts the keep-connection mapping: `SUCCESS` and
`DUPLICATE` keep the connection, `DISPUTE` returns false, and the four live-only results
(`NOT_READY`, `DISCONNECT`, `BROADCAST`, `NOT_ENOUGH_TIME`) throw. The other two cases assert the
continue-replay divergences: a locally not-linked replay whose committed structure passes the
canonical Solidity structure predicate returns `SUCCESS` with no fraud proof stored, and the
outsider author/signature-union checks proceed to `SUCCESS` when participant snapshots are
unavailable. The deviation hooks' dispute-evidence construction is out of scope (owned by the
`disputeValidation` e2e suites), as is live-strategy behavior.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                              | Covers                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DisputeValidationStrategy > returns false only for DISPUTE and throws impossible results`](../../../../../../../test/stateManager/DisputeValidationStrategy.test.ts#L6) (line 6)            | [`UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1.P3`](../../../../implementation/source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md#unit-test-disputevalidation-strategy-1.p3) |
| [`DisputeValidationStrategy > continues a local not-linked replay when committed structure is clean`](../../../../../../../test/stateManager/DisputeValidationStrategy.test.ts#L23) (line 23) | —                                                                                                                                                                                              |
| [`DisputeValidationStrategy > continues outsider checks when participant snapshots are unavailable`](../../../../../../../test/stateManager/DisputeValidationStrategy.test.ts#L36) (line 36)  | —                                                                                                                                                                                              |
