# ThreadResources.test.ts

Test file: [test/utils/ThreadResources.test.ts](../../../../../../test/utils/ThreadResources.test.ts)
Exercises: [threadResources.ts](../../../../implementation/source/src/utils/threadResources.ts.md)

## Overview

The suite runs in the Node test thread with two hand-built WebAssembly modules: one that exports a
one-page memory, and one that exports `trap`, a function that runs `unreachable`. It reads
`getThreadResources()` before and after creating an instance with the constructor, one with
`WebAssembly.instantiate`, and a two-page memory, and checks the created counts and `instanceof`.
It instantiates the memory module through `WebAssembly.instantiateStreaming` from a `Response`
with the `application/wasm` type, and the created instance and memory counts each grow by one. It
calls the real `trap`, serializes the caught `RuntimeError` with `serializeError`, and checks the
attached probe, resources and user agent; it then restores the error with `deserializeError` and
serializes it again, and the diagnostics stay the ones from the first serialization. An ordinary
`Error` serializes with no diagnostics. A tracked stub worker counts once and counts down once
across two `shutdown` calls.

The probe is taken once per thread and the test thread already has one, so the refused-grow case
starts a fresh `worker_threads` worker. Before it loads the SDK, the worker replaces
`WebAssembly.Memory` with a subclass that counts its constructions and whose `grow` throws a
`RangeError`. It then serializes two real traps with `serializeError`. Both probes must be
`canCreate: true`, `canGrow16MiB: false` with that error message, both traps must carry the same
probe object, and the subclass must have been constructed once.

## Tests

- `counts the instances and memories this thread creates through each WebAssembly entry point, and keeps instanceof working`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P1
- `counts the instance and memory that instantiateStreaming creates from a streamed module`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P5
- `attaches this thread's resources, a working memory probe, and the device to a WebAssembly trap it serializes, and the receiving side keeps them`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P2, UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P7
- `attaches no WebAssembly diagnostics to an ordinary error`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P3
- `reports a refused 16 MiB grow in the memory probe with its error, and a later WebAssembly failure in the same thread reuses that probe`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P6
- `counts a spawned worker until its first shutdown ends, once across repeated shutdowns`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P4
