# test/evm/WorkerContractExecutor.test.ts — Test Report

> **Test file:** [test/evm/WorkerContractExecutor.test.ts](../../../../../../test/evm/WorkerContractExecutor.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [WorkerContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the worker-backed contract executor through the public
`createContractExecutorFactory({dedicatedThread: true})` entry, with real worker threads and
manifest-loaded custom precompiles from `test/fixtures`. The oracles decode return values and
logs on the caller side of the port. The cases prove: a manifest custom precompile executes
inside the worker (the precompile itself reports `isMainThread === false`) with its options
applied; delayed precompile initialization completes before the worker returns and executes; a
concurrent failed and successful request settle their matching caller promises with the original
worker error and decoded success value;
execution logs cross the port as RPC-style objects (address/topics/data, ethers
parseable, not arrays); `dispose` is idempotent; calls after disposal reject with the
worker-disposed error; in both inline and worker mode a simulation racing a local write is serialized
to one active call in the precompile; a fatal inside the worker uploads its logs under the vm thread with the
host's identity, reaches the realms above even while the EVM is still being built, and ends the thread so later
calls reject; and a worker whose init fails is ended rather than leaked, proven by a child process that must be
able to exit. Host protocol details, event forwarding, and signing paths
are out of scope (they belong to the p2p runtime host suites). The `detached worker errors` block builds its
executors through the internal two-argument constructor `createContractExecutor` (the public factory delegates
to it), loads the scripted watchdog worker entry through the internal `createWorkerRuntime` dependency, and
arms one failure over a per-test `BroadcastChannel`: a watchdog trip and an autonomous throw each arrive as one
`onDetachedError` report (the trip with `eventLoopDelay` data) while the executor still deploys; a worker exit
after readiness rejects later calls with the exit as the cause and never as a report, and a second exit case
holds a call request inside the worker so a genuinely in-flight request rejects with the same cause; an error
thrown in the first microtask after the host starts is a report, because the funnel is registered before
readiness; a detached error with no route is re-thrown on the owning thread while the executor still serves;
the public factory keeps one argument and its pre-plan option shape, pinned by a compile-time equality; a
load-time failure rejects `create` with the original error; and the Node runtime reports the load-time error
before the exit that follows it. Every case disposes its executor and the scripted worker is silent by config,
so no case can trip the runner's starvation classifier.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration | Covers |
| --- | --- |
| [`WorkerContractExecutor > should execute custom precompiles in worker mode`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L93) (line 93) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P1`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p1), [`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P2`](../../../../implementation/source/src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts.md#unit-test-contract-executor-worker-host-1-2trsyv.p2) |
| [`WorkerContractExecutor > should wait for precompile readiness before returning`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L135) (line 135) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P2`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p2), [`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P1`](../../../../implementation/source/src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts.md#unit-test-contract-executor-worker-host-1-2trsyv.p1), [`REQ-RUNTIME-3-VQXW59.T2.P2`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t2.p2) |
| [`WorkerContractExecutor > should correlate a worker error with a concurrent successful response`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L180) (line 180) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P7`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p7), [`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P3`](../../../../implementation/source/src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts.md#unit-test-contract-executor-worker-host-1-2trsyv.p3) |
| [`WorkerContractExecutor > should return RPC-style logs from the worker`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L230) (line 230) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P3`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p3) |
| [`WorkerContractExecutor > should dispose idempotently`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L266) (line 266) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P4`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p4), [`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P4`](../../../../implementation/source/src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts.md#unit-test-contract-executor-worker-host-1-2trsyv.p4) |
| [`WorkerContractExecutor > should reject calls immediately after disposal`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L275) (line 275) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P5`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p5) |
| [`WorkerContractExecutor > keeps the caller's logger working after the worker crashed`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L294) (line 294) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P19`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p19) |
| [`WorkerContractExecutor > uploads the worker's logs under the vm thread`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L338) (line 338) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P20`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p20), [`REQ-LOG-6-Q8KY4N.T1.P3`](../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n.t1.p3) |
| [`WorkerContractExecutor > an unhandled rejection in the worker uploads every linked realm`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L385) (line 385) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P21`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p21), [`INV-LOG-1-P4WT6R.T1.P3`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r.t1.p3) |
| [`WorkerContractExecutor > a crash while the evm is still being built reaches the realms above`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L426) (line 426) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P22`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p22), [`INV-LOG-1-P4WT6R.T1.P6`](../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r.t1.p6) |
| [`WorkerContractExecutor > ends the worker when init fails instead of leaking it`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L481) (line 481) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P23`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p23) |
| [`WorkerContractExecutor > should serialize simulations with local writes (inline)`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L566) (line 566) | [`REQ-RUN-1-FSV0SH.T1.P1`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-1-fsv0sh.t1.p1) |
| [`WorkerContractExecutor > should serialize simulations with local writes (worker)`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L570) (line 570) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P6`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p6) |
| [`WorkerContractExecutor > request failure preserves nested revert data and peer metadata across the worker`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L574) (line 574) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P16`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p16) |
| [`WorkerContractExecutor > late worker failure after disposal leaves the pending request rejected only by disposal`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L615) (line 615) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P17`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p17) |
| [`WorkerContractExecutor > detached worker errors > reports a watchdog trip once with its delay data and keeps serving`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L686) (line 686) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P8`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p8) |
| [`WorkerContractExecutor > detached worker errors > reports an autonomous throw once and keeps serving`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L734) (line 734) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P9`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p9), [`UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N.P1`](../../../../implementation/source/src/evm/contractExecutor/createContractExecutor.ts.md#unit-test-create-contract-executor-1-m5h56n.p1) |
| [`WorkerContractExecutor > detached worker errors > fails every pending and later call when the worker exits after readiness`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L765) (line 765) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P10`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p10), [`REQ-RUNTIME-3-VQXW59.T1.P11`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p11) |
| [`WorkerContractExecutor > detached worker errors > rejects creation when the worker fails before its funnel exists`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L820) (line 820) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P11`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p11), [`REQ-RUNTIME-3-VQXW59.T1.P12`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p12) |
| [`WorkerContractExecutor > detached worker errors > fails a request that is in flight when the worker exits, with the exit as the cause`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L844) (line 844) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P12`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p12), [`REQ-RUNTIME-3-VQXW59.T1.P13`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p13) |
| [`WorkerContractExecutor > detached worker errors > reports an error thrown right after the host starts, before any request`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L905) (line 905) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P13`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p13), [`REQ-RUNTIME-3-VQXW59.T1.P14`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p14) |
| [`WorkerContractExecutor > detached worker errors > re-throws a detached error on the owning thread when no application route is given`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L934) (line 934) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P14`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p14), [`REQ-RUNTIME-3-VQXW59.T1.P15`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p15), [`UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N.P2`](../../../../implementation/source/src/evm/contractExecutor/createContractExecutor.ts.md#unit-test-create-contract-executor-1-m5h56n.p2) |
| [`WorkerContractExecutor > detached worker errors > keeps the public factory to one argument and its pre-plan option shape`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L976) (line 976) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P15`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p15) |
| [`WorkerContractExecutor > detached worker errors > node runtime keeps the first error when the exit follows it`](../../../../../../test/evm/WorkerContractExecutor.test.ts#L998) (line 998) | [`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P18`](../../../../implementation/source/src/evm/contractExecutor/WorkerContractExecutor.ts.md#unit-test-worker-contract-executor-1-gqgaw7.p18) |
