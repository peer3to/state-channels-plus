# StateTransitionRpcMethods.ts

> **Source:** [src/rpc/network/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../../../../../src/rpc/network/services/stateTransition/StateTransitionRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/state-transition.md](../../../../../../views/architecture/sdk/rpc/state-transition.md)

## Requirements

- [`REQ-GOSSIP-1-HTK3NX` (Thin attributed ingress)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-1-htk3nx)
- [`REQ-GOSSIP-2-9PMMNH` (Verdict-mapped consequences)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-2-9pmmnh)
  Partial: [`DEF-9-724SXP`](../../../../../../../audit/open-findings.md#def-9-724sxp): local faults not partitioned from peer faults before punishing.
- [`REQ-IX-1-WTJ0D1` (Peer block ingress)](../../../../../../../specification/interactions.md#req-ix-1-wtj0d1)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)

## UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT

Attribution and penalty mapping

- Setup: Deliver valid/duplicate/junk confirmations; inject a local ingest failure
- Oracle: Payload reaches ingest byte-identical with sender attribution; peer-fault verdicts punish; local fault documents [`DEF-9-724SXP`](../../../../../../../audit/open-findings.md#def-9-724sxp)

- [ ] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P1` — payload fidelity + attribution
- [ ] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P2` — acceptable-knowledge no penalty
- [ ] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P3` — attributable violation punishes
- [ ] `UNIT-TEST-STATE-TRANSITION-METHODS-1-AVMVVT.P4` — local failure (documents [`DEF-9-724SXP`](../../../../../../../audit/open-findings.md#def-9-724sxp))
