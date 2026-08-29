# JoinChannelFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol) > **Status:** Authored — engineer verification pending.
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

Post-open admission: `joinChannel`/`topUpBalance` share one path — submitter-is-participant,
unexpired, expected fork/snapshot pins, membership split (absent for join incl. undisputed-fork
gate; present and unslashed for top-up), participant + unanimous current-eligibility signatures,
atomic composable deposit, appended inbound JOIN block.

## Key design decisions

1. **One `_processJoinChannel(…, isTopUp)`** keeps the two admission cases from drifting apart — the membership split is a flag check, everything else shared.
2. **The undisputed-fork gate is an internal call, not an external self-call.** The join branch
   evaluates [`_isForkDisputed`](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L195)
   on [StateChannelCommon](./StateChannelCommon.sol.md)
   ([#L66](../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L66)); it
   previously reached the same predicate through an external self-call on the proxy. Same verdict,
   one call frame fewer, and no dependency on the proxy's type.
3. **The composable deposit self-call is typed by the interface.** `depositAssetsComposable` is
   still reached as an external call to `address(this)` — that is what satisfies its `onlySelf`
   guard — but the call is typed through
   [StateChannelManagerInterface](../../StateChannelManagerInterface.sol.md) rather than the proxy
   contract, so this facet no longer imports the proxy
   ([#L83](../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L83)).
4. **Membership and countersign eligibility remain separate.** Existing-participant checks use the
   full snapshot ∪ pending union, while signature verification uses
   `getOnChainThresholdSet` = (snapshot ∪ pending) − on-chain-slashed. A slash removes veto
   power without making the address absent from the recorded membership union. The top-up branch
   separately rejects an existing participant that is on-chain-slashed.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| Inputs       | Routed calls from the manager (delegatecall context). |
| Outputs      | State mutations/verdicts/events per operation group.  |
| Owned state  | None declared (shared layout via inheritance).        |
| Side effects | Events; escrow via consumer where applicable.         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                             | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [JoinChannelFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol) | [`REQ-ENFADM-1-V926CA`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca), [`REQ-ENFADM-2-K6K9SP`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp), [`REQ-ENFADM-3-6A3BEB`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb), [`INV-ENFADM-1-H53AQY`](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1-h53aqy) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).
- `_processJoinChannel` verifies countersignatures against the shared slash-excluding
  `getOnChainThresholdSet`, so an on-chain-slashed participant cannot veto a later join.
- The top-up branch checks `isParticipantSlashedOnChain` before signature verification and deposit,
  so a recorded but slashed member cannot add funds.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                    | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-ENFADM-1-V926CA`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca) | Covered               | **Here:** self-submission, pins, expiry, and unanimity checks are implemented; `_processJoinChannel` derives countersign eligibility through the shared slash-excluding `getOnChainThresholdSet`.                                                                                                                           | None.            |
| [`REQ-ENFADM-2-K6K9SP`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp) | Covered               | **Here:** the membership split, slashed-participant top-up rejection, and disputed-fork gate both directions.                                                                                                                                                                                                               | None.            |
| [`INV-ENFADM-1-H53AQY`](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1-h53aqy) | Covered               | **Here:** successful admission invokes the atomic composable-deposit path. **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) builds and appends the JOIN block and advances the head/totals.                                                                                                   | None.            |
| [`REQ-ENFADM-3-6A3BEB`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb) | Covered               | **Here:** deposits flow only through the atomic composable path, so a deposit failure reverts the admission. **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) performs composition and appends only successful deposits; [AConsumerFacet](./AConsumerFacet.sol.md) owns the adapter boundary. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation                   | Public entry and setup                                                                 | Oracle and forbidden effects                                                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-join-channel-facet-1-vbjy1a"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A` | Admission and atomic deposit | Join/top-up under every gate violation, the valid paths, and an atomic deposit failure | Only correctly pinned, signed, membership-correct submissions append; each violation or deposit failure reverts without admission effects | <a id="unit-test-join-channel-facet-1-vbjy1a.p1"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P1` — zero-channel-id revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p2"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P2` — valid join; <a id="unit-test-join-channel-facet-1-vbjy1a.p3"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P3` — valid top-up; <a id="unit-test-join-channel-facet-1-vbjy1a.p4"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P4` — fork-pin race; <a id="unit-test-join-channel-facet-1-vbjy1a.p5"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P5` — disputed-fork join; <a id="unit-test-join-channel-facet-1-vbjy1a.p6"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P6` — wrong-submitter revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p7"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P7` — expired-deadline revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p8"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P8` — join snapshot participant revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p9"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P9` — top-up unknown-participant revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p10"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P10` — participant-signature revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p11"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P11` — threshold-shortfall revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p12"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P12` — snapshot-pin race; <a id="unit-test-join-channel-facet-1-vbjy1a.p13"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P13` — join after an on-chain slash succeeds without the slashed participant's signature; <a id="unit-test-join-channel-facet-1-vbjy1a.p14"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P14` — on-chain-slashed participant's top-up reverts before deposit; <a id="unit-test-join-channel-facet-1-vbjy1a.p15"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P15` — malformed threshold signature reverts; <a id="unit-test-join-channel-facet-1-vbjy1a.p16"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P16` — stale top-up snapshot pin reverts without changing participant lifecycle state; <a id="unit-test-join-channel-facet-1-vbjy1a.p17"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P17` — join pending participant reverts per the snapshot ∪ pending membership rule; <a id="unit-test-join-channel-facet-1-vbjy1a.p18"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P18` — join at the exact deadline succeeds; <a id="unit-test-join-channel-facet-1-vbjy1a.p19"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P19` — pending participant's top-up succeeds; <a id="unit-test-join-channel-facet-1-vbjy1a.p20"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P20` — atomic deposit failure propagates through join without admission effects |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
