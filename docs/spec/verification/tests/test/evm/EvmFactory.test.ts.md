# test/evm/EvmFactory.test.ts — Test Report

> **Test file:** [test/evm/EvmFactory.test.ts](../../../../../../test/evm/EvmFactory.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EvmFactory.ts](../../../../implementation/source/src/evm/EvmFactory.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The first case is a composition regression for bare `createEvm` with no owner: it builds an EVM through
the public factory with one caller-supplied precompile and a record-only logger, then issues two
`runCall`s. It asserts the custom precompile executes once and returns its ABI-encoded value unchanged,
and that a `log(string)` call to `CONSOLE_ADDRESS` still reaches the console precompile.

The other cases create real SDK-owned contract executors ([ExecutorOwnerFixture](../../../../../../test/fixtures/node/ExecutorOwnerFixture.ts))
whose manifest loads [RuntimeValuePrecompile](../../../../../../test/fixtures/node/RuntimeValuePrecompile.ts).
That factory throws unless its context owner is the executor root, creates a real SDK probe worker child
under that owner, checks the child is registered there, and returns the fixture's bytes through the
child's real echo endpoint. The inline cases read the live child record in the same realm; the worker case
proves the owner inside the worker because a result can only return when the factory accepted its owner
and its child serves. The disposal cases hold the child's real echo reply with `RuntimeRpcControl`, so an
`executeCall` stays admitted while executor disposal begins, then observe settlement order, the late-call
rejection text of a late call, deploy, and simulation, the precompile call count, the failure of an admitted deploy with invalid init code, the
identity of repeated disposal promises, and the child's closed state. The stuck-call case never releases
the held reply before disposal: it measures that disposal takes at least `IN_FLIGHT_REPLY_DRAIN_MS` (less
100 ms of timer slack) and under three times that limit, then reads the child's closed state, the call's
rejection, the precompile call count, and the executor errors the SDK fixture collected for the host,
which must be empty. The three late-completion cases load
[workerAnswerPrecompile](../../../../../../test/fixtures/workerAnswerPrecompile.ts) in a real inline
executor with a call delay of `IN_FLIGHT_REPLY_DRAIN_MS` plus 1.2 seconds, succeeding or (with
`failAfterDelay`) throwing after it. They dispose the executor right after sending the calls, which the
ordered connection admits first; for the queued case a deploy and a simulation wait on the executor mutex
behind the delayed call. The test takes the real executor root from the owner the SDK handed the
precompile factory (`workerAnswerPrecompileOwners`) and wraps that root's `ContractExecutorService.admit`
record-only, restoring it in the same block. The wrapper forwards every operation unchanged and records
each admitted operation's own settlement. The helper awaits disposal, then every caller's outcome, then
the settlement of every admitted operation, so it returns only after the last admitted operation has itself
finished, including the queued simulation that reaches the delayed precompile only after the first call.
Each case asserts the admitted count (1 for the late success, 1 for the late failure, 3 for the queued
case), that each caller's outcome equals exactly `Contract executor shut down before the operation
finished`, and that the host executor error list is empty. No executor, verifier, or transport is
mocked. Hardfork selection and jumpdest
caching are out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`EvmFactory > should execute custom precompiles without disabling the built-in console precompile`](../../../../../../test/evm/EvmFactory.test.ts#L38) (line 38)                             | [`UNIT-TEST-EVM-FACTORY-1-002C8D.P3`](../../../../implementation/source/src/evm/EvmFactory.ts.md#unit-test-evm-factory-1-002c8d.p3)                                                                                                                                                                            |
| [`EvmFactory > gives a manifest precompile its inline executor root during startup and releases its child with that executor`](../../../../../../test/evm/EvmFactory.test.ts#L103) (line 103) | [`UNIT-TEST-EVM-FACTORY-1-002C8D.P1`](../../../../implementation/source/src/evm/EvmFactory.ts.md#unit-test-evm-factory-1-002c8d.p1), [`REQ-RUNTIME-3-VQXW59.T1.P71`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p71)                                                               |
| [`EvmFactory > gives a manifest precompile its worker executor root during startup`](../../../../../../test/evm/EvmFactory.test.ts#L107) (line 107)                                           | [`UNIT-TEST-EVM-FACTORY-1-002C8D.P2`](../../../../implementation/source/src/evm/EvmFactory.ts.md#unit-test-evm-factory-1-002c8d.p2), [`REQ-RUNTIME-3-VQXW59.T1.P72`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p72)                                                               |
| [`EvmFactory > finishes an admitted precompile call and queued deploy and simulation before disposing the precompile child`](../../../../../../test/evm/EvmFactory.test.ts#L111) (line 111)   | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P1`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p1), [`REQ-RUNTIME-3-VQXW59.T1.P73`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p73) |
| [`EvmFactory > rejects executor calls, deploys and simulations that arrive after disposal began without entering the EVM`](../../../../../../test/evm/EvmFactory.test.ts#L115) (line 115)     | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P2`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p2), [`REQ-RUNTIME-3-VQXW59.T1.P74`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p74) |
| [`EvmFactory > keeps an admitted operation's failure while disposal waits for it`](../../../../../../test/evm/EvmFactory.test.ts#L119) (line 119)                                             | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P3`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p3), [`REQ-RUNTIME-3-VQXW59.T1.P75`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p75) |
| [`EvmFactory > shares one completion across repeated executor disposal during admitted work`](../../../../../../test/evm/EvmFactory.test.ts#L123) (line 123)                                  | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P4`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p4), [`REQ-RUNTIME-3-VQXW59.T1.P76`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p76) |
| [`EvmFactory > abandons an admitted call stuck past the drain limit, closes the child, and reports no error`](../../../../../../test/evm/EvmFactory.test.ts#L127) (line 127)                  | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P5`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p5), [`REQ-RUNTIME-3-VQXW59.T1.P77`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p77) |
| [`EvmFactory > keeps the disposal rejection for an admitted call that succeeds after the drain limit`](../../../../../../test/evm/EvmFactory.test.ts#L131) (line 131)                         | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P6`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p6), [`REQ-RUNTIME-3-VQXW59.T1.P79`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p79) |
| [`EvmFactory > keeps the disposal rejection for an admitted call that fails after the drain limit`](../../../../../../test/evm/EvmFactory.test.ts#L135) (line 135)                            | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P7`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p7), [`REQ-RUNTIME-3-VQXW59.T1.P80`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p80) |
| [`EvmFactory > rejects queued deploy and simulation callers released after the drain limit`](../../../../../../test/evm/EvmFactory.test.ts#L139) (line 139)                                   | [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P8`](../../../../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb.p8), [`REQ-RUNTIME-3-VQXW59.T1.P81`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p81) |
