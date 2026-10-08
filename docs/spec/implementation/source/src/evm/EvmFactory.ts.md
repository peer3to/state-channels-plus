# EvmFactory.ts

> **Source:** [src/evm/EvmFactory.ts](../../../../../../src/evm/EvmFactory.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-EVM-FACTORY-1-002C8D

Precompile composition and the executor owner context

- Setup: `createEvm` directly with a caller-supplied precompile; and a real SDK-owned executor (inline and worker) whose manifest factory rejects unless its owner is the executor root and then creates a real probe child under it, returning bytes through the child's echo endpoint.
- Oracle: Bare EVM: the custom precompile runs once with its exact return and the console precompile still logs. Executor: the owner is the executor root, the child is registered as its child, precompile results carry the child's echoed bytes, and executor disposal closes the child. Forbidden: a missing or foreign owner, a child outliving its executor.

- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P1` — inline executor: factory receives that executor root during startup, its child serves the precompile call, and executor disposal closes the child
- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P2` — worker executor: factory receives the worker-side executor root and call and simulation both return the child's bytes
- [x] `UNIT-TEST-EVM-FACTORY-1-002C8D.P3` — bare two-argument EVM: a custom precompile executes once with its return value and the built-in console precompile still logs
