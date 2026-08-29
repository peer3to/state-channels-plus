# contractAbi.ts — Source Report

> **Source:** [src/utils/contractAbi.ts](../../../../../../src/utils/contractAbi.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md)

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

Owns ABI fragment identity and ordered ABI merging for all contract bindings.

## Key design decisions

1. Functions, events, and errors use `type:sighash`; constructor, fallback, and receive use their type.
2. The first definition wins, which keeps merge order explicit and removes duplicate signatures.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                   |
| ------------ | ---------------------------------------------------------- |
| Inputs       | One or more ethers-compatible ABIs.                        |
| Outputs      | Stable fragment keys and one de-duplicated fragment array. |
| Owned state  | None.                                                      |
| Side effects | None.                                                      |

## Linked requirements

| Source file                                                  | Specification IDs                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [contractAbi.ts](../../../../../../src/utils/contractAbi.ts) | [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) |

## Assumptions, dependencies, trust boundaries, and limits

- Input ABIs must be valid ethers `InterfaceAbi` values.

## Specification adherence

- Supports one stable manager boundary without widening its callable surface.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                                                  | Gap / divergence                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) | Partial               | **Here:** stable ordered ABI composition. **Other files:** [stateChannelManager.ts](./stateChannelManager.ts.md) owns the public binding. | This helper does not choose the manager surfaces. |

## Component test obligations

| Unit test ID                                                                  | Obligation             | Public entry and setup                 | Oracle and forbidden effects                                    | Required permutations                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ---------------------- | -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-contract-abi-1-hw1a66"></a>`UNIT-TEST-CONTRACT-ABI-1-HW1A66` | Stable ABI composition | Merge real generated manager surfaces. | Complete fragments remain and duplicate identities appear once. | <a id="unit-test-contract-abi-1-hw1a66.p1"></a>`UNIT-TEST-CONTRACT-ABI-1-HW1A66.P1` — callable/event completeness; <a id="unit-test-contract-abi-1-hw1a66.p2"></a>`UNIT-TEST-CONTRACT-ABI-1-HW1A66.P2` — error-union completeness and uniqueness |

## Related source reports

- [stateChannelManager.ts](./stateChannelManager.ts.md), [localDiamond.ts](./localDiamond.ts.md).
