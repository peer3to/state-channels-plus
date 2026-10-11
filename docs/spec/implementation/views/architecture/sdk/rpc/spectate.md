# Verifiable State Synchronization

> **Specification subject:** [Verifiable State Synchronization (Spectate/Sync)](../../../../../specification/peer-communication/synchronization.md)

## Gaps

- [`REQ-SPC-3-AZBKR1` (No permanent exclusion for can't-prove-yet)](../../../../../specification/peer-communication/synchronization.md#req-spc-3-azbkr1)
  Missing: `onSpectateRequest` blacklists the requester whenever `generateSyncPayload` cannot prove the target, including an honest can't-prove-yet request ([`DEF-10-199C7F`](../../../../../audit/open-findings.md#def-10-199c7f)).
- [`REQ-RPC-5-CV1R1Y` (Resource bounds)](../../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y)
  Missing: `onSpectateRequest` applies no per-peer rate or cost limit to `generateSyncPayload` ([`OQ-6-4JPNE5` (P2P gossip rate limiting)](../../../../../specification/open-questions.md#oq-6-4jpne5)).
