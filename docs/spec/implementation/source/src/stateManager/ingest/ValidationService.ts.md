# ValidationService.ts

> **Source:** [src/stateManager/ingest/ValidationService.ts](../../../../../../../src/stateManager/ingest/ValidationService.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)
- [`REQ-BLOCK-PIPE-3-WW2SB7` (Strategy-complete deviations)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7)
- [`REQ-BLOCK-PIPE-8-N529VH` (Evidence precedes escalation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)
- [`REQ-LIF-7-0XZBDM` (A committed dispute suspends off-chain execution on the disputed)](../../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)
- [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- [`REQ-SM-6-BJZVQ5` (Turn authorization enforced generically at the protocol layer)](../../../../../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5)
  Partial: On-chain invalid-state-transition replay does not perform the generic leader check, so wrong-turn slashing still depends on an in-contract guard ([`OQ-26-XH59SP` (On-chain wrong-turn enforceability)](../../../../../specification/open-questions.md#oq-26-xh59sp)).
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)

## UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV

Predicate chain

- Setup: Violate each predicate alone and in combinations across contexts; drive time edges with and without recoverable calldata
- Oracle: First relevant failure routes to its hook; recovery retry legitimizes exactly the granted cases; subjective park never produces evidence

- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P1` — channel predicate alone
- [ ] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P2` — combination order
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P3` — double-sign conflict class
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P4` — timestamp boundary with recovery retry
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P5` — on-time post short-circuit
- [ ] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P6` — subjective window live-only
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P7` — channel-open predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P8` — author-membership predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P9` — conflict-classification predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P10` — live-gates predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P11` — linkage predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P12` — scheduled-leader predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P13` — objective-timestamp predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P14` — on-chain post-timing predicate alone
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P15` — linked invalid-transition conflict class
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P16` — wrong-genesis conflict class
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P17` — replayed-own-block double-sign conflict class
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P18` — unlinked unattributable conflict class
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P19` — timestamp boundary without recoverable calldata
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P20` — author-membership predicate binds the author to the previous snapshot and to a coordinate-matched resulting snapshot
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P21` — a block replayed from a verified synchronization proof outside the agreement window applies while the same live arrival parks
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P22` — a linked insertion from the wrong leader reaches the SDK deviation without changing state or eligibility
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P23` — live normalization without source attribution strips bad confirmations without blaming the author
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P24` — a malformed-only copy retains its author envelope and charges the rejected confirmation
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P25` — normalization strips an unrecoverable confirmation and punishes only its supplier
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P26` — spectating normalization preserves valid confirmations after a malformed first value
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P27` — shared malformed confirmation punishes both actual suppliers
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P28` — duplicate malformed bytes use one charged slot and are removed once
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P29` — sourceless replay strips irrelevant malformed confirmations without transport punishment
- [x] `UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P30` — calldata strategy rejects the impossible confirmation-bearing shape

## UNIT-TEST-SM-VALIDATION-1-1GFNNY

Author decision

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1)

- [ ] `UNIT-TEST-SM-VALIDATION-1-1GFNNY.P1` — An empty participant state accepts exactly the selected author
- [ ] `UNIT-TEST-SM-VALIDATION-1-1GFNNY.P2` — a one-participant state accepts exactly the selected author
- [ ] `UNIT-TEST-SM-VALIDATION-1-1GFNNY.P3` — a many-participant state accepts exactly the selected author across a full turn cycle
- [ ] `UNIT-TEST-SM-VALIDATION-1-1GFNNY.P4` — a wrong author is rejected
- [ ] `UNIT-TEST-SM-VALIDATION-1-1GFNNY.P5` — a non-member author is rejected

## UNIT-TEST-SM-VALIDATION-2-NNZ28B

Strategy coverage

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1)

- [ ] `UNIT-TEST-SM-VALIDATION-2-NNZ28B.P1` — The live strategy receives the deviation with the correct precomputed attribution and side effect
- [ ] `UNIT-TEST-SM-VALIDATION-2-NNZ28B.P2` — the stored strategy receives the same deviation with the correct attribution and side effect
- [ ] `UNIT-TEST-SM-VALIDATION-2-NNZ28B.P3` — the spectating strategy receives the same deviation with the correct attribution and side effect
- [ ] `UNIT-TEST-SM-VALIDATION-2-NNZ28B.P4` — the dispute strategy receives the same deviation with the correct attribution and side effect

## UNIT-TEST-SM-VALIDATION-3-8KG380

Membership boundaries

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1)

- [ ] `UNIT-TEST-SM-VALIDATION-3-8KG380.P1` — A join immediately before validation changes the eligible author according to the exact pre-state, never stale state
- [ ] `UNIT-TEST-SM-VALIDATION-3-8KG380.P2` — a removal immediately before validation changes the eligible author according to the exact pre-state
- [ ] `UNIT-TEST-SM-VALIDATION-3-8KG380.P3` — a slash immediately before validation changes the eligible author according to the exact pre-state

## UNIT-TEST-SM-VALIDATION-4-8032ZY

Selector failure

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1)

- [ ] `UNIT-TEST-SM-VALIDATION-4-8032ZY.P1` — Query failure rejects/defer the work through the defined pipeline without executing the transition or losing the queued entry
