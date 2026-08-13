# test/evm/EvmJumpdestCache.test.ts — Test Report

> **Test file:** [test/evm/EvmJumpdestCache.test.ts](../../../../../../test/evm/EvmJumpdestCache.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [node/evmJumpdestCache.ts](../../../../implementation/source/src/evm/node/evmJumpdestCache.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A component suite for the platform jumpdest cache, driven through `createEvm` and raw `runCall`
executions of hand-assembled bytecode whose observable behavior differs by hardfork (`PUSH0`
after a `JUMP`, invalid before Shanghai). The oracle is the exported `evmJumpdestCacheStats`
analysis counter plus execution success/failure. The cases prove: the same stored code is
analyzed once and then served from the cache (zero analyses on the second run, identical
results); distinct code buffers execute independently (a jump into a non-`JUMPDEST` byte still
fails); separate EVM instances behave identically; and switching the active hardfork on the
EVM's own `common` invalidates the entry — the same code reference is re-analyzed against the new
opcode table and `PUSH0` flips from failing on Paris to succeeding on Shanghai. Cache eviction
policy and the browser platform variant are not exercised here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                  | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`EVM jumpdest cache (component) > analyzes once and then hits the cache for the same stored code`](../../../../../../test/evm/EvmJumpdestCache.test.ts#L44) (line 44)            | —      |
| [`EVM jumpdest cache (component) > executes distinct code buffers independently`](../../../../../../test/evm/EvmJumpdestCache.test.ts#L64) (line 64)                              | —      |
| [`EVM jumpdest cache (component) > keeps separate EVM instances independent`](../../../../../../test/evm/EvmJumpdestCache.test.ts#L78) (line 78)                                  | —      |
| [`EVM jumpdest cache (component) > follows the active hardfork after it changes, for the same code reference`](../../../../../../test/evm/EvmJumpdestCache.test.ts#L87) (line 87) | —      |
