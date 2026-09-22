# StateProofFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`INV-ENFPROOF-1-DR1N9B` (Side-effect-free verification)](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b)
- [`REQ-ENFPROOF-1-RH4WEM` (Single verification authority)](../../../../../specification/enforcement/proof-verification.md#req-enfproof-1-rh4wem)
- [`REQ-ENFPROOF-3-EEDR2Y` (Falsifying detail on failure)](../../../../../specification/enforcement/proof-verification.md#req-enfproof-3-eedr2y)
- [`REQ-FIN-3-9P9J4Q` (A signature on block B is also an indirect vote for every ancestor of B on the)](../../../../../specification/protocol-model/finality.md#req-fin-3-9p9j4q)
- [`REQ-FIN-7-RTZWQZ` (The threshold is unanimous over the _relevant participant set_)](../../../../../specification/protocol-model/finality.md#req-fin-7-rtzwqz)
- [`REQ-SP-1-9YABY1` (A milestone is not merely a list of independently threshold-signed blocks)](../../../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)
- [`REQ-SP-2-ST4JJ4` (A state proof establishes a path from one final anchor to the next, and finally…)](../../../../../specification/disputes/state-proofs.md#req-sp-2-st4jj4)
- [`REQ-SP-3-SP1JG4` (A join or removal changes the threshold set, so a proof crossing a membership…)](../../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)
- [`REQ-SP-4-NCSEX4` (When a proof starts at fork genesis, genesis is the implicit final anchor for)](../../../../../specification/disputes/state-proofs.md#req-sp-4-ncsex4)
- [`REQ-SP-5-MTE4RV` (The final block of the proved path supplies the state commitment)](../../../../../specification/disputes/state-proofs.md#req-sp-5-mte4rv)
- [`REQ-SP-7-70EMAT` (Linkage checks)](../../../../../specification/disputes/state-proofs.md#req-sp-7-70emat)
- [`REQ-FIN-4-ZFDDS6` (Consequently, in a channel with N participants, N consecutive blocks authored)](../../../../../specification/protocol-model/finality.md#req-fin-4-zfdds6)

## UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR

Proof predicates

- Setup: Verify valid/manipulated proofs across anchors, hops, suffixes, and the XOR constraint
- Oracle: Valid proofs verify; each manipulation rejects with actionable detail; XOR behavior documented

- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P1` — valid milestone chain
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P2` — membership-hop threshold met
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P3` — suffix linkage break
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P4` — first-invalid at first block
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P5` — milestones+suffix (documents constraint)
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P6` — below-snapshot skips
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P7` — membership-hop threshold missed
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P8` — suffix signature break
- [ ] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P9` — first-invalid mid-chain
- [x] `UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P10` — first-invalid at last block
