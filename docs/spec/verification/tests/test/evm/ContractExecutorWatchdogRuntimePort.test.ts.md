# test/evm/ContractExecutorWatchdogRuntimePort.test.ts — Test Report

> **Test file:** [test/evm/ContractExecutorWatchdogRuntimePort.test.ts](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [P2pRuntimeHost.ts](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md), [setupP2pRuntime.ts](../../../../implementation/source/src/evm/p2pRuntime/setupP2pRuntime.ts.md), [WorkerContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md), [errorWire.ts](../../../../implementation/source/src/evm/p2pRuntime/errorWire.ts.md)

The shared assertion body lives in `test/fixtures/WatchdogRuntimePortAssertions.ts`; each declaration calls it with its mode and host arguments.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Runtime-port tests of the one worker-error policy. `setupWatchdogP2pInstance` builds a real
runtime against a Hardhat node whose dedicated contract-executor worker is the scripted watchdog
entry: the inline host receives it through `HostContext.createContractExecutor`; the sdk-worker
host is the outer test entry `watchdogP2pRuntimeWorkerEntry`, which injects the same factory
inside its own thread. Each case subscribes `onHostError` after readiness, proves nothing trips
before the arm, arms one failure over a per-test `BroadcastChannel`, and asserts exactly one host
error: the unchanged watchdog message with `eventLoopDelay` (`dMax`, threshold) for a trip, the
original message for a throw or a rejection. After the report the runtime still answers
`getParticipants`, no second report arrives, and teardown disposes the instance, which resolves
only once the worker drained and exited. The synthetic instance is silent by config so the
runner's starvation classifier never sees the message; a starvation retry would fail the case.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                            | Covers                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Contract executor watchdog through the runtime port > inline host: a watchdog trip is one host error with delay data and the worker keeps serving`](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts#L16) (line 16) | [`INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P1`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md#integration-test-runtime-detached-error-1-5gwdec.p1), [`REQ-RUNTIME-3-VQXW59.T1.P8`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p8)   |
| [`Contract executor watchdog through the runtime port > sdk worker: a watchdog trip is one host error with delay data and the worker keeps serving`](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts#L23) (line 23)  | [`INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P2`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md#integration-test-runtime-detached-error-1-5gwdec.p2)                                                                                                              |
| [`Contract executor watchdog through the runtime port > inline host: an autonomous throw is one host error and the worker keeps serving`](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts#L30) (line 30)             | [`INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P3`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md#integration-test-runtime-detached-error-1-5gwdec.p3), [`REQ-RUNTIME-3-VQXW59.T1.P9`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p9)   |
| [`Contract executor watchdog through the runtime port > sdk worker: an autonomous throw is one host error and the worker keeps serving`](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts#L37) (line 37)              | [`INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P4`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md#integration-test-runtime-detached-error-1-5gwdec.p4)                                                                                                              |
| [`Contract executor watchdog through the runtime port > inline host: an unhandled rejection is one host error and the worker keeps serving`](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts#L44) (line 44)          | [`INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P5`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md#integration-test-runtime-detached-error-1-5gwdec.p5), [`REQ-RUNTIME-3-VQXW59.T1.P10`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p10) |
| [`Contract executor watchdog through the runtime port > sdk worker: an unhandled rejection is one host error and the worker keeps serving`](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts#L51) (line 51)           | [`INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P6`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md#integration-test-runtime-detached-error-1-5gwdec.p6)                                                                                                              |
