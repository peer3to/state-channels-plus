# LightClientRpcProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/LightClientRpcProvider.ts)

## Requirements

- [`REQ-LC-9-KWXV43` (A read takes from the pushed partitions what they prove at its block)](../../../../../../specification/runtime/light-client.md#req-lc-9-kwxv43)
- [`REQ-LC-10-YCP80W` (The stages of each accepted pushed block are kept)](../../../../../../specification/runtime/light-client.md#req-lc-10-ycp80w)
- [`REQ-LC-1-JT5PKT` (Reads at the latest block are answered from proven state of one block)](../../../../../../specification/runtime/light-client.md#req-lc-1-jt5pkt)
- [`REQ-LC-2-PMY1VG` (What cannot be answered from proven state goes to the endpoint)](../../../../../../specification/runtime/light-client.md#req-lc-2-pmy1vg)
- [`REQ-LC-3-W7RRHM` (A failed read falls back to the endpoint and is made known)](../../../../../../specification/runtime/light-client.md#req-lc-3-w7rrhm)
- [`REQ-LC-4-E29Y46` (The light client is on when the endpoint serves it)](../../../../../../specification/runtime/light-client.md#req-lc-4-e29y46)
- [`REQ-LC-5-MM0BM9` (A followed channel is subscribed on every connection)](../../../../../../specification/runtime/light-client.md#req-lc-5-mm0bm9)
- [`REQ-LC-7-W8WDN3` (A refused or ended subscription syncs again and is made known)](../../../../../../specification/runtime/light-client.md#req-lc-7-w8wdn3)
- [`REQ-LC-11-MTCBF9` (With the reads compared, each answer is checked against the endpoint's at its…)](../../../../../../specification/runtime/light-client.md#req-lc-11-mtcbf9) (With the reads compared, each answer is checked against the endpoint's at its block)
- [`REQ-MIRROR-5-N5SZC9` (With proven chain reads, the chain answers alone)](../../../../../../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9) (With proven chain reads, the chain answers alone)
