# StateTransitionRpcMethods.ts

> **Source:** [src/rpc/network/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../../../../../src/rpc/network/services/stateTransition/StateTransitionRpcMethods.ts)

## Requirements

- [`REQ-GOSSIP-1-HTK3NX` (Thin attributed ingress)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx)
- [`REQ-GOSSIP-2-9PMMNH` (Verdict-mapped consequences)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-2-9pmmnh)
- [`REQ-IX-1-WTJ0D1` (Peer block ingress)](../../../../../../../specification/interactions.md#req-ix-1-wtj0d1)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)

## UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT

Attribution and penalty mapping

- Setup: Deliver valid/duplicate/junk confirmations; inject a local ingest failure
- Oracle: Payload reaches ingest byte-identical with sender attribution; peer-fault verdicts punish; a local ingest failure is logged, keeps the sender's session and never punishes it

- [ ] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P1` — payload fidelity + attribution
- [ ] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P2` — acceptable-knowledge no penalty
- [ ] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P3` — attributable violation punishes
- [x] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P4` — local failure logged, session kept, sender unpunished
