# test/unit/StateManager.test.ts — Test Report

> **Test file:** [test/unit/StateManager.test.ts](../../../../../../test/unit/StateManager.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

The tests exercise the live current-fork predicate before and after disposal and a real reduction.

The disposal case retains the actual inline StateManager before cleanup so its post-disposal assertion does not depend on a reply from the disposed network.

## Tests and covered test IDs

| Test                                                                                                                                                                                                               | Covers                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateManager.isActiveFork > rejects the current fork after disposal`](../../../../../../test/unit/StateManager.test.ts#L6) (line 6)                                                                              | [`UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P1`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-active-fork-1-ndtw9k.p1) |
| [`StateManager.isActiveFork > rejects an older fork after a real reduction`](../../../../../../test/unit/StateManager.test.ts#L19) (line 19)                                                                       | [`UNIT-TEST-STATE-MANAGER-ACTIVE-FORK-1-NDTW9K.P2`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-active-fork-1-ndtw9k.p2) |
| [`StateManager.getActiveValidationStrategy > participant → chain-committed item gets the calldata strategy, a gossip-only item the live strategy`](../../../../../../test/unit/StateManager.test.ts#L40) (line 40) | [`UNIT-TEST-STATE-MANAGER-7-YRC0N3.P3`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-7-yrc0n3.p3)                         |
| [`StateManager.getActiveValidationStrategy > synced spectator → chain-committed and gossip-only items both get the spectating strategy`](../../../../../../test/unit/StateManager.test.ts#L65) (line 65)           | [`UNIT-TEST-STATE-MANAGER-7-YRC0N3.P2`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-7-yrc0n3.p2)                         |
