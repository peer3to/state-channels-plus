# StateSnapshotFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol)

## Requirements

- [`INV-ENFSNAP-1-9VZ2HE` (Single monotone snapshot)](../../../../../specification/enforcement/snapshot-adoption.md#inv-enfsnap-1-9vz2he)
- [`REQ-ENFSNAP-1-FYN3BW` (Coupled adoption and outbound processing)](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-1-fyn3bw)
- [`REQ-ENFSNAP-2-MGRCY8` (Batch-split invariance)](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-2-mgrcy8)
- [`REQ-ENFSNAP-3-VD9T8A` (Inbound-consumption gate)](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a)
- [`REQ-ENFSNAP-4-ESP98F` (Disputed-fork advance rule)](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-4-esp98f)
- [`REQ-LIF-8-2HDG3A` (Enumerable open-channel lifecycle)](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)
- [`INV-MSG-4-6E5G7V` (totalWithdrawals ≤ totalDeposits at every outbound processing step)](../../../../../specification/settlement/cross-layer-messages.md#inv-msg-4-6e5g7v)
- [`INV-MSG-5-YC48R5` (Processed tips advance only to strictly newer descendants)](../../../../../specification/settlement/cross-layer-messages.md#inv-msg-5-yc48r5)
- [`REQ-MSG-4-SC1FEX` (Outbound processing MUST verify the linked range and skip the processed prefix…)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-4-sc1fex)
- [`REQ-MSG-6-MZNQAM` (Snapshot advance MUST require finality or finalized reduction + expired…)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-6-mznqam)
- [`REQ-DIS-9-64WHCD` (The on-chain snapshot advances to a successor fork only along committed…)](../../../../../specification/disputes/disputes.md#req-dis-9-64whcd)
- [`REQ-LIF-1-A5BN02` (The best-case complete lifecycle needs at least two base-layer transactions)](../../../../../specification/settlement/lifecycle.md#req-lif-1-a5bn02)
- [`REQ-LIF-2-Z3Z9Y3` (Exactly two paths lead to a state that can update the on-chain snapshot and…)](../../../../../specification/settlement/lifecycle.md#req-lif-2-z3z9y3)
- [`INV-LIF-5-ENQB91` (Settlement conserves value)](../../../../../specification/settlement/lifecycle.md#inv-lif-5-enqb91)
- [`REQ-MSG-8-N1ECJ5` (Exits MUST be withdrawable only through snapshot advance)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-8-n1ecj5)
- [`REQ-SP-5-MTE4RV` (The final block of the last milestone commits the latest claimed state)](../../../../../specification/disputes/state-proofs.md#req-sp-5-mte4rv)
- [`REQ-DIS-12-AXY60R` (Posted auditing data MUST carry an outbound run that, cut at the current…)](../../../../../specification/disputes/disputes.md#req-dis-12-axy60r)

## UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB

Advance paths

- Setup: Advance same-fork/successor-fork with valid, split, overlapping, gapped ranges and failing withdrawals
- Oracle: At-most-once release; batch splits converge; regressions/contestable links revert; inbound gate holds

- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P1` — both paths valid
- [ ] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P2` — batch-split convergence
- [ ] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P3` — overlap pruned
- [ ] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P4` — gap reverts
- [ ] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P5` — withdrawal failure atomic
- [ ] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P6` — cap boundary
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P7` — pending-inbound gate
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P8` — fork update whose target snapshot is not genesis reverts naming the fork the snapshot data hashes to, the fork it claimed, and its block height
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P9` — fork update whose origin fork has no dispute window reverts naming channel, origin fork and target fork, because the chain cannot date the genesis
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P10` — fork update whose target timestamp differs from the dated genesis reverts naming both timestamps
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P11` — fork update to a genesis-shaped, correctly dated target that no chain of expired reduced results reaches reverts naming the current fork and the target fork
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P12` — same-fork advance with a snapshot behind the one already on chain reverts naming the on-chain block height and the submitted block height
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P13` — same-fork advance whose milestone proof count differs from its snapshot count reverts naming the fork under advance and both counts
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P14` — outbound apply whose message processing fails reverts naming the failing message's block index, message index and participant
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P15` — same-fork advance refused on a disputed fork inside its kill period, snapshot and registry unchanged
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P16` — same-fork advance still refused on a disputed fork after its kill period expired
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P17` — same-fork advance accepted with no window
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P18` — a window on another fork does not block the advance
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P19` — an invalid proof on a disputed fork reports the proof failure, not the refusal
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P21` — an unlinked successor-fork target reports the invalid-snapshot failure
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P23` — a successor-fork target that is not the latest fork is refused naming the target and the latest fork, and the latest fork lands
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P24` — a disputed latest successor-fork target is refused naming it, and the chain stays on its fork
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P25` — a target past a reduction link whose challenge period is still open is unreachable and reports the invalid-snapshot failure
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P26` — a walk that stops at such a link ends at a disputed fork, which is refused
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P33` — a same-fork advance whose milestones all start below the chain height cannot adopt a newer snapshot and leaves the chain snapshot unchanged
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P34` — A valid last milestone adopts its first finalized block rather than the evidence tail
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P35` — An unfinalized tail snapshot cannot be the adoption target
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P36` — An insufficient threshold cannot promote a milestone first block
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P37` — Threshold-final genesis block zero can be adopted
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P38` — Unfinalized genesis block zero cannot be adopted
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P39` — Block-zero addition with its complete membership union can be adopted
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P40` — Block-zero addition missing the joiner signature cannot be adopted
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P41` — Block-zero removal with its complete membership union can be adopted
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P42` — Block-zero removal missing the leaver signature cannot be adopted
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P43` — An anchor-only proof cannot advance to the same anchor again
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P44` — An unfinalized block after the anchor cannot be adopted
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P45` — An overlapping last milestone targets its separate later final point
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P46` — The preceding change-point snapshot cannot replace the final snapshot in an overlapping proof
- [x] `UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P47` — a snapshot post whose new snapshot has its outbound head at an overflowing block right above the anchor reverts `ErrorOutboundMessageBlocksInvalid` (invalid run), not an arithmetic panic

## INTEGRATION-TEST-OPEN-CHANNEL-REGISTRY-1-A8M2KP

Normal lifecycle registry removal

- Setup: Open several channels through the SDK, close one through the ordinary participant lifecycle, and scan lifecycle events.
- Oracle: The closed ID leaves registry pages, live IDs remain, and the event-derived set equals the paged manager set.

- [x] `INTEGRATION-TEST-OPEN-CHANNEL-REGISTRY-1-A8M2KP.P1` — participant-lifecycle close and event/registry equality
