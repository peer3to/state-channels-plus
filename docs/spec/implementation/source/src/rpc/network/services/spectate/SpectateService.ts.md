# SpectateService.ts

> **Source:** [src/rpc/network/services/spectate/SpectateService.ts](../../../../../../../../../src/rpc/network/services/spectate/SpectateService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/spectate.md](../../../../../../views/architecture/sdk/rpc/spectate.md)

## Requirements

- [`INV-SYNC-1-XCQZ28` (Nothing trusted on receipt)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-1-xcqz28)
- [`INV-SYNC-2-AT3RXE` (Requester-anchored validation)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-2-at3rxe)
  Contradicts: Two divergences from the synchronization algorithm text, decided by no requirement: the requester aborts a stale proof only when the on-chain snapshot is strictly past the proved position (the text says "at or past"), and the responder serves the on-chain-tip-to-genesis outbound range only across forks. See [`OQ-IMPL-SYNC-BOUNDARY-1-4AFPKM`](../../../../../../open-questions.md#oq-impl-sync-boundary-1-4afpkm).
- [`INV-SYNC-3-A7A2ED` (Fail-closed with caller-owned consequence)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed)
- [`INV-SYNC-4-Z6HER7` (Read-only trust establishment)](../../../../../../../specification/peer-communication/synchronization.md#inv-sync-4-z6her7)
- [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-1-t2589h)
  Partial: [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f): honest can't-prove-yet refusal punishes the requester (fault taxonomy pending).
- [`REQ-SYNC-2-TNT4F4` (Economic soundness before adoption)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-2-tnt4f4)
- [`REQ-SYNC-3-1P5ZHT` (Suffix through the standard pipeline)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-3-1p5zht)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../../../../../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)

## UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT

Requester verification chain

- Setup: Serve payloads with each element individually forged; alter echoes; force each abort step and snapshot race; both requester roles
- Oracle: Every forgery aborts at its step with role-correct consequences; echoes ignored; no transaction ever sent; valid payload adopts and replays

- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P1` — forged dispute window
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P2` — altered echo ignored
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P3` — spectator full abort
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P4` — no-transaction property
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P5` — valid adoption + suffix replay
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P6` — one-in-flight per peer
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P7` — forged genesis snapshot
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P8` — forged state proof
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P9` — forged latest finalized state
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P10` — forged pre-genesis outbound blocks
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P11` — forged latest-fork outbound blocks
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P12` — participant peer-cut abort
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P23` — a sync request that fails by refusal or timeout records one strike on the selected peer and no verdict
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P13` — same-fork proof remains adoptable when its exact target snapshot lands before validation
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P14` — height-too-old simulation with the exact target already on-chain and no pending reductions succeeds
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P15` — height-too-old simulation with a different on-chain snapshot fails
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P16` — exact target with pending reductions succeeds only when the reductions-only multicall simulates
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P17` — exact target with a failing pending reduction is rejected
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P18` — a second sync toward a peer with one in flight answers false without cutting the peer, while a probe that waits behind it runs once it settles
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P19` — ordinary pinned sync adopts a verified successor without an optional flag
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P20` — ordinary pinned sync refuses an unknown fork and preserves local fork identity
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P21` — concurrent proof verification does not treat a local simulated reduction as chain finality
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P22` — a chain reduction landing after window persistence cannot reject an honest proof
- [ ] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P26` — an already-final chain window contributes no reduction input to snapshot simulation
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P24` — two source syncs share one local EVM; a second persist after the first reduction cannot reject either proof or blacklist either responder
- [x] `UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P25` — two identical supplied windows cause one finality multicall and reject with more than one unreduced window

## UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD

Responder proving

- Setup: Request latest/pinned/height-0/above-latest/unknown-fork targets from varied local states
- Oracle: Pinned forks or verified successors proven; unrelated or unavailable targets refused; malformed height rejected pre-walk; same-fork payload omits cross-fork evidence; refusal consequence documents [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f)

- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P1` — latest-target success
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P2` — height-0 pin
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P3` — above-latest refused
- [ ] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P4` — unknown fork refused
- [ ] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P5` — malformed height cheap-rejected
- [ ] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P6` — lagging-responder refusal (documents [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f))
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P7` — pinned-target success
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P8` — same-fork payload emits an empty pre-genesis outbound segment while preserving the latest-fork outbound proof
- [x] `UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P9` — a recovered dispute window identifies a successor whose genesis is not installed; proof serving uses the computed genesis before installation
