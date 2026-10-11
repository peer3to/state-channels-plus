# DisputeBuilder.ts

> **Source:** [src/disputeManager/DisputeBuilder.ts](../../../../../../src/disputeManager/DisputeBuilder.ts)
>
> **Design views:** [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DIS-1-XAJ1VA` (A dispute MUST state at least one of the five valid inputs)](../../../../specification/disputes/disputes.md#req-dis-1-xaj1va)
- [`REQ-DIS-10-SAHJBN` (Timeout claims MUST satisfy the deadline, linkage, schedule, and existence…)](../../../../specification/disputes/disputes.md#req-dis-10-sahjbn)
- [`REQ-SP-1-9YABY1` (A milestone normally proves its first block final, directly or through…)](../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
- [`REQ-SP-2-ST4JJ4` (Proofs connect the trusted start through required final membership hops to the…)](../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`REQ-DIS-11-WQK8P2` (A dispute MUST list on-chain slashes only of participants of its latest state…)](../../../../specification/disputes/disputes.md#req-dis-11-wqk8p2)
- [`REQ-DISPUTE-PIPE-13-R2QJZN` (Time out only the next height)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-13-r2qjzn)
- [`REQ-DA-1-NVV85Z` (Block data whose calldata commitment is posted MUST be recoverable from the…)](../../../../specification/security/data-availability.md#req-da-1-nvv85z)

## UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN

Dispute construction reuses a built dispute only while its inputs are unchanged and proves the latest state it read.

- Setup: Use the public construction boundary (`DisputeManager.constructDispute`) and `reconstructAuditingData` on a running peer with a real valid state proof. Construct twice with no change; construct, then change one input through its owner (a newer committed block, a started exit, a real participant timeout past its deadline, fraud evidence stored by the validation pipeline) and construct again; hold construction at its state-proof build while a newer block commits or fraud evidence is stored; name a snapshot absent from storage in a dispute input. Additional valid signatures on the same latest block are not a changed input.
- Oracle: Unchanged inputs return the cached result object. A changed input yields a dispute that differs from the cached one in exactly that input: the later block's state and the chain-accepted proof of it, `selfRemoval` true, the eligible timeout an honest auditor accepts, the applied fraud proof and its slash. A newer block during construction makes the returned dispute prove the later block throughout (inputs, proof and auditing data agree and the chain accepts them), never the first proof with the second inputs. Extra signatures alone cause no evidence improvement or forced recomputation; all authenticity, finality and validity checks remain required. A missing stored snapshot rejects with that snapshot's hash and returns no auditing data. Valid auditing data retained after omission becomes allowed remains acceptable; no calldata-minimization oracle is required for current work. The optional optimization is tracked by [`OQ-IMPL-DISPUTE-CALLDATA-1-S2XEBS` (Optional auditing calldata on a reused dispute)](../../../open-questions.md#oq-impl-dispute-calldata-1-s2xebs).

- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P1` — additional valid signatures on the unchanged latest block do not force recomputation or change the evidence-comparison result
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P2` — a newer block arriving during construction changes the latest state and the returned dispute proves that state
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P3` — unchanged inputs: a second construction returns the cached result without building again
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P4` — a newer latest block committed after a completed construction: the next construction proves that block with its own state proof, and the chain accepts it
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P5` — an exit started after a completed construction (the force-exit flag set): the next construction of the same latest state carries the self-removal and differs from the cached dispute
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P6` — a participant timeout that becomes eligible after a completed construction: the next construction claims it for the next height, and an honest auditor accepts the dispute
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P7` — fraud evidence stored by the validation pipeline after a completed construction: the next construction applies that proof and lists the offender's slash
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P8` — fraud evidence stored while the state proof is being built, with the latest block unchanged: the returned dispute applies that proof and lists the offender's slash
- [x] `UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P9` — `reconstructAuditingData` for a dispute naming a snapshot absent from storage rejects with that snapshot's hash and returns no auditing data

## UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R

Construction correctness

- Setup: `constructDispute(forkId)` with storage fixtures varying slashes, proofs, timeout, force-exit, inbound tip
- Oracle: Dispute fields equal fixture-derived expectations; claimed slashes ⊆ participants; held proofs for unslashed members enter `fraudProofsToApply` and the claimed set; output hash equals the mirrored staticCall result

- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P1` — slash subset and proof folding
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P2` — empty timeout struct
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P3` — self-removal flag
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P4` — inbound tip fields from a populated stream
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P5` — snapshot/state hash mismatch throws
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P6` — finality probe not-final posts auditing data
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P7` — held timeout struct
- [ ] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P8` — empty-stream tip defaults
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P9` — finality probe final skips auditing data
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P10` — local probe "not final" posts auditing data with no chain probe
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P11` — local probe "final", chain "not final": auditing data is posted
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P13` — local probe "final", chain "final": exactly one chain read and the auditing data is left out
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P14` — local probe fails outside the EVM (executor transport failure): construction throws it and the chain is never read
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P15` — local probe "final", chain read fails with a transport error: construction throws it, no dispute is built
- [x] `UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P16` — the auditing-data omission predicate reverts locally during dispute construction: construction fails without a chain read or a constructed dispute

## UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ

Auditing-data assembly; missing local data throws

- Setup: `constructDispute(forkId)` (its `buildAuditingData`) with each element present and absent
- Oracle: Complete fixtures yield exact ranges and snapshots; each locally missing element makes construction throw; no partial dispute is submitted

- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P1` — complete assembly
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P2` — missing milestone snapshot: construction throws and no dispute is built
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P3` — inbound range bounds incl. pinned upper hash
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P4` — genesis-anchored fork (no milestones)
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P5` — missing latest-state snapshot: construction throws and no dispute is built
- [ ] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P6` — missing finalized state-machine state: construction throws and no dispute is built
- [x] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P8` — the outbound range holds only the blocks above the on-chain snapshot's outbound head, up to the latest state's, and the chain accepts the dispute.
- [x] `UNIT-TEST-DISPUTE-MANAGER-5-M4E8PZ.P18` — a successor fork while the chain anchor is still on the parent fork (no successor snapshot posted): the dispute built on the successor carries auditing data cut at that parent-fork anchor, the chain accepts its proof and an honest auditor accepts it without a counter.
