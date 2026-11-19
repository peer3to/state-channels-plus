# LightClient.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/lightClient/LightClient.ts](../../../../../../../../../src/evm/p2pRuntime/rpcNodes/lightClient/LightClient.ts)

## Requirements

- [`REQ-LC-1-JT5PKT` (Reads at the latest block are answered from proven state of one block)](../../../../../../../specification/runtime/light-client.md#req-lc-1-jt5pkt)
- [`REQ-LC-2-PMY1VG` (What cannot be answered from proven state goes to the endpoint)](../../../../../../../specification/runtime/light-client.md#req-lc-2-pmy1vg)
- [`REQ-LC-5-MM0BM9` (The storage of a followed contract is carried across blocks only by pushed…)](../../../../../../../specification/runtime/light-client.md#req-lc-5-mm0bm9)
- [`REQ-LC-6-NEFA2N` (Carried storage is proven again at an interval)](../../../../../../../specification/runtime/light-client.md#req-lc-6-nefa2n)
- [`REQ-LC-7-W8WDN3` (A refused pushed block is not used and is made known)](../../../../../../../specification/runtime/light-client.md#req-lc-7-w8wdn3)
