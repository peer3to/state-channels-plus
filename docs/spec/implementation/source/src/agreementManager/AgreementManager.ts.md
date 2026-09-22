# AgreementManager.ts

> **Source:** [src/agreementManager/AgreementManager.ts](../../../../../../src/agreementManager/AgreementManager.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-FIN-3-9P9J4Q` (A signature on block B is also an indirect vote for every ancestor of B on the)](../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q)
- [`REQ-SP-1-9YABY1` (A milestone is not merely a list of independently threshold-signed blocks)](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
- [`REQ-SP-2-ST4JJ4` (A state proof establishes a path from one final anchor to the next, and finally…)](../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
- [`REQ-SP-3-SP1JG4` (A join or removal changes the threshold set, so a proof crossing a membership…)](../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)
- [`REQ-MIRROR-3-THD7K8` (Cache, never authority)](../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8)
- [`REQ-IX-4-BB35GC`](../../../../specification/disputes/README.md#req-ix-4-bb35gc)
- [`REQ-FIN-7-RTZWQZ` (The threshold is unanimous over the _relevant participant set_)](../../../../specification/protocol-model/finality.md#req-fin-7-rtzwqz)
- [`REQ-FIN-4-ZFDDS6` (Consequently, in a channel with N participants, N consecutive blocks authored)](../../../../specification/protocol-model/finality.md#req-fin-4-zfdds6)

## UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D

Proof construction

- Setup: Build proofs across membership changes, virtual-finality windows, genesis anchoring, and suffix fallback
- Oracle: Milestones at every change point; virtual coverage computed per the union rule; proofs verify under the canonical facet

- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P1` — hop per membership change
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P2` — virtual coverage window
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P3` — genesis-anchored fallback
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P4` — suffix fallback
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P5` — facet-verification round trip
- [x] `UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P6` — proof requested at the exact join-block height, raised threshold completed only above it → tops out at the requested height

## UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX

Reduction inbound evidence

- Setup: Build reduce data with a complete store, a dropped recoverable event, and an unrecoverable range
- Oracle: Complete data passes; chain recovery restores dropped events; exhaustion returns unavailable before local reduction

- [x] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P1` — complete local range
- [x] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P2` — missing event recovered from chain
- [x] `UNIT-TEST-AGREEMENT-MANAGER-2-FY9GCX.P3` — recovery exhaustion returns unavailable for retry
