# StateChannelManagerInterface.sol — Source Report

> **Source:** [contracts/V1/StateChannelManagerInterface.sol](../../../../../../contracts/V1/StateChannelManagerInterface.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../views/architecture/contracts/architecture.md)

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

The caller-side declaration of the **whole** deployed diamond surface: the union of what
[StateChannelManagerProxy](./StateChannelDiamondProxy/StateChannelManagerProxy.sol.md) implements
itself and everything its fallback routes to a facet. It is `abstract`, declares no bodies and no
state, and **nothing implements it**
([#L15](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L15)).

Its declarations are grouped by owner: `// implemented by StateChannelManagerProxy`
([#L16](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L16)) then one
`// routed to <Facet>` block per facet — UtilityFacet
([#L42](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L42)), DisputeManagerFacet
([#L146](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L146)),
DisputeVerificationFacet ([#L155](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L155)),
FraudProofFacet ([#L189](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L189)),
DisputeFraudProofFacet ([#L198](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L198)),
StateSnapshotFacet ([#L213](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L213)),
JoinChannelFacet ([#L228](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L228)) and
StateProofFacet ([#L242](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L242)).
It inherits `StateChannelManagerEvents`, so a consumer bound to this type also decodes every event
the diamond emits.

Two kinds of caller bind it to `address(this)` or to a deployed address: facets making typed
self-calls into proxy-implemented operations, and TypeScript through the generated
`StateChannelManagerInterface__factory`.

## Key design decisions

1. **It is a typing artifact, not a contract the proxy satisfies.** The proxy used to inherit it
   and pay a forwarder body for every declaration; the routing refactor removed those bodies, so the
   proxy no longer inherits it. The ABI callers see is unchanged — it moved from being _implemented_
   to being _declared here_
   ([#L9](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L9)).
2. **It is an exact superset of the previous proxy ABI.** Every name and parameter list is
   preserved, plus the one new read-only `facetAddressForSelector`
   ([#L40](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L40)), so no caller —
   on-chain or off-chain — had to change an encoding.
3. **Each declaration repeats the implementing function's state mutability, not the forwarder's.**
   The old proxy forwarder bodies were `nonpayable` even when the facet function reads nothing, and
   those mutabilities were carried over verbatim when the declarations moved here. They are now
   corrected against the owning facet: `reduce`, `hasInvalidTimestamp`, `isDisputeInboundHashValid`,
   `isCorrectLatestState`, `areSignedBlocksLinkedAndVerified`,
   `isInvalidBlockStructureInStateProof` and `findFirstInvalidBlockStructureInStateProof` became
   `view`; `hasStateProofHeaderMismatch` became `pure`; and
   `isGenesisSnapshotWithoutTimeCheck`/`isSnapshotNewer` moved from `view` to `pure`. This is not
   cosmetic: mutability is what decides whether ethers sends an `eth_call` or a transaction, so a
   `nonpayable` declaration of a read-only facet function costs the caller a transaction and returns
   no value ([#L135](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L135)).
   Parameter and return names were also aligned with the facets in the same pass; they are ABI-neutral.
4. **Declarations are grouped by their owning facet.** The comment blocks mirror the proxy's routing
   table, which is what makes an accidental divergence visible in review
   ([#L16](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L16)).
5. **It inherits `StateChannelManagerEvents`** so one bound type covers calls and event decoding —
   this is what lets a single TypeScript contract object serve the SDK
   ([#L15](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L15)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------- |
| Inputs       | None — declarations only.                                                                   |
| Outputs      | A Solidity type and the generated ABI/typechain bindings; the inherited event declarations. |
| Owned state  | None.                                                                                       |
| Side effects | None. Every effect belongs to whatever contract answers at the bound address.               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                         | Specification IDs                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateChannelManagerInterface.sol](../../../../../../contracts/V1/StateChannelManagerInterface.sol) | [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390), [`REQ-CONTRACT-ARCH-5-QT17P1`](../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) |

Contribution per ID: [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) — it is the written form of the stable external
boundary, unchanged across the internal decomposition; [`REQ-CONTRACT-ARCH-5-QT17P1`](../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) — it enumerates
the externally visible operations and names each one's owner in its section headings.

## Assumptions, dependencies, trust boundaries, and limits

- **Nothing enforces that it matches the deployment.** Because no contract implements it, the
  compiler cannot detect a declaration with no routing entry, a routed selector with no
  declaration, or a declaration whose mutability or signature disagrees with the implementing
  function. All four directions are review-and-test obligations
  ([`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P25`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p25),
  [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P26`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p26),
  [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P27`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p27),
  [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P28`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p28)).
- **A declaration is unreachable if the proxy implements the same selector itself**, because the
  proxy body dispatches before the fallback. Nothing in the compiler prevents that either; it is
  covered by
  [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P24`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p24).
- **A wrong state mutability is a caller-visible defect, not a documentation nit.** Ethers reads it
  from this ABI to choose between a call and a transaction, so a read-only facet function declared
  `nonpayable` here is billed and returns nothing.
- Declarative/support code: every behaviour is owned by the contract that answers the call.
- No trust boundary of its own; binding this type to a hostile address does not make its answers
  trustworthy.

## Specification adherence

- Declares the operation inventory of
  [contracts.md](../../../../specification/enforcement/contracts.md) at one address, grouped by
  owning module.
- Adds no operation beyond what the deployment answers, and no state.
- Each declaration now carries the implementing function's state mutability and full signature, so
  a caller bound to this type reaches every operation the same way the implementing contract
  offers it.

## Specification contradictions

None demonstrated.

## Missing behavior

- **No compile-time or deploy-time reconciliation with the proxy's routing table** (see
  assumptions). A missing routing entry makes a declared function fall through to the consumer
  facet instead of reverting.
- **No compile-time check that a declaration's mutability and signature match the implementing
  facet function.** The ten mutability corrections listed in the key design decisions were found by
  the routing test, not by the compiler, and the same class of drift can recur.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                  | Gap / divergence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) | Covered               | **Here:** the complete lifecycle, message, proof, dispute and view surface is declared once, at one address ([#L15](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L15)). **Other files:** [StateChannelManagerProxy](./StateChannelDiamondProxy/StateChannelManagerProxy.sol.md) makes it answer; [localDiamond.ts](../../src/utils/localDiamond.ts.md) binds it for the client mirror. | None.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [`REQ-CONTRACT-ARCH-5-QT17P1`](../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) | Partial               | **Here:** every declaration sits under a heading naming its owner — proxy-implemented or routed to a named facet ([#L16](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L16)). **Other files:** [StateChannelManagerProxy](./StateChannelDiamondProxy/StateChannelManagerProxy.sol.md) holds the authoritative routing table; each facet report owns its group's semantics.              | The grouping comments themselves are documentation only, and operations reachable through the consumer fallback are not listed here at all. Set equality with the deployed callable surface is checked by the routing test ([`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P25`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p25), [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P26`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p26)), not by the compiler. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

The file declares no executable behaviour — no bodies, no state, no deployment. The one property
worth proving, that its declarations agree with the deployed callable surface in both directions
and repeat each implementor's mutability and signature, is an obligation of the proxy and is
tracked as
[`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P25`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p25),
[`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P26`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p26),
[`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P27`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p27)
and
[`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P28`](StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p28),
alongside its sibling routing permutations.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [StateChannelManagerProxy.sol](./StateChannelDiamondProxy/StateChannelManagerProxy.sol.md) — implements part of this surface and routes the rest.
- [StateChannelManagerEvents.sol](./StateChannelManagerEvents.sol.md) — the inherited event declarations.
- [localDiamond.ts](../../src/utils/localDiamond.ts.md) — merges this ABI with the mirror's own for the client binding.
- The facet reports under [StateChannelDiamondProxy/](./StateChannelDiamondProxy/README.md) — the owners of the routed declarations.
