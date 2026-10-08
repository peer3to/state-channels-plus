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
- [`REQ-SP-3-SP1JG4` (A membership hop requires signatures from the union of the previous…)](../../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)

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
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P21` — A milestone-only proof survives ABI round-trip, selects the last block of its last milestone as its latest state, and walks to its proven first-block final point
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P22` — An empty proof verifies with genesis as its final point and replay index zero, and its genesis latest-state claim passes
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P23` — With a non-genesis chain anchor, an empty proof still returns genesis as its final point and is separately below that anchor
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P24` — A nonempty anchor-only proof returns the exact anchor snapshot, has no replay tail, passes latest-state linkage and is not below the anchor
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P25` — An author-only genesis block zero verifies with genesis still final and replay beginning at zero
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P26` — A linked author-only genesis-zero run verifies with genesis final and replay beginning at zero
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P27` — A threshold-signed genesis-zero run finalizes block zero and sets replay index one
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P28` — A block-zero resulting snapshot used as chain anchor finalizes zero without threshold signatures and starts replay at index one
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P29` — A threshold-signed block at height zero committing another snapshot does not match the block-zero chain anchor, with either supplied snapshot entry
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P30` — A matching anchor at the first run position verifies, remains final and sets replay index one
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P31` — A matching anchor at the middle run position verifies, remains final and sets replay index two
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P32` — A matching anchor at the final run position verifies, remains final and sets replay index to run length
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P33` — A run block at anchor height committing another snapshot returns invalid without classifying the supplied evidence as snapshot mismatch
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P34` — A threshold-proven first hop above the anchor verifies without an anchor block and finalizes that hop
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P35` — An above-anchor first hop without the required signatures returns invalid
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P36` — Including the anchor block allows an author-only extension above it while keeping the anchor as final point
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P37` — Linkage of an author-only tail does not advance finality beyond the matching anchor
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P38` — A broken retained link after the anchor makes the walk invalid
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P39` — A threshold-signed block zero with the wrong genesis predecessor makes the walk invalid
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P40` — Wholly pre-anchor milestones and a crossing-run prefix are skipped despite junk, missing threshold and forged entries; retained anchor and replay index remain correct
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P41` — A foreign-fork first block below the matching anchor in a crossing run is skipped and the retained walk succeeds
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P42` — A valid genesis-built proof remains valid after the chain start advances to block zero, preserving its later final point and replay index
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P43` — Advancing the anchor into a proof makes that matching interior anchor its final point and adjusts replay index
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P44` — Advancing the anchor to the proof endpoint leaves a valid walk with no replay tail
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P45` — Advancing the anchor beyond the proof endpoint leaves a valid walk final at the anchor with no remaining tail
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P46` — A participant-addition hop with old and new union signatures verifies and finalizes its authenticated snapshot
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P47` — A participant-removal hop with the old and new union signatures verifies and finalizes its authenticated snapshot
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P48` — A proven departure followed by a proven join uses each hop's own union, so the departed signer is not needed for the later join
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P49` — Omitting the earlier departure hop leaves its signer required by the anchor-to-join union; missing that signature rejects the hop
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P50` — Direct signatures on one block establish a valid above-anchor threshold hop and its final point
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P51` — Distinct author signatures across linked blocks establish virtual-voting finality of the first block
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P52` — Direct first-block signatures plus a linked later author signature establish the same first-block final point
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P53` — Below-threshold signatures on an above-anchor hop return invalid
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P54` — Exactly the required signer set finalizes an above-anchor hop
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P55` — A complete required signer set plus an outside signer still finalizes the hop
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P56` — A removal hop missing the departing old-set member signature is invalid
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P57` — An addition hop missing the joining new-set member signature is invalid
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P58` — Several unfinalized membership changes committed in one anchor run remain a valid replay tail without advancing the finalized point
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P59` — Separating unsigned membership changes into claimed final hops returns invalid
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P60` — Duplicate signatures from one required participant cannot replace the missing required signer
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P61` — An outside signer cannot replace a missing required participant
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P62` — A genesis-zero addition with the complete old/new/consumed-joiner union finalizes zero
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P63` — A genesis-zero removal with the old/new union including the leaver finalizes zero
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P64` — A genesis-zero removal missing the leaver signature remains a valid unfinalized run replayed from genesis
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P65` — A genesis-zero addition missing the joiner signature remains a valid unfinalized run replayed from genesis
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P66` — A supplied hop snapshot at another height returns invalid with snapshotMismatch true
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P67` — A supplied snapshot with the correct height but wrong state hash returns invalid with snapshotMismatch true
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P68` — A later on-chain slash preserves validity of a complete historical proof and does not remove the slashed signer from its required threshold
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P69` — An empty milestone returns invalid without snapshotMismatch
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P70` — A missing milestone snapshot entry returns invalid with snapshotMismatch
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P71` — An excess milestone snapshot entry returns invalid with snapshotMismatch
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P72` — Exactly one correct snapshot entry for a single hop verifies and yields the correct final point and replay index
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P73` — Overlapping anchor and later-final runs carrying different signature evidence for their shared block verify with the later first block finalized
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P74` — A changed shared block in the second overlapping run breaks the proof even when its supplied snapshot matches that changed block
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P75` — A hop consuming a JOIN while the joiner is absent from both endpoint sets fails without that joiner signature, with authenticated snapshot evidence
- [x] `UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P76` — A hop consuming a JOIN while the joiner is absent from both endpoint sets verifies with that joiner signature and finalizes its snapshot

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
