# RemoteRoot.ts

> **Source:** [src/rpc/internal/RemoteRoot.ts](../../../../../../../src/rpc/internal/RemoteRoot.ts)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-REMOTE-ROOT-1-7D9JVE

Complete remote handle and shared diagnostics

- Setup: Real production roots and their public operations.
- Oracle: Complete remote handle and shared diagnostics; no duplicate completion or leaked ownership.

- [x] `UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P1` — Two concurrent held requests crossing the slow threshold each log once with the exact request ID sent on the port, with no calldata assumptions
- [x] `UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P2` — A child failure logs both concurrent pending operations with their distinct wire request IDs and rejects them; repeated failure after closure produces no duplicate observation
- [x] `UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P3` — Inline executor creation returns a typed handle, keeps transport and connection private at compile time, and repeated disposal preserves its owner
- [x] `UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P4` — Worker executor creation returns the same handle surface and repeated disposal preserves its owner
