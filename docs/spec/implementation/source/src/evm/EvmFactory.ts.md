# EvmFactory.ts

> **Source:** [src/evm/EvmFactory.ts](../../../../../../src/evm/EvmFactory.ts)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-EVM-FACTORY-1-002C8D

Precompile composition, the executor owner context, and bounded state memory

- Setup: `createEvm` directly with a caller-supplied precompile; and a real SDK-owned executor (inline and worker) whose manifest factory rejects unless its owner is the executor root and then creates a real probe child under it, returning bytes through the child's echo endpoint.
- Oracle: Bare EVM: the custom precompile runs once with its exact return and the console precompile still logs. Executor: the owner is the executor root, the child is registered as its child, precompile results carry the child's echoed bytes, and executor disposal closes the child. Forbidden: a missing or foreign owner, a child outliving its executor. State: the EVM's state manager prunes replaced trie nodes, so rewriting the same storage slots leaves its trie database the same size; forbidden: a database that grows with every call until the thread runs out of memory. Pruning never corrupts state: a contract whose storage is identical to a rewritten contract's still reads back every slot from the trie database, and a reverted checkpoint keeps the state root and every slot; forbidden: a slot that reads back as zero, a later write that fails.

- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P1` — inline executor: factory receives that executor root during startup, its child serves the precompile call, and executor disposal closes the child
- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P2` — worker executor: factory receives the worker-side executor root and call and simulation both return the child's bytes
- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P3` — bare two-argument EVM: a custom precompile executes once with its return value and the built-in console precompile still logs
- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P4` — bare EVM: 50 calls that rewrite the same 8 storage slots leave the trie database at its size after the first call
- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P5` — bare EVM: two contracts hold identical storage; after 5 rewrites of the first, the second reads back every slot through an uncached state manager, and its next write succeeds and reads back
- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P6` — bare EVM: a call that rewrites every slot inside a journal checkpoint that is then reverted leaves the state root and every slot, read through an uncached state manager, at their committed values
