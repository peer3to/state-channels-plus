# UtilityFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

Two surfaces on one deployment
([#L13](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L13)):

1. **Stateless helpers, reached by plain `CALL` on the facet itself.** Unanimous threshold
   verification with per-signer dedup, signer recovery, block decode/`tryDecodeBlock`, array
   operations, and the genesis-shape and snapshot-ordering predicates
   ([#L19](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L19)–[#L260](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L260)).
   Seven of them are declared by
   [UtilityFacetInterface](./UtilityFacetInterface.sol.md), which is the type
   [StateChannelCommon](./StateChannelCommon.sol.md) binds to `utilityFacetAddress`. This surface is
   unchanged.
2. **Proxy-storage views, reached by delegatecall through the proxy's selector routing**
   ([#L262](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L262)
   onward). These are the ~28 read-only accessors the proxy used to declare itself — participants
   and pending/slashed sets, the on-chain threshold set, dispute eligibility, snapshots, channel
   balance, channel-open and fork-disputed predicates, the five timing values, calldata
   commitments, inbound-block membership, block authenticity, dispute-window commitments and
   timestamps, reduced results, kill/challenge period expiry, and outbound message-block
   verification/pruning. The surface also exposes the open-channel count and safe paged reads;
   zero limits and offsets at or beyond the end return an empty page, and oversized ranges truncate.
   Each remaining body is a thin wrapper over the corresponding `internal` on
   `StateChannelCommon`, so it reads the **proxy's** storage under delegatecall.

## Key design decisions

1. **The proxy-storage views moved here to fit EIP-170.** They were the bulk of the proxy's
   non-routing code; moving them verbatim took the proxy from 29,342 to 13,779 deployed bytes and
   this facet from 7,702 to 15,166 — both inside the 24,576-byte budget
   ([`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje),
   measurements in the [architecture view](../../../../views/architecture/contracts/architecture.md) §3).
2. **That forced the `StateChannelCommon` base.** A delegatecalled view must see the manager's slot
   layout, so the facet now derives from the shared base like every other facet; the stateless
   helpers are unaffected because they touch no storage
   ([#L13](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L13)).
3. **The two surfaces stay separable by type.** Only the stateless helpers are declared on
   [UtilityFacetInterface](./UtilityFacetInterface.sol.md) and implemented with `override`, so the
   compiler pins the plain-`CALL` contract while the routed views are reached purely by selector
   ([#L65](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L65),
   [#L244](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L244)).
4. **Stateless helpers are called, not delegatecalled** — pure helpers need no storage context,
   shaving delegate overhead and keeping them trivially auditable.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Helper arguments (signatures, encoded blocks, address arrays, snapshots); for the routed views, channel/fork identifiers and the caller's query arguments. |
| Outputs      | Verdicts, decoded values, derived address sets, and reads of the manager's stored state.                                                                   |
| Owned state  | None declared. Under delegatecall it reads the proxy's layout, inherited via `StateChannelCommon`.                                                         |
| Side effects | None — every function on both surfaces is `pure` or `view`.                                                                                                |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                     | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UtilityFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol) | [`REQ-ENFPROOF-2-YZDCXM`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm), [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b), [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390), [`REQ-LIF-8-2HDG3A`](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a) |

Contribution per ID: [`REQ-ENFPROOF-2-YZDCXM`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm) — deduplicated exact-set threshold verification;
[`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b) — the helper surface is stateless by construction and the routed
surface is side-effect-free (`view` only); [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) — the manager's observation
views remain reachable at the manager address after moving off the proxy; [`REQ-LIF-8-2HDG3A`](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a) — count and bounded page reads expose the current enumerable set without reverting at page boundaries.

## Assumptions, dependencies, trust boundaries, and limits

- The routed views execute only in the manager's delegatecall context; called directly on this
  deployment they would read the facet's own (empty) storage. Nothing in the code prevents that
  direct call — a caller reaching the facet address instead of the manager gets zero-valued reads.
- The stateless helpers, by contrast, are meant to be called on the facet address and take no
  storage context.
- Deployment-size budget applies per deployable
  ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements);
  this facet now carries the moved views, so it is the deployable most likely to hit the budget next.
- Declaring a view here does not expose it: it also needs a routing entry in
  [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per
  [contracts.md](../../../../../specification/enforcement/contracts.md).
- The moved views are byte-for-byte the previous proxy bodies, so their observable results,
  arguments and state mutability are unchanged.
- Observation views remain side-effect-free and consistent with committed state, as the operation
  inventory requires.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                      | Gap / divergence |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-ENFPROOF-2-YZDCXM`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm)  | Covered               | **Here:** deduplicated exact-set threshold verification ([#L19](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L19)).                                                                                                                                                                                                                            | None.            |
| [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b)  | Covered               | **Here:** the helpers are `pure` and stateless-by-construction; the routed views are `view` only ([#L262](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L262)). **Other files:** [UtilityFacetInterface](./UtilityFacetInterface.sol.md) makes the helpers' `pure`/`view` mutability part of the type.                                          | None.            |
| [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) | Covered               | **Here:** the observation views are implemented here and read the manager's state under delegatecall ([#L262](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L262)). **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) routes their selectors so they stay reachable at the manager address, unchanged for callers. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                         | Public entry and setup                                                                                                                                                                                                | Oracle and forbidden effects                                                                                                                                                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-utility-facet-1-er4p0v"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V` | Threshold and shape predicates     | Verify thresholds with dup/malleated/missing signers; decode valid/invalid blocks; shape predicates at boundaries                                                                                                     | Dedup counting exact; malleability never double-counts; decode failures classified                                                                                                                                                              | <a id="unit-test-utility-facet-1-er4p0v.p1"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1` — dup signer once; <a id="unit-test-utility-facet-1-er4p0v.p2"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P2` — malleated signature; <a id="unit-test-utility-facet-1-er4p0v.p3"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P3` — missing member; <a id="unit-test-utility-facet-1-er4p0v.p4"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P4` — tryDecode valid block; <a id="unit-test-utility-facet-1-er4p0v.p5"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P5` — genesis-shape predicate; <a id="unit-test-utility-facet-1-er4p0v.p6"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P6` — extra member; <a id="unit-test-utility-facet-1-er4p0v.p7"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P7` — tryDecode invalid block; <a id="unit-test-utility-facet-1-er4p0v.p8"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P8` — snapshot-ordering predicate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="unit-test-utility-facet-2-89ec3q"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q` | Delegatecalled proxy-storage views | Read each moved view through the deployed manager address on a channel with known participants, deposits, slashes, dispute windows and posted calldata; also read the same selectors directly on the facet deployment | Values read through the manager equal the manager's stored state and match what the equivalent internal produces; reading directly on the facet address observes the facet's own empty storage rather than the manager's; no view mutates state | <a id="unit-test-utility-facet-2-89ec3q.p1"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P1` — participant sets (snapshot, pending, union) through the manager; <a id="unit-test-utility-facet-2-89ec3q.p2"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P2` — slashed set, `isParticipantSlashedOnChain` and the up-to-timestamp variant; <a id="unit-test-utility-facet-2-89ec3q.p3"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P3` — snapshot, channel balance and `isChannelOpen` before and after opening; <a id="unit-test-utility-facet-2-89ec3q.p4"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P4` — the five timing values and `getAllTimes` against the constructor's sentinels; <a id="unit-test-utility-facet-2-89ec3q.p5"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P5` — calldata commitment and `hasInboundMessageBlock` for present and absent entries; <a id="unit-test-utility-facet-2-89ec3q.p6"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P6` — dispute-window commitments, creation timestamp, reduced result and `isForkDisputed` for a disputed and an undisputed fork; <a id="unit-test-utility-facet-2-89ec3q.p7"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P7` — `isKillPeriodExpired`/`isReduceChallengePeriodExpired` on both sides of their deadlines; <a id="unit-test-utility-facet-2-89ec3q.p8"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P8` — `verifyOutboundMessageBlocks`/`pruneOutboundMessageBlocks` on a linked and a broken chain; <a id="unit-test-utility-facet-2-89ec3q.p9"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P9` — the same selector read directly on the facet deployment returns the facet's empty storage, not the manager's |

## Related source reports

- [UtilityFacetInterface.sol](./UtilityFacetInterface.sol.md) — declares the stateless helper surface.
- [StateChannelManagerProxy.sol](./StateChannelManagerProxy.sol.md) — routes this facet's view selectors.
- [StateChannelCommon.sol](./StateChannelCommon.sol.md) — the base whose internals the moved views wrap, and the caller of the stateless helpers.
