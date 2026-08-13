# StateChannelManagerStorage.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol) > **Status:** Authored — engineer verification pending.
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

The storage layout: timing config, machine reference, facet addresses, per-channel balances/
inbound blocks/snapshot/calldata commitments/dispute data/throttle — the single layout every
delegatecall path shares.

## Key design decisions

1. **Minimized to commitments and accounting** — full data lives off-chain; the chain stores what adjudication needs.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| Inputs       | Routed calls from the manager (delegatecall context). |
| Outputs      | State mutations/verdicts/events per operation group.  |
| Owned state  | The layout itself.                                    |
| Side effects | Events; escrow via consumer where applicable.         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                    | Specification IDs                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [StateChannelManagerStorage.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol) | [`INV-CONTRACT-ARCH-1-TWQHTM`](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                          | Implementation status | Evidence                            | Gap / divergence                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| [`INV-CONTRACT-ARCH-1-TWQHTM`](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm) | Covered               | **Here:** the one canonical layout. | Layout is slot-0 inherited (pre-namespacing); versioned namespaces are the refactor plan. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation       | Public entry and setup                  | Oracle and forbidden effects                                              | Required permutations                                                                                                |
| ----------------------------------------------------------------------------------- | ---------------- | --------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-manager-storage-1-et3gpf"></a>`UNIT-TEST-MANAGER-STORAGE-1-ET3GPF` | Layout stability | Compile-time layout snapshot comparison | Layout matches the committed reference; changes are deliberate migrations | <a id="unit-test-manager-storage-1-et3gpf.p1"></a>`UNIT-TEST-MANAGER-STORAGE-1-ET3GPF.P1` — storage-layout diff gate |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
