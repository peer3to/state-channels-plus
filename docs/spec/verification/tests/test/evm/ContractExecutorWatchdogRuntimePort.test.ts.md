# ContractExecutorWatchdogRuntimePort.test.ts

Test file: [test/evm/ContractExecutorWatchdogRuntimePort.test.ts](../../../../../../test/evm/ContractExecutorWatchdogRuntimePort.test.ts)
Exercises: [P2pRuntimeHostRoot.ts](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md), [setupP2pRuntime.ts](../../../../implementation/source/src/evm/p2pRuntime/setupP2pRuntime.ts.md), [RpcContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/RpcContractExecutor.ts.md), [errorWire.ts](../../../../implementation/source/src/rpc/internal/errorWire.ts.md)

The shared assertion body lives in `test/fixtures/WatchdogRuntimePortAssertions.ts`; each declaration calls it with its mode and host arguments.

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

## Tests

- `inline host: a watchdog trip is one host error with delay data and the worker keeps serving`: INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P1, REQ-RUNTIME-3-VQXW59.T1.P8
- `sdk worker: a watchdog trip is one host error with delay data and the worker keeps serving`: INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P2
- `inline host: an autonomous throw is one host error and the worker keeps serving`: INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P3, REQ-RUNTIME-3-VQXW59.T1.P9
- `sdk worker: an autonomous throw is one host error and the worker keeps serving`: INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P4
- `inline host: an unhandled rejection is one host error and the worker keeps serving`: INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P5, REQ-RUNTIME-3-VQXW59.T1.P10
- `sdk worker: an unhandled rejection is one host error and the worker keeps serving`: INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P6
