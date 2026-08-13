# test/stateManager/StateManagerTimeout.test.ts — Test Report

> **Test file:** [test/stateManager/StateManagerTimeout.test.ts](../../../../../../../test/stateManager/StateManagerTimeout.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateManager.ts](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `StateManager` timeout scheduling through the full harness runtime: it stages a
pre-dispute setup with a short `evidenceTime`, marks a peer AFK, posts a tampered dispute from
another peer, and waits until the dispute is committed on chain. The oracle is the window-age
guard on timeout submission: because the committed dispute window predates the timeout's
deadline, the observing peer must not submit a timeout — after sleeping almost the whole evidence
window, `getTimeout` for the active fork still returns `null` via the harness query. Due-time
computation, forced-versus-normal timeout selection, and the other scheduling branches are out of
scope here; the single case isolates the early-window rejection.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                            | Covers                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`StateManager timeout > does not submit a timeout when the existing dispute window predates its deadline`](../../../../../../../test/stateManager/StateManagerTimeout.test.ts#L7) (line 7) | [`UNIT-TEST-STATE-MANAGER-3.P4`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-3.p4) |
