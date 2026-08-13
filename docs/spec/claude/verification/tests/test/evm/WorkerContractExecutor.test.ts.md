# test/evm/WorkerContractExecutor.test.ts — Test Report

> **Test file:** [test/evm/WorkerContractExecutor.test.ts](../../../../../../../test/evm/WorkerContractExecutor.test.ts) > **Status:** Authored — engineer verification pending.
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
applied; execution logs cross the port as RPC-style objects (address/topics/data, ethers
parseable, not arrays); `dispose` is idempotent; calls after disposal reject with the
worker-disposed error; and — in both inline and worker mode — a simulation racing a local write
is serialized to one active call in the precompile. Host protocol details, event forwarding, and
signing paths are out of scope (they belong to the p2p runtime host suites).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                  | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`WorkerContractExecutor > should execute custom precompiles in worker mode`](../../../../../../../test/evm/WorkerContractExecutor.test.ts#L19) (line 19)                                                         | —      |
| [`WorkerContractExecutor > should return RPC-style logs from the worker`](../../../../../../../test/evm/WorkerContractExecutor.test.ts#L61) (line 61)                                                             | —      |
| [`WorkerContractExecutor > should dispose idempotently`](../../../../../../../test/evm/WorkerContractExecutor.test.ts#L97) (line 97)                                                                              | —      |
| [`WorkerContractExecutor > should reject calls immediately after disposal`](../../../../../../../test/evm/WorkerContractExecutor.test.ts#L106) (line 106)                                                         | —      |
| [`WorkerContractExecutor > <dynamic: `should serialize simulations with local writes (${dedicatedThread ? "worker" : "inline"})`>`](../../../../../../../test/evm/WorkerContractExecutor.test.ts#L126) (line 126) | —      |
