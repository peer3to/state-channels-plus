# DisputeValidationStrategy.test.ts

Test file: [test/stateManager/DisputeValidationStrategy.test.ts](../../../../../../test/stateManager/DisputeValidationStrategy.test.ts)
Exercises: [DisputeValidationStrategy.ts](../../../../implementation/source/src/stateManager/validationStrategy/DisputeValidationStrategy.ts.md)

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

## Tests

- `returns false only for DISPUTE and throws impossible results`: UNIT-TEST-DISPUTEVALIDATION-STRATEGY-1-4TZTJ6.P3
- `outsider author without the executed participant snapshots -> the signature-union check throws`: none
