# ContractExecutorRoot.ts

> **Source:** [src/rpc/internal/roots/ContractExecutorRoot.ts](../../../../../../../../src/rpc/internal/roots/ContractExecutorRoot.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)

## UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH

SDK-owned executor receiving endpoint behavior in both placements.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Real EVM calls prove readiness, normalized cloneable manifests, return isolation, canonical/simulation state separation, exact revert bytes and recovery. Root disposal rejects later calls in both placements. Ordinary construction installs no test probe.

- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P1` — Inline creation stays pending until initialization and the ready frame complete
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P2` — Worker creation stays pending until initialization and the ready frame complete
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P3` — Keeps the supplied inline logger and starts no duplicate monitor
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P4` — Normalizes inline manifest addresses and preserves optional binary and BigInt values
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P5` — Normalizes worker manifest addresses and preserves optional binary and BigInt values
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P6` — Installs no probe or controller during ordinary SDK construction
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P7` — Keeps canonical calls and simulations ordered through the inline RPC adapter
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P8` — Keeps canonical calls and simulations ordered through the worker RPC adapter
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P9` — Preserves inline revert bytes and serves the next call
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P10` — Preserves worker revert bytes and serves the next call
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P11` — Isolates inline returned results from executor-owned state
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P12` — Isolates worker returned results from executor-owned state
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P13` — Rejects inline calls after repeated executor disposal
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P14` — Rejects worker calls after repeated executor disposal
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P15` — genuine SDK setup initializes Clock before inline executor construction and the executor timestamp matches the live host within one second
- [x] `UNIT-TEST-EXECUTOR-ROOT-1-WPQCJH.P16` — genuine SDK setup initializes Clock before dedicated executor construction and the executor timestamp matches the live host within one second

## UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV

Worker-host lifecycle for [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) and [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

- Setup: Create the SDK-owned worker executor with real synchronous and delayed precompiles; call and dispose it.
- Oracle: Successful domain initialization never precedes precompile readiness; requests settle once; errors stay correlated; disposal releases ownership.

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P1` — delayed precompile readiness gates host return
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P2` — successful request correlation
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P3` — error serialization and correlation
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P4` — idempotent disposal and post-disposal rejection
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P5` — an injected monitor configuration starts the monitor below the runtime threshold and its trip leaves the worker as one `detachedError` with delay data
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P6` — the registered funnel turns an uncaught throw into one `detachedError` and the worker keeps serving
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P7` — an error thrown in the first microtask after `start` reaches the funnel registered before it and leaves as one `detachedError`
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P8` — starts the configured monitor without injected options and stops it on dispose
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P9` — does not start a disabled monitor without injected options
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P10` — stops the injected sample source on dispose
