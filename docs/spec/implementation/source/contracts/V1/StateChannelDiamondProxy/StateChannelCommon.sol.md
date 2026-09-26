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
commitment helpers (which look the window up by the shared
[`_disputeCommitmentHash`](./utils/DisputeUtils.sol.md)), threshold-set derivation,
`canParticipateInDisputes`, block authenticity, and
the enumerable open-channel append/removal helpers, and the channel-open and fork-disputed predicates
([`_isChannelOpen`](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L207),
[`_isForkDisputed`](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L213)).

Every member is `internal`, so nothing here appears in a facet's ABI; each body is
dead-code-eliminated into the facets that actually call it. Compiled standalone the contract is
58 deployed bytes.

## Key design decisions

Current upload eligibility is the snapshot participant set plus JOINs after its inbound boundary through the latest inbound head, minus on-chain slashes. The lower boundary is excluded and the head included. Historical proof derivation explicitly keeps the zero stop hash; bounding current upload rights does not change historical thresholds. See [StateChannelCommon.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L587).

1. **Shared-validation-by-inheritance:** one implementation of every multi-path predicate, which is
   the mechanism for [`REQ-CONTRACT-ARCH-2-BE651C` (Shared validation)](../../../../../specification/enforcement/contracts.md#req-contract-arch-2-be651c). Everything is `internal`, so a predicate's code is
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
   ([#L207](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L207)).
   `JoinChannelFacet` previously reached `isForkDisputed` by an external self-call; it now calls the
   internal directly, which removes a call frame from the join path.
4. **Pending means unconsumed.** `_getPendingParticipants` walks the inbound chain from the channel's
   head down to the current snapshot's own inbound hash, so it names only the joins the snapshot has not
   applied. The earlier unbounded walk counted every JOIN ever recorded, including the original
   participants' open joins: a leaver stayed "pending" after its reduction and a slashed inbound joiner
   stayed in the eligibility set ([cross-layer-messages.md](../../../../../specification/settlement/cross-layer-messages.md)).
   One reader keeps the unbounded walk: `reduce` for slash eligibility, because after a reduction is
   mined the snapshot lists only the survivors and a late reducer must still fold the same slashes
   ([DisputeVerificationFacet.sol.md](DisputeVerificationFacet.sol.md)). The milestone-finality read in
   [DisputeFraudProofFacet.sol.md](DisputeFraudProofFacet.sol.md) walks only the dispute's committed interval,
   from its latest state's inbound hash to its anchor, and subtracts only the slashes the dispute commits.
5. **The rejected inbound replay names the state it was seeded with.**
   `_applyInboundMessages` sets the state machine to `encodedStateMachineState` once and then walks
   every message; when a message is refused it raises
   `ErrorDisputeStateMachineInboundProcessingFailed(blockIndex, messageIndex, participant, messageType, stateMachineStateHash)`
   ([#L535](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L535)).
   The two indices locate the message but not the input it was applied to, and the same message can
   be valid or invalid depending on the seed state, so the seed's hash is what makes a rejected
   replay reproducible. It is `if (!success) revert`, not `require`: the hash is over the whole
   encoded state, and eager argument evaluation inside `require` would pay for it on every message
   of every successful walk.
6. **The reduced-result commit names a missing window before it names a deadline.**
   `_commitToDisputeReducedResult` checks window existence first
   ([#L635](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L635)),
   because `_isKillPeriodExpired` derives its deadline from a zero
   `lastEvidenceSubmissionTimestamp` when no window was created and would report a deadline that
   reads as long past for a call refused precisely because nothing has expired. Every production
   caller creates the window or checks it first, so this is defence in depth for a future caller,
   not a reachable path today. Written as `if (!…) revert` rather than inside `require` because
   the operand `disputeWindow.forkId` is a storage read the condition itself does not perform, and
   error arguments are evaluated eagerly.

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

| Source file                                                                                                 | Specification IDs                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateChannelCommon.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol) | [`REQ-CONTRACT-ARCH-2-BE651C`](../../../../../specification/enforcement/contracts.md#req-contract-arch-2-be651c), [`INV-ENFFP-1-BGVZN4`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4), [`REQ-DIS-2-PKVZ7E`](../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e) |

## Assumptions, dependencies, trust boundaries, and limits

- Inherited-layout discipline (facets stateless) is what keeps `delegatecall` sound.
- The helpers reached through `UtilityFacetInterface` are plain `CALL`s: they run in the utility
  facet's own storage context and must stay `pure`/`view`. Nothing verifies at run time that the
  code at `utilityFacetAddress` implements the interface — that is a deployment commitment.
- Keeping every member `internal` is load-bearing for the size budget: a `public` member here would
  compile its body and dispatcher entry into every facet.

## Specification adherence

- Identical predicate semantics on every path by construction; append-only slash set with timestamps ([`INV-ENFFP-1-BGVZN4` (Slash set integrity)](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4) storage half).

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
| [`REQ-CONTRACT-ARCH-2-BE651C`](../../../../../specification/enforcement/contracts.md#req-contract-arch-2-be651c) | Covered               | **Here:** single inherited implementations of shared predicates, including the channel-open and fork-disputed predicates now owned here ([#L207](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L207)). **Other files:** [UtilityFacet](./UtilityFacet.sol.md) exposes the same predicates externally by wrapping these internals, so the routed view and the internal caller cannot diverge. | None.            |
| [`INV-ENFFP-1-BGVZN4`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4)            | Covered               | **Here:** append-only slash storage + timestamp-bounded queries. **Other files:** writers in [FraudProofFacet](./FraudProofFacet.sol.md)/[DisputeFraudProofFacet](./DisputeFraudProofFacet.sol.md).                                                                                                                                                                                                                              | None.            |
| [`REQ-LIF-8-2HDG3A`](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)                      | Covered               | **Here:** append-on-open and idempotent swap-and-pop removal repair the reverse index. **Other files:** proxy and snapshot facet call the helpers only at successful lifecycle boundaries; UtilityFacet exposes safe pages.                                                                                                                                                                                                      | None.            |
| [`REQ-DIS-2-PKVZ7E`](../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e)                         | Covered               | **Here:** [\_canParticipateInDisputesNow](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L587) derives current snapshot membership plus joins strictly after its inbound boundary, excluding chain slashes. **Other files:** [DisputeManagerFacet.sol.md](DisputeManagerFacet.sol.md) enforces upload admission.                                                                              | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation                       | Public entry and setup                                                                       | Oracle and forbidden effects                                                                                                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-state-channel-common-1-wj73fk"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK`   | Shared predicates                | Drive each shared predicate/derivation through two different facet paths                     | Identical classification per path; pending derivation matches unconsumed JOINs; slash queries respect timestamps                                                                                    | <a id="unit-test-state-channel-common-1-wj73fk.p1"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P1` — linkage predicates cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p2"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P2` — pending-participant derivation; <a id="unit-test-state-channel-common-1-wj73fk.p3"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P3` — slash append/query bounds; <a id="unit-test-state-channel-common-1-wj73fk.p4"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P4` — authenticity predicate parity with client use; <a id="unit-test-state-channel-common-1-wj73fk.p5"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P5` — threshold-set derivation cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p6"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P6` — canParticipateInDisputes cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p7"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P7` — inbound/outbound chain verification cross-path agreement; <a id="unit-test-state-channel-common-1-wj73fk.p8"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P8` — the pending set holds only joins the current snapshot has not consumed (empty after open, the joiner after its deposit, never the open joins); <a id="unit-test-state-channel-common-1-wj73fk.p9"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P9` — current snapshot member remains eligible despite an old JOIN, in both upload modes; <a id="unit-test-state-channel-common-1-wj73fk.p10"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P10` — JOIN at the latest inbound head is eligible, in both upload modes; <a id="unit-test-state-channel-common-1-wj73fk.p11"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P11` — JOIN inside the unconsumed interval is eligible, in both upload modes; <a id="unit-test-state-channel-common-1-wj73fk.p12"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P12` — nonparticipant JOIN at the consumed boundary is rejected in both upload modes; <a id="unit-test-state-channel-common-1-wj73fk.p13"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P13` — older out-of-bound nonparticipant is rejected in both upload modes; <a id="unit-test-state-channel-common-1-wj73fk.p14"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P14` — on-chain-slashed snapshot participant is rejected in both upload modes; <a id="unit-test-state-channel-common-1-wj73fk.p15"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P15` — on-chain-slashed pending JOIN is rejected in both upload modes; <a id="unit-test-state-channel-common-1-wj73fk.p16"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P16` — committing a reduced result against a fork whose dispute window was never created reverts `RaceConditionDisputeWindowNotOpen(channelId, forkId)` instead of a kill-period deadline; <a id="unit-test-state-channel-common-1-wj73fk.p17"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P17` — committing a reduced result while the window's kill period is still running reverts naming the kill-period end and the strictly earlier call timestamp; <a id="unit-test-state-channel-common-1-wj73fk.p18"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P18` — committing a second reduced result against an already-reduced window reverts naming three distinct forks: the window's own, the reduced fork already committed and the one submitted now; <a id="unit-test-state-channel-common-1-wj73fk.p19"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P19` — an outbound EXIT message whose amount disagrees with its embedded exit channel reverts naming the participant, the embedded exit amount and the message amount as three distinguishable values; <a id="unit-test-state-channel-common-1-wj73fk.p20"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P20` — persisting an inbound message block whose hash is already stored reverts naming both the channel and the block hash |
| <a id="unit-test-open-channel-registry-1-kfdpm7"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7` | Enumerable live-channel registry | Open and fully close real channels through proxy/facet entry points, then read public pages. | Successful opens append once; failed opens do not mutate; final close removes first/middle/last, repairs the moved index, tolerates repeat, permits one clean reopen, and matches lifecycle events. | <a id="unit-test-open-channel-registry-1-kfdpm7.p1"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P1` — append order and safe paging; <a id="unit-test-open-channel-registry-1-kfdpm7.p2"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P2` — duplicate-open rollback; <a id="unit-test-open-channel-registry-1-kfdpm7.p3"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P3` — remove first and repair moved index; <a id="unit-test-open-channel-registry-1-kfdpm7.p4"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P4` — remove middle; <a id="unit-test-open-channel-registry-1-kfdpm7.p5"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P5` — remove last; <a id="unit-test-open-channel-registry-1-kfdpm7.p6"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P6` — repeated final close is a no-op; <a id="unit-test-open-channel-registry-1-kfdpm7.p7"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P7` — reopen appends exactly once; <a id="unit-test-open-channel-registry-1-kfdpm7.p8"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P8` — full lifecycle event set equals paged registry; <a id="unit-test-open-channel-registry-1-kfdpm7.p9"></a>`UNIT-TEST-OPEN-CHANNEL-REGISTRY-1-KFDPM7.P9` — TypeScript event query reconstructs successful opens and matches paged reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Related source reports

- All facet reports; [utils/DisputeUtils](./utils/DisputeUtils.sol.md), [utils/BlockUtils](./utils/BlockUtils.sol.md).
- [UtilityFacetInterface.sol](./UtilityFacetInterface.sol.md) — the helper type bound to `utilityFacetAddress`.
- [UtilityFacet.sol](./UtilityFacet.sol.md) — implements those helpers and wraps these internals as routed views.
