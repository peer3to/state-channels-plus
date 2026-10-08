# State proofs and milestones — implementation

> **Specification subject:** [State proofs](../../../specification/disputes/state-proofs.md)

## Ownership and flow

AgreementManager constructs from the local diamond's mirrored chain anchor, using forward
minimum evidence for membership hops and backward search for the latest final point. A separate
later-final milestone may overlap earlier evidence. The proof has only milestones; the last
milestone contains the tail. There is no separate signed-block fallback array or mixed-shape exclusion.

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
