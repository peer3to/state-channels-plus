# UtilityFacetInterface.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol) > **Status:** Authored — engineer verification pending.
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

Declaration-only. It names the seven **stateless** helpers that
[StateChannelCommon](./StateChannelCommon.sol.md) calls by plain `CALL` on the deployed utility
facet: `tryDecodeBlock`, `retrieveSignerAddress`, `isAddressInArray`, `subtractAddressArrays`,
`concatAddressArraysNoDuplicates`, `insertIntoAddressArrayNoDuplicates`, and
`isGenesisSnapshotWithoutTimeCheck`
([#L11](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol#L11)–[#L43](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol#L43)).
It declares no state, holds no body, and is never deployed on its own; it exists purely as the
compile-time type bound to `utilityFacetAddress`.

## Key design decisions

1. **Exists only to break a definition cycle.** [UtilityFacet](./UtilityFacet.sol.md) now derives
   from `StateChannelCommon` (its proxy-storage views are delegatecalled and must see the manager
   layout), while `StateChannelCommon` needs the utility facet's type to make its plain calls.
   Naming the concrete contract from the base would be circular, so the base binds this abstract
   declaration instead
   ([#L10](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol#L10)).
2. **`UtilityFacet` implements it with `override`, so the compiler keeps the two in sync.** A
   signature drift on the facet fails the build rather than producing a silently unreachable
   external call at run time
   ([UtilityFacet.sol#L13](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L13)).
3. **Only the stateless helpers are declared here.** The facet's proxy-storage views are reached
   through the proxy's selector routing, not through this type, so they are deliberately absent —
   the two surfaces stay separable ([UtilityFacet.sol#L262](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L262)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| Inputs       | None — declarations only.                                                             |
| Outputs      | A Solidity type; the declared function signatures and their state mutability.         |
| Owned state  | None.                                                                                 |
| Side effects | None. Every declared function is `pure` or `view`, so no caller can mutate state here. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                             | Specification IDs                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UtilityFacetInterface.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol)       | [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje), [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b) |

Contribution per ID: [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje) — the composition's required helper module is
identified by type, and an incompatible utility facet is rejected at compile time instead of
failing at run time; [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b) — every declared helper is `pure`/`view`, so the
stateless contract of this helper set is part of its type.

## Assumptions, dependencies, trust boundaries, and limits

- **Deployment commitment.** The address stored in `utilityFacetAddress` is chosen by the deployer;
  this type does not verify that the deployed code actually implements it. The compile-time
  guarantee covers only the in-repo `UtilityFacet`.
- **No trust boundary of its own.** It carries no authorization or validation; callers reach the
  facet by plain `CALL`, so the helpers run in the facet's own (empty) storage context.
- **Limit:** declaring a helper here does not route it through the proxy. A helper that also needs
  to be reachable on the diamond boundary needs a routing entry in
  [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) as well.

## Specification adherence

- Purely declarative; consistent with the composition rules of
  [contracts.md](../../../../../specification/enforcement/contracts.md) — it adds no externally
  reachable operation and cannot relax any validation.
- Every declaration is `pure` or `view`, matching the stateless-helper contract asserted by
  [UtilityFacet](./UtilityFacet.sol.md).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                         | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                              | Gap / divergence                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje) | Partial               | **Here:** the helper module the manager depends on is named by type ([#L10](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol#L10)), and [UtilityFacet](./UtilityFacet.sol.md) must `override` every declaration. **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) holds the deployment-time facet wiring and the EIP-170 budget it must fit.                          | Compile-time only: nothing checks that the **deployed** `utilityFacetAddress` implements this type (deployer-trusted, see assumptions).      |
| [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b) | Covered               | **Here:** every declaration is `pure`/`view` ([#L11](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol#L11)–[#L43](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol#L43)), so an implementation that mutated state would not compile. **Other files:** [UtilityFacet](./UtilityFacet.sol.md) implements the helpers; [StateChannelCommon](./StateChannelCommon.sol.md) is the caller. | None.                                                                                                                                       |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

The file declares no executable behavior: it has no bodies, no state, and no deployment of its own.
Its only guarantee — that `UtilityFacet` implements every declaration with a matching signature and
mutability — is enforced by the Solidity compiler, so there is nothing a runtime test could
independently observe. Component obligations for the implementations live on
[UtilityFacet](./UtilityFacet.sol.md).

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [UtilityFacet.sol](./UtilityFacet.sol.md) — the sole implementation.
- [StateChannelCommon.sol](./StateChannelCommon.sol.md) — the caller that binds this type to `utilityFacetAddress`.
- [StateChannelManagerProxy.sol](./StateChannelManagerProxy.sol.md) — holds the facet wiring and the selector routing for the facet's other surface.
