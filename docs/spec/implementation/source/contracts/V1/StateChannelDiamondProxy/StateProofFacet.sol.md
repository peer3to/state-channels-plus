# StateProofFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol)

## Requirements

- [`INV-ENFPROOF-1-DR1N9B` (Side-effect-free verification)](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b)
- [`REQ-ENFPROOF-1-RH4WEM` (Single verification authority)](../../../../../specification/enforcement/proof-verification.md#req-enfproof-1-rh4wem)
- [`REQ-ENFPROOF-3-EEDR2Y` (Falsifying detail on failure)](../../../../../specification/enforcement/proof-verification.md#req-enfproof-3-eedr2y)
- [`REQ-SP-3-SP1JG4` (A membership hop requires signatures from the union of the previous…)](../../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)
- [`REQ-SP-4-NCSEX4` (An empty milestone list represents fork genesis only)](../../../../../specification/disputes/state-proofs.md#req-sp-4-ncsex4)
- [`REQ-SP-5-MTE4RV` (The final block of the last milestone commits the latest claimed state)](../../../../../specification/disputes/state-proofs.md#req-sp-5-mte4rv)
- [`REQ-SP-7-70EMAT` (In the retained region, verification checks consecutive heights, hash links,…)](../../../../../specification/disputes/state-proofs.md#req-sp-7-70emat)
- [`REQ-FIN-3-9P9J4Q` (A signature on block B is also an indirect vote for every ancestor of B on the…)](../../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q)
- [`REQ-FIN-7-RTZWQZ` (The threshold is unanimous over the _relevant participant set_)](../../../../../specification/protocol-model/finality.md#req-fin-7-rtzwqz)
- [`REQ-FIN-4-ZFDDS6` (Consequently, in a channel with N participants, N consecutive blocks authored…)](../../../../../specification/protocol-model/finality.md#req-fin-4-zfdds6)
- [`REQ-DIS-12-AXY60R` (Posted auditing data MUST carry an outbound run that, cut at the current…)](../../../../../specification/disputes/disputes.md#req-dis-12-axy60r)

## UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR

Proof predicates

- Setup: Verify valid/manipulated proofs across anchors, hops and last-milestone tails
- Oracle: Valid proofs verify; each manipulation rejects with actionable detail; genesis and matching-anchor exceptions preserved

- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P1` — valid milestone chain
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P2` — membership-hop threshold met
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P3` — suffix linkage break
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P4` — first-invalid at first block
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P6` — below-snapshot skips
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P7` — membership-hop threshold missed
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P8` — suffix signature break
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P9` — first-invalid mid-chain
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P10` — first-invalid at last block
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P11` — every milestone below the threshold confirms only the threshold snapshot, never a newer one
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P12` — The first block of a last milestone that starts below the matching anchor is ineligible for a block-specific challenge
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P13` — The matching anchor position in the last milestone is ineligible for a block-specific challenge
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P14` — The first position after the matching anchor in the last milestone is eligible for a block-specific challenge
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P15` — A later position in the retained last-milestone tail is eligible for a block-specific challenge
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P16` — A position at the last milestone length is ineligible for a block-specific challenge
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P17` — Unfinalized genesis-linked block zero is eligible for a block-specific challenge
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P18` — Threshold-final genesis-linked block zero is still eligible for a block-specific challenge
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P19` — A block-zero resulting anchor protects position zero while position one remains eligible
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P20` — An anchor-only last milestone has no eligible position at its first block or immediately beyond it
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P21` — A one-block nonzero threshold-final last milestone has no eligible position at its first block or immediately beyond it
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P22` — A step challenge whose supplied auditing data differs from the committed hash returns false
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P23` — A step challenge identifies undecodable retained milestone bytes as invalid without reverting
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P24` — Latest-state verification returns false for an undecodable latest block without reverting
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P25` — A milestone walk over undecodable retained bytes returns invalid with snapshotMismatch false
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P26` — Standalone milestone finality returns false and a zero final hash for undecodable block bytes
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P27` — A step challenge against a decodable authentic genesis-linked block-zero control finds no fault
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P28` — Latest-state verification accepts a decodable authentic block committing the claimed latest snapshot
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P29` — A milestone walk accepts the decodable genesis-linked block-zero control with snapshotMismatch false
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P30` — Standalone milestone finality accepts the authentic block-zero control when its author is the entire supplied threshold set, returning the latest snapshot hash
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P84` — `isDisputeOutboundRunInvalid` judges a committed run whose block keeps its predecessor and height but carries a `MaxUint256` message balance invalid without reverting, so the counter kills the dispute.
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P85` — `isDisputeOutboundRunInvalid` judges a committed run invalid without reverting when the latest state (signed only by its author) has its outbound head at an overflowing block right above the anchor, so the counter kills the dispute.
