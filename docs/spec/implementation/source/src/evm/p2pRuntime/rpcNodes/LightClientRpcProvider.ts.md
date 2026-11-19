# LightClientRpcProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts)

## Requirements

- [`REQ-LC-1-JT5PKT` (Reads at the latest block are answered from proven state of one block)](../../../../../../specification/runtime/light-client.md#req-lc-1-jt5pkt)
- [`REQ-LC-2-PMY1VG` (What cannot be answered from proven state goes to the endpoint)](../../../../../../specification/runtime/light-client.md#req-lc-2-pmy1vg)
- [`REQ-LC-3-W7RRHM` (A failed read falls back to the endpoint and is made known)](../../../../../../specification/runtime/light-client.md#req-lc-3-w7rrhm)
- [`REQ-LC-4-E29Y46` (The light client is off unless switched on and served)](../../../../../../specification/runtime/light-client.md#req-lc-4-e29y46)
- [`REQ-LC-5-MM0BM9` (The storage of a followed contract is carried across blocks only by pushed…)](../../../../../../specification/runtime/light-client.md#req-lc-5-mm0bm9)
- [`REQ-LC-7-W8WDN3` (A refused pushed block is not used and is made known)](../../../../../../specification/runtime/light-client.md#req-lc-7-w8wdn3)
