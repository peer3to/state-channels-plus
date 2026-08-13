# test/stateManager/ValidationService.test.ts — Test Report

> **Test file:** [test/stateManager/ValidationService.test.ts](../../../../../../../test/stateManager/ValidationService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ValidationService.ts](../../../../implementation/source/src/stateManager/ValidationService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One long case dissects a single `ValidationService` predicate — the
`blockAuthorIsNotParticipant` author gate — on a live four-peer session, through worker-realm
harness stubs (`probeAuthorGate*`) whose oracle is whether the gate name comes back as the
failing check. It binds the gate to its snapshot anchors: an author in the previous snapshot or
in a resulting snapshot coordinate-matched to the block passes; stale-height, wrong-fork, and
author-excluding snapshots reject; a missing declared snapshot falls back to the previous
snapshot; and with no local anchor at all the on-chain current+pending participant union decides
— proven with a real pending joiner that only the pending half of the union can admit. The other
validation predicates, conflict classification, and time logic are out of scope (owned by
`test/unit/ValidationService.test.ts`); since this file exercises one predicate of the service's
bundled predicate-chain permutations, none of them can be fully assigned here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                               | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`ValidationService - block author participant gate > binds the author to the previous snapshot and to a coordinate-matched resulting snapshot`](../../../../../../../test/stateManager/ValidationService.test.ts#L9) (line 9) | —      |
