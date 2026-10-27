# ThreadResources.test.ts

Test file: [test/utils/ThreadResources.test.ts](../../../../../../test/utils/ThreadResources.test.ts)
Exercises: [threadResources.ts](../../../../implementation/source/src/utils/threadResources.ts.md)

## Overview

The suite runs in the Node test thread with two hand-built WebAssembly modules: one that exports a
one-page memory, and one that exports `trap`, a function that runs `unreachable`. It reads
`getThreadResources()` before and after creating an instance with the constructor, one with
`WebAssembly.instantiate`, and a two-page memory, and checks the created counts and `instanceof`. It
calls the real `trap`, serializes the caught `RuntimeError` with `serializeError`, and checks the
attached probe, resources and user agent; it then restores the error with `deserializeError` and
serializes it again, and the diagnostics stay the ones from the first serialization. An ordinary
`Error` serializes with no diagnostics. A tracked stub worker counts once and counts down once
across two `shutdown` calls.

## Tests

- `counts the instances and memories this thread creates through each WebAssembly entry point, and keeps instanceof working`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P1
- `attaches this thread's resources, a working memory probe, and the device to a WebAssembly trap it serializes, and the receiving side keeps them`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P2, UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P7
- `attaches no WebAssembly diagnostics to an ordinary error`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P3
- `counts a spawned worker until its first shutdown ends, once across repeated shutdowns`: UNIT-TEST-THREAD-RESOURCES-1-AY7843.P4
