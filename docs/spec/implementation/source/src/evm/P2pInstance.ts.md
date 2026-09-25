# P2pInstance.ts

> **Source:** [src/evm/P2pInstance.ts](../../../../../../src/evm/P2pInstance.ts)
>
> **Design views:** [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

## Requirements

- [`REQ-SDK-ARCH-2-QBZAT8` (Ordered lifecycle)](../../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8)
- [`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)
- [`REQ-RUNTIME-5-WJ1XKK` (Required host environments: browser and Node)](../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)

## UNIT-TEST-P2P-INSTANCE-1-AN3Y94

Application cleanup ownership

- Setup: Real SDK instance, actual host connection closure and contract subscriptions.
- Oracle: Cleanup follows root closure without an app dispose call; the application child is disposed while the supplied parent stays active.

- [x] `UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P1` — Unexpected host closure removes application listeners and disposes its owned logger once
- [x] `UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P2` — Unexpected host closure disposes the application child and removes listeners, while its supplied parent remains usable
- [x] `UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P3` — Concurrent and later disposal calls reuse one promise, close once and reject later requests. Root closure during active disposal does not call public disposal again or duplicate its failure
- [x] `UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P4` — Setup failure detaches the service and leaves the supplied parent logger usable for another application child
