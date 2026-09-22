# StateChannelCommon.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`REQ-CONTRACT-ARCH-2-BE651C` (Shared validation)](../../../../../specification/enforcement/contracts.md#req-contract-arch-2-be651c)
- [`INV-ENFFP-1-BGVZN4` (Slash set integrity)](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4)
- [`REQ-DIS-2-PKVZ7E` (Upload is limited to eligible disputers)](../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e)
- [`REQ-LIF-8-2HDG3A` (Enumerable open-channel lifecycle)](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)
- [`INV-MSG-1-36Y41Q` (Each stream is one hash-linked chain per channel)](../../../../../specification/settlement/cross-layer-messages.md#inv-msg-1-36y41q)
- [`REQ-MSG-2-7YAD1A` (A dispute's claimed inbound tip MUST be an ancestor of the chain tip with…)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-2-7yad1a)
- [`REQ-DIS-4-6J6YYG` (Reduction runs only after the kill period expires and consumes exactly the…)](../../../../../specification/disputes/disputes.md#req-dis-4-6j6yyg)
- [`REQ-DIS-6-Y92H1M` (Every initiated dispute window MUST end in a canonical successor fork, genesis…)](../../../../../specification/disputes/disputes.md#req-dis-6-y92h1m)
- [`REQ-FIN-7-RTZWQZ` (The threshold is unanimous over the _relevant participant set_)](../../../../../specification/protocol-model/finality.md#req-fin-7-rtzwqz)
- [`REQ-FP-3-2AJAZ7` (Slashes are recorded only via addOnChainSlashedParticipant)](../../../../../specification/disputes/fraud-proofs.md#req-fp-3-2ajaz7)
- [`REQ-FP-4-WHKBXP` (A recorded slash disqualifies the participant from dispute participation and…)](../../../../../specification/disputes/fraud-proofs.md#req-fp-4-whkbxp)
- [`INV-FP-8-BFNRSY` (Proof application is idempotent per offender)](../../../../../specification/disputes/fraud-proofs.md#inv-fp-8-bfnrsy)
- [`INV-MSG-2-PQ0T1K` (No replay, no omission)](../../../../../specification/settlement/cross-layer-messages.md#inv-msg-2-pq0t1k)

## UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK

Shared predicates

- Setup: Drive each shared predicate/derivation through two different facet paths
- Oracle: Identical classification per path; pending derivation matches unconsumed JOINs; slash queries respect timestamps

- [ ] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P1` — linkage predicates cross-path agreement
- [ ] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P2` — pending-participant derivation
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P3` — slash append/query bounds
- [ ] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P4` — authenticity predicate parity with client use
- [ ] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P5` — threshold-set derivation cross-path agreement
- [ ] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P6` — canParticipateInDisputes cross-path agreement
- [ ] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P7` — inbound/outbound chain verification cross-path agreement
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P8` — the pending set holds only joins the current snapshot has not consumed (empty after open, the joiner after its deposit, never the open joins)
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P9` — current snapshot member remains eligible despite an old JOIN, in both upload modes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P10` — JOIN at the latest inbound head is eligible, in both upload modes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P11` — JOIN inside the unconsumed interval is eligible, in both upload modes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P12` — nonparticipant JOIN at the consumed boundary is rejected in both upload modes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P13` — older out-of-bound nonparticipant is rejected in both upload modes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P14` — on-chain-slashed snapshot participant is rejected in both upload modes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P15` — on-chain-slashed pending JOIN is rejected in both upload modes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P16` — committing a reduced result against a fork whose dispute window was never created reverts `RaceConditionDisputeWindowNotOpen(channelId, forkId)` instead of a kill-period deadline
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P17` — committing a reduced result while the window's kill period is still running reverts naming the kill-period end and the strictly earlier call timestamp
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P18` — committing a second reduced result against an already-reduced window reverts naming three distinct forks: the window's own, the reduced fork already committed and the one submitted now
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P19` — an outbound EXIT message whose amount disagrees with its embedded exit channel reverts naming the participant, the embedded exit amount and the message amount as three distinguishable values
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P20` — persisting an inbound message block whose hash is already stored reverts naming both the channel and the block hash

## UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7

Enumerable live-channel registry

- Setup: Open and fully close real channels through proxy/facet entry points, then read public pages.
- Oracle: Successful opens append once; failed opens do not mutate; final close removes first/middle/last, repairs the moved index, tolerates repeat, permits one clean reopen, and matches lifecycle events.

- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P1` — append order and safe paging
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P2` — duplicate-open rollback
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P3` — remove first and repair moved index
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P4` — remove middle
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P5` — remove last
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P6` — repeated final close is a no-op
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P7` — reopen appends exactly once
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P8` — full lifecycle event set equals paged registry
- [x] `UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P9` — TypeScript event query reconstructs successful opens and matches paged reads
