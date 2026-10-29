# threadResources.ts

> **Source:** [src/utils/threadResources.ts](../../../../../../src/utils/threadResources.ts)

No specified behavior: Per-thread WebAssembly and worker counts, device facts, and the diagnostics a WebAssembly failure carries; diagnostics only. The counts are this thread's only, never the process total ([`FIND-RUNTIME-3-NWSN74`](../../../../audit/open-findings.md#find-runtime-3-nwsn74)).

## UNIT-TEST-THREAD-RESOURCES-1-AY7843

Per-thread WebAssembly and worker counts, and WebAssembly failure diagnostics

- Setup: In one thread, create WebAssembly instances and memories through each entry point, trap a real module that runs `unreachable`, serialize ordinary and WebAssembly errors through `serializeError`, and track a worker whose `shutdown` is called twice. In a fresh thread whose `WebAssembly.Memory` refuses to grow before the module loads, serialize two traps.
- Oracle: `getThreadResources()` deltas for created instances, memories, the largest live memory and workers; the `wasmDiagnostics` of the serialized error (resources, memory probe, environment), or its absence; `instanceof` on the created objects still holds.

- [x] `UNIT-TEST-THREAD-RESOURCES-1-AY7843.P1` — the `Instance` and `Memory` constructors and `instantiate` each count what they create (an exported memory once), the largest live memory is reported, and `instanceof` still holds
- [x] `UNIT-TEST-THREAD-RESOURCES-1-AY7843.P2` — a WebAssembly trap serialized in this thread carries this thread's resources, a working memory probe (`canCreate` and `canGrow16MiB` true, no error), and the device's user agent
- [x] `UNIT-TEST-THREAD-RESOURCES-1-AY7843.P3` — an ordinary error carries no WebAssembly diagnostics
- [x] `UNIT-TEST-THREAD-RESOURCES-1-AY7843.P4` — a tracked worker counts once until its first `shutdown` ends; a second `shutdown` does not count it down again
- [x] `UNIT-TEST-THREAD-RESOURCES-1-AY7843.P5` — `instantiateStreaming` counts the instance it creates
- [x] `UNIT-TEST-THREAD-RESOURCES-1-AY7843.P6` — a memory probe whose create or 16 MiB grow is refused reports that step and every later one as failed, with the error message; a later failure in the same thread reuses that first probe
