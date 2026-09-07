# test/unit/StateManager.test.ts — Test Report

> **Test file:** [test/unit/StateManager.test.ts](../../../../../../test/unit/StateManager.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

The tests exercise the live current-fork predicate before and after disposal and a real reduction.

## Tests and covered test IDs

| Test                                                                                                                                         | Covers                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateManager.isActiveFork > rejects the current fork after disposal`](../../../../../../test/unit/StateManager.test.ts#L5) (line 5)        | [`UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P1`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-active-fork-1-ndtw9k.p1) |
| [`StateManager.isActiveFork > rejects an older fork after a real reduction`](../../../../../../test/unit/StateManager.test.ts#L17) (line 17) | [`UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P2`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-active-fork-1-ndtw9k.p2) |
