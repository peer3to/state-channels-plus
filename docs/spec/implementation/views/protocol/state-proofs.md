# State proofs and milestones — implementation

> **Specification subject:** [State proofs](../../../specification/disputes/state-proofs.md) > **Status:** Maintained; engineer verification pending.

## Ownership and flow

AgreementManager constructs from the local diamond's mirrored chain anchor, using forward
minimum evidence for membership hops and backward search for the latest final point. A separate
later-final milestone may overlap earlier evidence. The proof has only milestones; the last
milestone contains the tail. There is no signedBlocks fallback array or mixed-shape exclusion.

StateChannelCommon owns the internal walk, signer union and retained-region logic. Its
WalkCursor and ThresholdTally are internal working structures, not routed ABI inputs.
StateProofFacet exposes the walk and focused predicates through the proxy/interface. Sync and
audit delegate to AgreementManager's local-final, mirror and chain tiers. False/missing advances;
throws propagate. Each replay attempt uses its own verified starting state.

Verified persistence stores the start and retained region, merges signatures and writes only
changes. It does not retain unchecked prefixes. Audit persistence alone does not move the active
view or sign. Latest finalized full state is retained for replay and reconstruction. When this is
the anchor itself, its block and snapshot also remain available; when finality is newer, no separate
older anchor state or anchor-ending proof is required.

Snapshot adoption targets the last milestone's first final block. An evidence tail cannot become
the target merely by being last. A nonempty all-skipped walk can succeed, but a below-anchor
dispute is independently counterable. Empty proofs always denote genesis. Genesis-linked block
zero may be unfinalized; a resulting block-zero anchor is distinct and protected.

## Limits and open work

The walk establishes proof structure and finality, not every application transition. Different
trusted starts inspect different regions. Per-step challenges reuse the internal checks without
re-walking prior hops, but whole-data hashing/copying grows with size. Admission gas and milestone
length limits remain open. Exact test evidence is owned by verification reports; no broad suite
result establishes every permutation. Engineer approval remains pending.

## Source inventory

| Source file                                                                                                                                  | Responsibility                                                              | Specification IDs                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [contracts/V1/types/ProofTypes.sol](../../source/contracts/V1/types/ProofTypes.sol.md)                                                       | Milestone-only proof representation                                         | [`REQ-SP-1-9YABY1`](../../../specification/disputes/state-proofs.md#req-sp-1-9yaby1)   |
| [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md) | Internal walk cursor, retained region, signer tally and consumed JOIN union | [`REQ-SP-3-SP1JG4`](../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)   |
| [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md)       | Public walk, step and anchor-dependent counter predicates                   | [`REQ-SP-7-70EMAT`](../../../specification/disputes/state-proofs.md#req-sp-7-70emat)   |
| [src/agreementManager/AgreementManager.ts](../../source/src/agreementManager/AgreementManager.ts.md)                                         | Construction, shared verification tiers and verified persistence            | [`REQ-SP-8-9ZCCEJ`](../../../specification/disputes/state-proofs.md#req-sp-8-9zccej)   |
| [src/stateManager/dispute/DisputeValidationService.ts](../../source/src/stateManager/dispute/DisputeValidationService.ts.md)                 | Audit counters and replay from verified tier state                          | [`REQ-SP-9-RNXP56`](../../../specification/disputes/state-proofs.md#req-sp-9-rnxp56)   |
| [src/rpc/network/services/spectate/SpectateService.ts](../../source/src/rpc/network/services/spectate/SpectateService.ts.md)                 | Sync generation and application through shared proof owner                  | [`REQ-SP-10-JMVHTB`](../../../specification/disputes/state-proofs.md#req-sp-10-jmvhtb) |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md) | Final-point snapshot adoption                                               | [`REQ-SP-5-MTE4RV`](../../../specification/disputes/state-proofs.md#req-sp-5-mte4rv)   |
| [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md)         | Construct and post the latest final point; no-op without progress           | [`REQ-SP-8-9ZCCEJ`](../../../specification/disputes/state-proofs.md#req-sp-8-9zccej)   |

## Conformance traceability

Construction and shared tiers are documented in the AgreementManager report. Contract walk and
counter boundaries are documented in the common and facet reports. Sync retention and audit
replay belong to their caller reports. Their component permutations are the canonical obligations;
exact executable evidence belongs to the corresponding verification reports.
