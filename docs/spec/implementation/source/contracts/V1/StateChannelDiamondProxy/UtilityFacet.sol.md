# UtilityFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`REQ-ENFPROOF-2-YZDCXM` (Deduplicated threshold counting)](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm)
- [`INV-ENFPROOF-1-DR1N9B` (Side-effect-free verification)](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b)
- [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
- [`REQ-LIF-8-2HDG3A` (Enumerable open-channel lifecycle)](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)
- [`REQ-CONTRACT-ARCH-4-FZ3CJE` (Upgrade and deployment integrity)](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje)

## UNIT-TEST-UTILITY-FACET-1-ER4P0V

Threshold and shape predicates

- Setup: Verify thresholds with dup/malleated/missing signers; decode valid/invalid blocks; shape predicates at boundaries
- Oracle: Dedup counting exact; malleability never double-counts; decode failures classified

- [x] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1` — dup signer once
- [ ] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P2` — malleated signature
- [x] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P3` — missing member
- [ ] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P4` — tryDecode valid block
- [ ] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P5` — genesis-shape predicate
- [x] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P6` — extra member
- [x] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P7` — tryDecode invalid block
- [ ] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P8` — snapshot-ordering predicate
- [x] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P9` — `retrieveSignerAddresses` maps a signature that fails to recover to `address(0)` in its own slot and keeps the other signers in submission order
- [x] `UNIT-TEST-UTILITY-FACET-1-ER4P0V.P10` — `retrieveSignerAddresses` on an empty signature list returns an empty signer set

## UNIT-TEST-UTILITY-FACET-2-89EC3Q

Delegatecalled proxy-storage views

- Setup: Read each moved view through the deployed manager address on a channel with known participants, deposits, slashes, dispute windows and posted calldata; also read the same selectors directly on the facet deployment
- Oracle: Values read through the manager equal the manager's stored state and match what the equivalent internal produces; reading directly on the facet address observes the facet's own empty storage rather than the manager's; no view mutates state

- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P1` — participant sets (snapshot, pending, union) through the manager
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P2` — slashed set, `isParticipantSlashedOnChain` and the up-to-timestamp variant
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P3` — snapshot, channel balance and `isChannelOpen` before and after opening
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P4` — the five timing values and `getAllTimes` against the constructor's sentinels
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P5` — calldata commitment and `hasInboundMessageBlock` for present and absent entries
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P6` — dispute-window commitments, creation timestamp, reduced result and `isForkDisputed` for a disputed and an undisputed fork
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P7` — `isKillPeriodExpired`/`isReduceChallengePeriodExpired` on both sides of their deadlines
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P8` — `verifyOutboundMessageBlocks`/`pruneOutboundMessageBlocks` on a linked and a broken chain
- [ ] `UNIT-TEST-UTILITY-FACET-2-89EC3Q.P9` — the same selector read directly on the facet deployment returns the facet's empty storage, not the manager's
