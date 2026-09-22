# test/stateManager/StateManagerAbort.test.ts — Test Report

> **Test file:** [test/stateManager/StateManagerAbort.test.ts](../../../../../../test/stateManager/StateManagerAbort.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateManager](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Overview

Real SDK abort closes the host and executor in inline and worker placement, rejects late queries and preserves a sibling SDK. The inline fixture retains local endpoint observations for closure assertions. A separate timer case proves scheduled work is cancelled before its due time, status becomes OPENED and peer connections close.

## Tests and covered test IDs

| Test                                                                                                                                                                     | Covers                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [StateManager abort > disposes the inline host and executor roots on abort](../../../../../../test/stateManager/StateManagerAbort.test.ts#L11) (line 11)                 | [`UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P1`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-abort-1-zdyefe), [`REQ-RUNTIME-3-VQXW59.T1.P48`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p48) |
| [StateManager abort > disposes the worker host and executor roots on abort](../../../../../../test/stateManager/StateManagerAbort.test.ts#L14) (line 14)                 | [`UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P2`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-abort-1-zdyefe), [`REQ-RUNTIME-3-VQXW59.T1.P49`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p49) |
| [StateManager abort > cancels session-owned timeout work](../../../../../../test/stateManager/StateManagerAbort.test.ts#L17) (line 17)                                   | [`UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P3`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-abort-1-zdyefe)                                                                                                              |
| [StateManager abort > stops host work before provider destruction and final listener removal](../../../../../../test/stateManager/StateManagerAbort.test.ts#L8) (line 8) | [`UNIT-TEST-STATE-MANAGER-ABORT-1-ZDYEFE.P4`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-abort-1-zdyefe)                                                                                                              |
