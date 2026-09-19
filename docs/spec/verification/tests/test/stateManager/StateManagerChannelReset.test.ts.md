# test/stateManager/StateManagerChannelReset.test.ts — Test Report

> **Test file:** [test/stateManager/StateManagerChannelReset.test.ts](../../../../../../test/stateManager/StateManagerChannelReset.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateManager.ts](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Four direct literal cases drive the non-terminal channel release through the real public surface. Three of
them start a three-peer channel on the `MathTestSession` harness, author the exit during `onLeaveTurn`, and
await the public `leaveChannel`, so the reset is reached the way an application reaches it — as the second
half of a settled departure — rather than by calling `resetChannel()` directly. The first case's oracle is
one host-side `runtimeState` projection of the live `StateManager`, shipped to the host by `execOnHost`:
channel id, fork id, status, `isDisposed`, the leave service's pending flag, the force-exit marker, open
connections, the signer address, and direct reads of the channel-scoped stores (block height watermark,
fork genesis, queued entries, the self-dispute marker). It is read once while the leave is still settling
and once after, and both projections are compared as one structure, so a passing assertion cannot come from
an empty pre-state. Two cases take the boundaries around the release: channel work is still refused while
the leave is pending, and another channel is selectable once it settled — the latter without `autoOpen`, so
selection alone is the subject. The last case uses two unopened in-thread runtimes (the harness minimum) to
dispose one first and prove the reset is refused afterwards. Out of scope here: what `Storage.clear()` does
per module (`StorageClear.test.ts`) and the end-to-end reuse of the runtime on a second real channel
(`E2E-TargetedChannelJoin.test.ts`, `E2E-ChannelReuse.test.ts`).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                   | Covers                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`StateManager.resetChannel > returns a participating runtime to its pre-channel state`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L30) (line 30)       | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P1`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p1), [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P2`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p2) |
| [`StateManager.resetChannel > keeps rejecting channel work while the leave is still pending`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L79) (line 79)  | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P3`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p3)                                                                                                                                                                 |
| [`StateManager.resetChannel > accepts another channel selection once the leave has settled`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L102) (line 102) | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P4`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p4), [`REQ-SDK-ARCH-2-QBZAT8.T1.P6`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p6)                                                          |
| [`StateManager.resetChannel > rejects a channel reset on a disposed runtime`](../../../../../../test/stateManager/StateManagerChannelReset.test.ts#L121) (line 121)                | [`UNIT-TEST-STATE-MANAGER-RESET-1-9QG1AG.P5`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-reset-1-9qg1ag.p5), [`REQ-SDK-ARCH-2-QBZAT8.T1.P7`](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8.t1.p7)                                                          |
