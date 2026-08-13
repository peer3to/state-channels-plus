# test/evm/ContractExecutor.test.ts — Test Report

> **Test file:** [test/evm/ContractExecutor.test.ts](../../../../../../../test/evm/ContractExecutor.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives a `ContractExecutor` wrapped around one raw `@ethereumjs/evm` instance with a
deployed `SimpleNumberStorage` fixture, calling `executeCall`, `simulateCall`, and `deploy`
directly (addresses are passed mixed-case to prove checksum-insensitive routing). The oracles
decode return values, inspect RPC-style logs (address/topics/data parseable by an ethers
interface), measure the underlying trie database size, and count concurrently active `runCall`
invocations through record-only patches. The cases prove: reads and canonical writes commit
(state and DB growth), `setState` accepts raw bytes, simulations never persist or expand the DB,
simulations wait for an in-flight canonical call and then read its committed state, detached
canonical calls and simulation storms are serialized to exactly one active `runCall` without
corrupting a mixed increment workload, and failures decode (plain revert message and Solidity
`Error(string)` custom-error decoding via `tryDecodeCustomError`). Worker-mode execution is out
of scope (owned by `test/evm/WorkerContractExecutor.test.ts`). No pool test ID names the
executor's mutex/simulation contract as a single-test permutation, so no ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                            | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`ContractExecutor > should successfully execute a call to get a value`](../../../../../../../test/evm/ContractExecutor.test.ts#L65) (line 65)                                              | —      |
| [`ContractExecutor > should successfully execute a call to set a value`](../../../../../../../test/evm/ContractExecutor.test.ts#L82) (line 82)                                              | —      |
| [`ContractExecutor > should successfully set state using bytes`](../../../../../../../test/evm/ContractExecutor.test.ts#L109) (line 109)                                                    | —      |
| [`ContractExecutor > should return RPC-style logs`](../../../../../../../test/evm/ContractExecutor.test.ts#L141) (line 141)                                                                 | —      |
| [`ContractExecutor > should simulate a mutating call without persisting it`](../../../../../../../test/evm/ContractExecutor.test.ts#L170) (line 170)                                        | —      |
| [`ContractExecutor > should not expand the underlying EVM DB on simulated mutating calls`](../../../../../../../test/evm/ContractExecutor.test.ts#L199) (line 199)                          | —      |
| [`ContractExecutor > should expand the underlying EVM DB on canonical mutating calls`](../../../../../../../test/evm/ContractExecutor.test.ts#L214) (line 214)                              | —      |
| [`ContractExecutor > should make simulations wait while a canonical call holds the mutex`](../../../../../../../test/evm/ContractExecutor.test.ts#L229) (line 229)                          | —      |
| [`ContractExecutor > should simulate from the committed state after a canonical call releases`](../../../../../../../test/evm/ContractExecutor.test.ts#L281) (line 281)                     | —      |
| [`ContractExecutor > should serialize detached simulations`](../../../../../../../test/evm/ContractExecutor.test.ts#L344) (line 344)                                                        | —      |
| [`ContractExecutor > should serialize many detached canonical increments and simulations without corrupting state`](../../../../../../../test/evm/ContractExecutor.test.ts#L382) (line 382) | —      |
| [`ContractExecutor > should serialize canonical detached calls before entering evm.runCall`](../../../../../../../test/evm/ContractExecutor.test.ts#L461) (line 461)                        | —      |
| [`ContractExecutor > should throw an error for invalid function calls`](../../../../../../../test/evm/ContractExecutor.test.ts#L510) (line 510)                                             | —      |
| [`ContractExecutor > should properly decode Solidity revert errors`](../../../../../../../test/evm/ContractExecutor.test.ts#L524) (line 524)                                                | —      |
