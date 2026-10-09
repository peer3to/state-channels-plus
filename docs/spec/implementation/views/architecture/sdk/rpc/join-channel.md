# Join-Authorization Collection

> **Specification subject:** [Join-Authorization Collection](../../../../../specification/peer-communication/join-authorization.md)

## Gaps

- [`REQ-RPC-5-CV1R1Y` (Resource bounds)](../../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y)
  Missing: `signJoinRequest` performs chain reads for every request, including penalty-free invalid ones, with no per-peer rate or cost bound ([`OQ-6-4JPNE5` (P2P gossip rate limiting)](../../../../../specification/open-questions.md#oq-6-4jpne5)).
