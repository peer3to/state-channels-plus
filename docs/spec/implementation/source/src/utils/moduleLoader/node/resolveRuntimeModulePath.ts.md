# resolveRuntimeModulePath.ts

> **Source:** [src/utils/moduleLoader/node/resolveRuntimeModulePath.ts](../../../../../../../../src/utils/moduleLoader/node/resolveRuntimeModulePath.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-RESOLVE-RUNTIME-MODULE-PATH-1-K3M8QD

Twin resolution

- Setup: Call with paths in a temporary directory holding chosen twins
- Oracle: The named file wins when present; the twin only when the named file is absent; other inputs unchanged

- [x] `UNIT-TEST-RESOLVE-RUNTIME-MODULE-PATH-1-K3M8QD.P1` — existing file, compiled-only twin, source-only twin, missing both, bare specifier and non-module extension
