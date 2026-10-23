# resolveHostRootManifest.ts

> **Source:** [src/rpc/internal/roots/resolveHostRootManifest.ts](../../../../../../../../src/rpc/internal/roots/resolveHostRootManifest.ts)

## Requirements

- [`REQ-RPC-9-8FFE6S` (Application host root)](../../../../../../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)

## UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3

Host root manifest resolution

- Setup: Start an inline runtime through the public setup with a manifest naming the probe host root, with no manifest, and with a manifest naming a non-class export of the same module.
- Oracle: The named class runs as the host root and serves its internal service; no manifest runs the SDK's own root, where the probe service is an unknown endpoint; a non-class export rejects setup with the module named in the error.

- [x] `UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3.P1` — the manifest's named export is the host root class
- [x] `UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3.P2` — an absent manifest resolves to the SDK's own host root
- [x] `UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3.P3` — an export that is not a class throws naming the module
