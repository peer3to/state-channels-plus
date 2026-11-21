# LightClientCounters.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/LightClientCounters.ts](../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/LightClientCounters.ts)

## Requirements

- [`REQ-LC-3-W7RRHM` (A failed read falls back to the endpoint and is made known)](../../../../../../../specification/runtime/light-client.md#req-lc-3-w7rrhm)
- [`REQ-LC-7-W8WDN3` (A refused or ended subscription syncs again and is made known)](../../../../../../../specification/runtime/light-client.md#req-lc-7-w8wdn3)
- [`REQ-LC-9-KWXV43` (A read takes from the pushed partitions what they prove at its block)](../../../../../../../specification/runtime/light-client.md#req-lc-9-kwxv43)
- [`REQ-LC-10-YCP80W` (The stages of each accepted pushed block are kept)](../../../../../../../specification/runtime/light-client.md#req-lc-10-ycp80w)
