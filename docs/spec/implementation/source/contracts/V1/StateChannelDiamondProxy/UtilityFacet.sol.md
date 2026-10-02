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
   ([#L20](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L20)–[#L284](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L284)).
   Seven of them are declared by
   [UtilityFacetInterface](./UtilityFacetInterface.sol.md), which is the type
   [StateChannelCommon](./StateChannelCommon.sol.md) binds to `utilityFacetAddress`. This surface is
   unchanged.
2. **Proxy-storage views, reached by delegatecall through the proxy's selector routing**
   ([#L286](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L286)
   onward). These are the ~28 read-only accessors the proxy used to declare itself — participants
   and pending/slashed sets, the on-chain threshold set, dispute eligibility, snapshots, channel
   balance, channel-open and fork-disputed predicates, the five timing values, calldata
   commitments, inbound-block membership, dispute-window commitments and
   timestamps, reduced results, kill/challenge period expiry, and outbound message-block
   verification/pruning. The surface also exposes the open-channel count and safe paged reads;
   zero limits and offsets at or beyond the end return an empty page, and oversized ranges truncate.
   Each remaining body is a thin wrapper over the corresponding `internal` on
   `StateChannelCommon`, so it reads the **proxy's** storage under delegatecall.
   One routed view is a derivation, not a wrapper: `getStateTransitionReplayGas`
   ([#L316](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L316)) — see decision 7. Block authenticity is not on this surface: the former
   public `isBlockAuthentic` wrapper is removed and `_isBlockAuthentic` stays internal on
   [StateChannelCommon](./StateChannelCommon.sol.md) for the fraud-proof facets.

## Key design decisions

1. **The proxy-storage views moved here to fit EIP-170.** They were the bulk of the proxy's
   non-routing code; moving them verbatim took the proxy from 29,342 to 13,779 deployed bytes and
   this facet from 7,702 to 15,166 — both inside the 24,576-byte budget
   ([`REQ-CONTRACT-ARCH-4-FZ3CJE` (Upgrade and deployment integrity)](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje),
   measurements in the [architecture view](../../../../views/architecture/contracts/architecture.md) §3).
2. **That forced the `StateChannelCommon` base.** A delegatecalled view must see the manager's slot
   layout, so the facet now derives from the shared base like every other facet; the stateless
   helpers are unaffected because they touch no storage
   ([#L13](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L13)).
3. **The two surfaces stay separable by type.** Only the stateless helpers are declared on
   [UtilityFacetInterface](./UtilityFacetInterface.sol.md) and implemented with `override`, so the
   compiler pins the plain-`CALL` contract while the routed views are reached purely by selector
   ([#L109](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L109),
   [#L268](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L268)).
4. **Stateless helpers are called, not delegatecalled** — pure helpers need no storage context,
   shaving delegate overhead and keeping them trivially auditable.
5. **One owner for the EIP-191 digest, three signature entry points.**
   [`_eip191SignedHash`](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L20)
   is the single definition of the personal-sign prefix over `keccak256(encodedData)`;
   `verifyThresholdSigned`, `retrieveSignerAddress` and
   [`retrieveSignerAddresses`](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L28)
   all derive their digest from it. A second copy of the prefix would let a recovered signer set
   disagree with the set the threshold check compared, which is exactly the disagreement a
   rejection payload exists to report.
6. **`retrieveSignerAddresses` reports, it does not verify.** It returns one address per supplied
   signature in submission order and substitutes `address(0)` for a signature that fails to
   recover, rather than reverting, because its only caller is already on a failure branch
   ([JoinChannelFacet](./JoinChannelFacet.sol.md)) and a revert there would replace the
   diagnostic with a bare ECDSA error. Like the other stateless helpers it stays off the
   diamond's routed surface — callers reach it as a plain `CALL` on the deployed facet, and the
   routing fixture records that exclusion.
7. **The replay stipend is priced on-chain, next to the machine it funds.**
   `getStateTransitionReplayGas` ([#L316](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L316)) starts from the bound machine's
   `getStateTransitionGasRequirement()` and applies `x * 64 / 63 + 1` once per enclosing call level
   (`REPLAY_CALL_DEPTH = 4`, [#L14](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L14): `multicall`, the facet delegatecall,
   `executeStateTransition`, the state machine call). EIP-150 keeps 1/64 of the gas at each level,
   so this is the gas that must reach the top of the replay call chain for the replayed transition
   to be granted its full stipend (the transaction's other work comes on top of it). A sender that attaches less gets the proxy's
   funded-replay failure, never a verdict ([StateChannelManagerProxy](./StateChannelManagerProxy.sol.md)
   decision 10). The value is read by the SDK before a replay send, which sends with its estimate plus
   this value ([DisputeManager](../../../src/disputeManager/DisputeManager.ts.md) decision 11).
8. **`tryDecodeBlock` is the contracts' one block decoder.** It decodes through a self-call to
   `decodeBlock` ([#L109](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L109)) and returns `decoded = false` instead of reverting for bytes
   Solidity's ABI decoder refuses. The fraud-proof, dispute and state-proof facets and
   `_isBlockAuthentic` all use it. It applies no canonical-encoding rule: it accepts, for example,
   the canonical bytes plus a trailing zero word. The client does not call it; it decodes with
   `Codec`, and the two decoders are not yet held to one acceptance rule ([`FIND-DECODE-1-FD1V6V`](../../../../../audit/open-findings.md#find-decode-1-fd1v6v)).
9. **The inbound view answers the forged-inbound question, not "is it stored".**
   `isUncommittedInboundMessageBlock(channelId, messageBlock)`
   ([#L339](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L339)) replaces the former stored-entry view and forwards
   to `_isUncommittedInboundMessageBlock` ([StateChannelCommon](./StateChannelCommon.sol.md)
   decision 7). Its only client caller is the SDK's forged-inbound detector
   ([ValidationService](../../../src/stateManager/ingest/ValidationService.ts.md)) and dispute
   construction ([DisputeManager](../../../src/disputeManager/DisputeManager.ts.md)), which need the
   chain's verdict, including the snapshot-height rule, rather than raw storage presence.

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

| Source file                                                                                     | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UtilityFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol) | [`REQ-ENFPROOF-2-YZDCXM`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm), [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b), [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390), [`REQ-LIF-8-2HDG3A`](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a), [`REQ-ENFSM-1-DKJCY2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2), [`INV-MIRROR-1-VAF778`](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) |

Contribution per ID: [`REQ-ENFPROOF-2-YZDCXM` (Deduplicated threshold counting)](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm) — deduplicated exact-set threshold verification;
[`INV-ENFPROOF-1-DR1N9B` (Side-effect-free verification)](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b) — the helper surface is stateless by construction and the routed
surface is side-effect-free (`view` only); [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) — the manager's observation
views remain reachable at the manager address after moving off the proxy; [`REQ-LIF-8-2HDG3A` (Enumerable open-channel lifecycle)](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a) — count and bounded page reads expose the current enumerable set without reverting at page boundaries. [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2) — `getStateTransitionReplayGas` publishes the gas the replay call chain needs so a replay is funded; [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) — `tryDecodeBlock` is the contracts' block decoder; the client's `Codec` decoder is not yet at parity with it ([`FIND-DECODE-1-FD1V6V`](../../../../../audit/open-findings.md#find-decode-1-fd1v6v)).

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

| Requirement / invariant                                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Gap / divergence                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-ENFPROOF-2-YZDCXM`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2-yzdcxm)  | Covered               | **Here:** deduplicated exact-set threshold verification ([#L46](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L46)).                                                                                                                                                                                                                                                                                                                                                                                                                                                 | None.                                                                                                                                                             |
| [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b)  | Covered               | **Here:** the helpers are `pure` and stateless-by-construction; the routed views are `view` only ([#L286](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L286)). **Other files:** [UtilityFacetInterface](./UtilityFacetInterface.sol.md) makes the helpers' `pure`/`view` mutability part of the type.                                                                                                                                                                                                                                                               | None.                                                                                                                                                             |
| [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) | Covered               | **Here:** the observation views are implemented here and read the manager's state under delegatecall ([#L286](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L286)). **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) routes their selectors so they stay reachable at the manager address, unchanged for callers.                                                                                                                                                                                                                      | None.                                                                                                                                                             |
| [`REQ-ENFSM-1-DKJCY2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)    | Covered               | **Here:** `getStateTransitionReplayGas` derives the replay funding from the machine's gas requirement and the EIP-150 retention at each of the `REPLAY_CALL_DEPTH` levels ([#L316](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L316)). **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) routes it and refuses an under-funded replay without a verdict; [AStateMachine](../AStateMachine.sol.md) owns the stipend check; [DisputeManager](../../../src/disputeManager/DisputeManager.ts.md) sends with its estimate plus this value. | None.                                                                                                                                                             |
| [`INV-MIRROR-1-VAF778`](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)            | Partial               | **Here:** `tryDecodeBlock` is the single on-chain block decoder; it returns `decoded = false` instead of reverting ([#L109](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L109)). **Other files:** [Block](../../../src/models/Block.ts.md) decodes client-side with `Codec`.                                                                                                                                                                                                                                                                                        | The client and contract decoders may accept or reject different encodings ([`FIND-DECODE-1-FD1V6V`](../../../../../audit/open-findings.md#find-decode-1-fd1v6v)). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

`getStateTransitionReplayGas` is tested through the funded-replay family of the proxy that routes it
([`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P10`](StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p10)): its value is only meaningful as the gas that turns a refused
replay into a judged one.

| Unit test ID                                                                    | Obligation                         | Public entry and setup                                                                                                                                                                                                | Oracle and forbidden effects                                                                                                                                                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-utility-facet-1-er4p0v"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V` | Threshold and shape predicates     | Verify thresholds with dup/malleated/missing signers; decode valid/invalid blocks; shape predicates at boundaries                                                                                                     | Dedup counting exact; malleability never double-counts; decode failures classified                                                                                                                                                              | <a id="unit-test-utility-facet-1-er4p0v.p1"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P1` — dup signer once; <a id="unit-test-utility-facet-1-er4p0v.p2"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P2` — malleated signature; <a id="unit-test-utility-facet-1-er4p0v.p3"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P3` — missing member; <a id="unit-test-utility-facet-1-er4p0v.p4"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P4` — tryDecode valid block; <a id="unit-test-utility-facet-1-er4p0v.p5"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P5` — genesis-shape predicate; <a id="unit-test-utility-facet-1-er4p0v.p6"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P6` — extra member; <a id="unit-test-utility-facet-1-er4p0v.p7"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P7` — tryDecode invalid block; <a id="unit-test-utility-facet-1-er4p0v.p8"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P8` — snapshot-ordering predicate; <a id="unit-test-utility-facet-1-er4p0v.p9"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P9` — `retrieveSignerAddresses` maps a signature that fails to recover to `address(0)` in its own slot and keeps the other signers in submission order; <a id="unit-test-utility-facet-1-er4p0v.p10"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P10` — `retrieveSignerAddresses` on an empty signature list returns an empty signer set; <a id="unit-test-utility-facet-1-er4p0v.p11"></a>`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P11` — `tryDecodeBlock` decodes a non-canonical encoding (the canonical bytes plus one trailing zero word) to the same block as the canonical encoding                                                                                                     |
| <a id="unit-test-utility-facet-2-89ec3q"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q` | Delegatecalled proxy-storage views | Read each moved view through the deployed manager address on a channel with known participants, deposits, slashes, dispute windows and posted calldata; also read the same selectors directly on the facet deployment | Values read through the manager equal the manager's stored state and match what the equivalent internal produces; reading directly on the facet address observes the facet's own empty storage rather than the manager's; no view mutates state | <a id="unit-test-utility-facet-2-89ec3q.p1"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P1` — participant sets (snapshot, pending, union) through the manager; <a id="unit-test-utility-facet-2-89ec3q.p2"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P2` — slashed set, `isParticipantSlashedOnChain` and the up-to-timestamp variant; <a id="unit-test-utility-facet-2-89ec3q.p3"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P3` — snapshot, channel balance and `isChannelOpen` before and after opening; <a id="unit-test-utility-facet-2-89ec3q.p4"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P4` — the five timing values and `getAllTimes` against the constructor's sentinels; <a id="unit-test-utility-facet-2-89ec3q.p5"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P5` — calldata commitment and `isUncommittedInboundMessageBlock` for stored, absent-above-head and at-or-below-head entries; <a id="unit-test-utility-facet-2-89ec3q.p6"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P6` — dispute-window commitments, creation timestamp, reduced result and `isForkDisputed` for a disputed and an undisputed fork; <a id="unit-test-utility-facet-2-89ec3q.p7"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P7` — `isKillPeriodExpired`/`isReduceChallengePeriodExpired` on both sides of their deadlines; <a id="unit-test-utility-facet-2-89ec3q.p8"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P8` — `verifyOutboundMessageBlocks`/`pruneOutboundMessageBlocks` on a linked and a broken chain; <a id="unit-test-utility-facet-2-89ec3q.p9"></a>`UNIT-TEST-UTILITY-FACET-2-89EC3Q.P9` — the same selector read directly on the facet deployment returns the facet's empty storage, not the manager's |

## Related source reports

- [UtilityFacetInterface.sol](./UtilityFacetInterface.sol.md) — declares the stateless helper surface.
- [StateChannelManagerProxy.sol](./StateChannelManagerProxy.sol.md) — routes this facet's view selectors.
- [StateChannelCommon.sol](./StateChannelCommon.sol.md) — the base whose internals the moved views wrap, and the caller of the stateless helpers.
