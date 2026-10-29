# Verifiable State Synchronization

> **Specification subject:** [Verifiable State Synchronization (Spectate/Sync)](../../../../../specification/peer-communication/synchronization.md)

## Gaps

- [`REQ-RPC-5-CV1R1Y` (Resource bounds)](../../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y)
  Missing: `onSpectateRequest` applies no per-peer rate or cost limit to `generateSyncPayload` ([`OQ-6-4JPNE5` (P2P gossip rate limiting)](../../../../../specification/open-questions.md#oq-6-4jpne5)).
