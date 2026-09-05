# StateChannelCommon.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol) > **Status:** Authored — engineer verification pending.
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

The shared base every facet inherits: storage access, slash-set maintenance (append + queries up
to timestamp), pending-participant derivation by walking unconsumed inbound JOINs, inbound/
outbound chain verification and application, snapshot/block linkage predicates, dispute-window
commitment helpers, threshold-set derivation, `canParticipateInDisputes`, block authenticity, and
the enumerable open-channel append/removal helpers, and the channel-open and fork-disputed predicates
([`_isChannelOpen`](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L189),
[`_isForkDisputed`](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L195)).

Every member is `internal`, so nothing here appears in a facet's ABI; each body is
dead-code-eliminated into the facets that actually call it. Compiled standalone the contract is
58 deployed bytes.

## Key design decisions

1. **Shared-validation-by-inheritance:** one implementation of every multi-path predicate, which is
   the mechanism for [`REQ-CONTRACT-ARCH-2-BE651C`](../../../../../specification/enforcement/contracts.md#req-contract-arch-2-be651c). Everything is `internal`, so a predicate's code is
   compiled only into the facets that call it (the stateless pieces that need no inherited storage
   keep moving to the free functions in [utils/](./utils/README.md)).
2. **The base binds `UtilityFacetInterface`, not the concrete facet.**
   [UtilityFacet](./UtilityFacet.sol.md) now derives from this contract so its delegatecalled views
   see the manager layout, which makes naming the concrete type here circular. The base casts
   `utilityFacetAddress` to the abstract [UtilityFacetInterface](./UtilityFacetInterface.sol.md)
   instead ([#L11](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L11),
   [#L65](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L65)).
   The calls themselves are unchanged plain `CALL`s to the same deployed helpers. One pre-existing
   exception remains: `_getGenesisTimestamp` reaches the same `pure`
   `isGenesisSnapshotWithoutTimeCheck` two different ways — through the diamond at
   [#L85](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L85)
   and directly on the facet at
   [#L102](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L102).
   Same verdict either way; the first path costs an extra self-CALL plus a routed delegatecall
   (see the [architecture view](../../../../views/architecture/contracts/manager-and-facets.md) §4.8).
3. **`_isChannelOpen` and `_isForkDisputed` live here, not on the proxy.** Both were public views on
   [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md); their bodies moved down verbatim so
   that `open` and [JoinChannelFacet](./JoinChannelFacet.sol.md) can evaluate them as internal calls
   while the external `isChannelOpen`/`isForkDisputed` selectors route to
   [UtilityFacet](./UtilityFacet.sol.md)
   ([#L189](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L189)).
   `JoinChannelFacet` previously reached `isForkDisputed` by an external self-call; it now calls the
   internal directly, which removes a call frame from the join path.
4. **Pending means unconsumed.** `_getPendingParticipants` walks the inbound chain from the channel's
   head down to the current snapshot's own inbound hash, so it names only the joins the snapshot has not
   applied. The earlier unbounded walk counted every JOIN ever recorded, including the original
   participants' open joins: a leaver stayed "pending" after its reduction and a slashed inbound joiner
   stayed in the eligibility set ([cross-layer-messages.md](../../../../../specification/settlement/cross-layer-messages.md)).
   `reduce` is the one reader that keeps the unbounded walk for slash eligibility: after a reduction is
   mined the snapshot lists only the survivors, and a late reducer must still fold the same slashes
   ([DisputeVerificationFacet.sol.md](DisputeVerificationFacet.sol.md)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------- |
| Inputs       | Internal calls from facets.                                                              |
| Outputs      | Predicates/derivations; storage mutations.                                               |
| Owned state  | Accessor to the shared layout (declares none itself beyond the inherited slot-0 layout). |
| Side effects | Slash-set appends, stream-head advances.                                                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                 | Specification IDs                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateChannelCommon.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol) | [`REQ-CONTRACT-ARCH-2-BE651C`](../../../../../specification/enforcement/contracts.md#req-contract-arch-2-be651c), [`INV-ENFFP-1-BGVZN4`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4) |

## Assumptions, dependencies, trust boundaries, and limits

- Inherited-layout discipline (facets stateless) is what keeps `delegatecall` sound.
- The helpers reached through `UtilityFacetInterface` are plain `CALL`s: they run in the utility
  facet's own storage context and must stay `pure`/`view`. Nothing verifies at run time that the
  code at `utilityFacetAddress` implements the interface — that is a deployment commitment.
- Keeping every member `internal` is load-bearing for the size budget: a `public` member here would
  compile its body and dispatcher entry into every facet.

## Specification adherence

- Identical predicate semantics on every path by construction; append-only slash set with timestamps ([`INV-ENFFP-1-BGVZN4`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4) storage half).

## Specification contradictions

None demonstrated.

## Missing behavior

The size-reduction decomposition of the shared base — moving predicates that need no inherited
storage into free-function libraries — is still architecture future work; the base's `internal`
bodies are still inlined into each calling facet.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                         | Gap / divergence |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-CONTRACT-ARCH-2-BE651C`](../../../../../specification/enforcement/contracts.md#req-contract-arch-2-be651c) | Covered               | **Here:** single inherited implementations of shared predicates, including the channel-open and fork-disputed predicates now owned here ([#L189](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L189)). **Other files:** [UtilityFacet](./UtilityFacet.sol.md) exposes the same predicates externally by wrapping these internals, so the routed view and the internal caller cannot diverge. | None.            |
| [`INV-ENFFP-1-BGVZN4`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4)            | Covered               | **Here:** append-only slash storage + timestamp-bounded queries. **Other files:** writers in [FraudProofFacet](./FraudProofFacet.sol.md)/[DisputeFraudProofFacet](./DisputeFraudProofFacet.sol.md).                                                                                                                                                                                                                              | None.            |
| [`REQ-LIF-8-2HDG3A`](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)                      | Covered               | **Here:** append-on-open and idempotent swap-and-pop removal repair the reverse index. **Other files:** proxy and snapshot facet call the helpers only at successful lifecycle boundaries; UtilityFacet exposes safe pages.                                                                                                                                                                                                      | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation                       | Public entry and setup                                                                       | Oracle and forbidden effects                                                                                                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-channel-common-1-wj73fk"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK`   | Shared predicates                | Drive each shared predicate/derivation through two different facet paths                     | Identical classification per path; pending derivation matches unconsumed JOINs; slash queries respect timestamps                                                                                    | <a id="unit-test-state-channel-common-1-wj73fk.p1"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P1` — linkage predicates cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p2"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P2` — pending-participant derivation; <a id="unit-test-state-channel-common-1-wj73fk.p3"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P3` — slash append/query bounds; <a id="unit-test-state-channel-common-1-wj73fk.p4"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P4` — authenticity predicate parity with client use; <a id="unit-test-state-channel-common-1-wj73fk.p5"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P5` — threshold-set derivation cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p6"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P6` — canParticipateInDisputes cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p7"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P7` — inbound/outbound chain verification cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p8"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P8` — the pending set holds only joins the current snapshot has not consumed (empty after open, the joiner after its deposit, never the open joins) |
| <a id="unit-test-open-channel-registry-1-kfdpm7"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7` | Enumerable live-channel registry | Open and fully close real channels through proxy/facet entry points, then read public pages. | Successful opens append once; failed opens do not mutate; final close removes first/middle/last, repairs the moved index, tolerates repeat, permits one clean reopen, and matches lifecycle events. | <a id="unit-test-open-channel-registry-1-kfdpm7.p1"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P1` — append order and safe paging; <a id="unit-test-open-channel-registry-1-kfdpm7.p2"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P2` — duplicate-open rollback; <a id="unit-test-open-channel-registry-1-kfdpm7.p3"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P3` — remove first and repair moved index; <a id="unit-test-open-channel-registry-1-kfdpm7.p4"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P4` — remove middle; <a id="unit-test-open-channel-registry-1-kfdpm7.p5"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P5` — remove last; <a id="unit-test-open-channel-registry-1-kfdpm7.p6"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P6` — repeated final close is a no-op; <a id="unit-test-open-channel-registry-1-kfdpm7.p7"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P7` — reopen appends exactly once; <a id="unit-test-open-channel-registry-1-kfdpm7.p8"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P8` — full lifecycle event set equals paged registry; <a id="unit-test-open-channel-registry-1-kfdpm7.p9"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P9` — TypeScript event query reconstructs successful opens and matches paged reads.              |

## Related source reports

- All facet reports; [utils/DisputeUtils](./utils/DisputeUtils.sol.md), [utils/BlockUtils](./utils/BlockUtils.sol.md).
- [UtilityFacetInterface.sol](./UtilityFacetInterface.sol.md) — the helper type bound to `utilityFacetAddress`.
- [UtilityFacet.sol](./UtilityFacet.sol.md) — implements those helpers and wraps these internals as routed views.
