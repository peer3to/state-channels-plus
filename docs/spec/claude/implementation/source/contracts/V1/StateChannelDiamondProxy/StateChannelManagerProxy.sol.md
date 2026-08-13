# StateChannelManagerProxy.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol) > **Status:** Authored — engineer verification pending.
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

The manager: the single stable address. Owns `open` (unanimous opening with composable atomic
deposits, genesis snapshot storage), `postBlockCalldata` (commitment keyed channel/sender/fork/
height with the too-late guard, author-only, no overwrite, unverified-by-design), `multicall`
(delegatecall loop against itself, first-revert bubbling), the delegating wrappers for every
facet operation, the consumer fallback (raw calldata pass-through), and the timing-config
constructor with zero-means-default sentinels.

## Key design decisions

1. **Explicit wrapper routing (pre-Diamond).** Every facet function is mirrored as a wrapper delegatecalling a constructor-fixed facet address — one storage context, one address, but interface mirroring instead of selector routing; the planned refactor replaces this ([`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje), [`OQ-7-M5G9M3`](../../../../../specification/open-questions.md#oq-7-m5g9m3) family).
2. **Calldata posting stores a commitment, not truth.** The block is unverified at posting; the sender vouches and junk is later slashable against the commitment (../../../../../specification/security/data-availability.md).
3. **`multicall` enables atomic compositions** (proofs-then-upload, reduce-then-advance) without relaxing per-operation validation.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                   |
| ------------ | -------------------------------------------------------------------------- |
| Inputs       | All external operations of the operation inventory.                        |
| Outputs      | Events; routed delegatecalls; view results.                                |
| Owned state  | The entire manager storage layout (facets are stateless delegate targets). |
| Side effects | Escrow movements via the consumer facet.                                   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [StateChannelManagerProxy.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol) | [`INV-CONTRACT-ARCH-1-TWQHTM`](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm), [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390), [`REQ-CONTRACT-ARCH-3-GEGD78`](../../../../../specification/enforcement/contracts.md#req-contract-arch-3-gegd78), [`REQ-ENFADM-1-V926CA`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca) |

## Assumptions, dependencies, trust boundaries, and limits

- Constructor wiring is trusted (deployer-chosen facet addresses, no code verification — noted deployment commitment).
- Facets MUST NOT declare state (convention-only today — automated layout check is future work).

## Specification adherence

- Single logical state via delegatecall-into-own-storage ([`INV-CONTRACT-ARCH-1-TWQHTM`](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm)); stable external boundary ([`REQ-CONTRACT-ARCH-1-9W5390`](../../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)); `onlySelf` confinement for composition-internal operations ([`REQ-CONTRACT-ARCH-3-GEGD78`](../../../../../specification/enforcement/contracts.md#req-contract-arch-3-gegd78)).

## Specification contradictions

**Deployment size:** the proxy measures over the EIP-170 budget in the current build (view §3) — a `Contradicts` against [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje) until the refactor lands.

## Missing behavior

Selector-based routing, facet replacement, and namespaced storage (the intended Diamond refactor); [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) (open() length/zero-address checks) lives on this surface.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                          | Implementation status | Evidence                                                                                                                                     | Gap / divergence                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`INV-CONTRACT-ARCH-1-TWQHTM`](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm) | Covered               | **Here:** all routes delegatecall against one layout. **Other files:** [StateChannelManagerStorage](./StateChannelManagerStorage.sol.md).    | None.                                                                                                                                            |
| [`REQ-CONTRACT-ARCH-3-GEGD78`](../../../../../specification/enforcement/contracts.md#req-contract-arch-3-gegd78) | Covered               | **Here:** `onlySelf` on composition-internal operations.                                                                                     | None.                                                                                                                                            |
| [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje) | Contradicts           | **Here:** measured deployed size exceeds the mainnet budget (view §3 table).                                                                 | Over EIP-170 until the decomposition refactor; tracked with the architecture future work.                                                        |
| [`REQ-ENFADM-1-V926CA`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca)     | Partial               | **Here:** `open` unanimity + composable deposits + genesis storage. **Other files:** joins in [JoinChannelFacet](./JoinChannelFacet.sol.md). | [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag): missing participants/balances length and nonzero-address checks in `open`. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                   | Public entry and setup                                                                                                                                     | Oracle and forbidden effects                                                                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-manager-proxy-1-ntyr71"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71` | Opening and calldata posting | Open with valid/dup/zero ids, unanimous and short signatures, atomic and partial deposits; post calldata within/after the window, as non-author, and twice | Only valid unanimous opens store genesis; posting guards enforce author/no-overwrite/deadline; [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) cases documented | <a id="unit-test-manager-proxy-1-ntyr71.p1"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P1` — valid open; <a id="unit-test-manager-proxy-1-ntyr71.p2"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P2` — duplicate channel id; <a id="unit-test-manager-proxy-1-ntyr71.p3"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P3` — short threshold; <a id="unit-test-manager-proxy-1-ntyr71.p4"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P4` — atomic deposits open; <a id="unit-test-manager-proxy-1-ntyr71.p5"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P5` — non-author post revert; <a id="unit-test-manager-proxy-1-ntyr71.p6"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P6` — [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) length mismatch (documents finding); <a id="unit-test-manager-proxy-1-ntyr71.p7"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P7` — zero channel id; <a id="unit-test-manager-proxy-1-ntyr71.p8"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P8` — partial-deposit open; <a id="unit-test-manager-proxy-1-ntyr71.p9"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P9` — overwrite post revert; <a id="unit-test-manager-proxy-1-ntyr71.p10"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P10` — post-deadline post revert; <a id="unit-test-manager-proxy-1-ntyr71.p11"></a>`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P11` — [`DEF-1-92NTAG`](../../../../../audit/open-findings.md#def-1-92ntag) zero-address (documents finding)                                                                          |
| <a id="unit-test-manager-proxy-2-kjrmb8"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8` | Routing confinement          | Call each wrapper, each onlySelf op directly and via composition, and multicall compositions with a failing leg                                            | Wrappers route to one state; direct internal calls revert; multicall is all-or-nothing                                                                                               | <a id="unit-test-manager-proxy-2-kjrmb8.p1"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P1` — dispute-manager wrapper group; <a id="unit-test-manager-proxy-2-kjrmb8.p2"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P2` — depositAssetsComposable direct revert; <a id="unit-test-manager-proxy-2-kjrmb8.p3"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P3` — multicall bubbling; <a id="unit-test-manager-proxy-2-kjrmb8.p4"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P4` — dispute-verification wrapper group; <a id="unit-test-manager-proxy-2-kjrmb8.p5"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P5` — fraud-proof wrapper group; <a id="unit-test-manager-proxy-2-kjrmb8.p6"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P6` — dispute-fraud-proof wrapper group; <a id="unit-test-manager-proxy-2-kjrmb8.p7"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P7` — state-snapshot wrapper group; <a id="unit-test-manager-proxy-2-kjrmb8.p8"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P8` — join-channel wrapper group; <a id="unit-test-manager-proxy-2-kjrmb8.p9"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P9` — state-proof wrapper group; <a id="unit-test-manager-proxy-2-kjrmb8.p10"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P10` — consumer fallback routing; <a id="unit-test-manager-proxy-2-kjrmb8.p11"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P11` — withdrawAssetsComposable direct revert; <a id="unit-test-manager-proxy-2-kjrmb8.p12"></a>`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P12` — executeStateTransition direct revert |

## Related source reports

- Every facet report in this directory; [StateChannelCommon](./StateChannelCommon.sol.md); [AConsumerFacet](./AConsumerFacet.sol.md).
