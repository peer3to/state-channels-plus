# EventHandler.ts

> **Source:** [src/eventHandlers/EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md), [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7)
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
  Missing: Counter-dispute after a kill is disabled in code in favor of event-driven replacement (open sequencing question); the atomic kill-plus-replacement multicall is a code TODO.
- [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
- [`REQ-LIF-7-0XZBDM` (A committed dispute suspends off-chain execution on the disputed)](../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)

## UNIT-TEST-EVENT-HANDLER-1-RZ2C7W

Dispute-event branches

- Setup: Deliver committed/killed/slashed/reduced events across final/expired/auditable, relevant/irrelevant, duplicate, and race cases
- Oracle: Branches per the pipeline algorithm; replication precedes action; improvement rule uploads only outcome-changers; challenges fire on mismatched reductions

- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P1` — final branch
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P2` — dedup
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P3` — relevance gate
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P4` — improvement uploads
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P5` — kill→replacement first-wins
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P6` — adopt matching reduction
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P7` — expired branch
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P8` — auditable branch
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P9` — non-improvement skips upload
- [ ] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P10` — challenge mismatched reduction
- [x] `UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P11` — improvement upload skipped as already initiated: reduction still scheduled
