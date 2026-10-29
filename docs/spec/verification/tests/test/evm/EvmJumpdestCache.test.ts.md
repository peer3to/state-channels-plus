# EvmJumpdestCache.test.ts

Test file: [test/evm/EvmJumpdestCache.test.ts](../../../../../../test/evm/EvmJumpdestCache.test.ts)
Exercises: [node/evmJumpdestCache.ts](../../../../implementation/source/src/evm/node/evmJumpdestCache.ts.md)

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

## Tests

- `analyzes once and then hits the cache for the same stored code`: none
- `executes distinct code buffers independently`: none
- `keeps separate EVM instances independent`: none
- `follows the active hardfork after it changes, for the same code reference`: none
