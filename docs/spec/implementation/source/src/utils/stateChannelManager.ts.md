# stateChannelManager.ts — Source Report

> **Source:** [src/utils/stateChannelManager.ts](../../../../../../src/utils/stateChannelManager.ts) > **Status:** Authored — engineer verification pending.
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

Publishes the canonical deployed-manager ABI and connector. Functions and events come only from
`StateChannelManagerInterface`; errors come only from generated `errorAbis`.

## Key design decisions

1. The module merges `StateChannelManagerInterface__factory.abi` with `errorAbis` and has no facet inventory.
2. `connectStateChannelManager` constructs `ethers.Contract` with that merged ABI, so serialization and host reconstruction keep all reachable errors.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                 |
| ------------ | -------------------------------------------------------- |
| Inputs       | Manager address and optional contract runner.            |
| Outputs      | Typed manager binding carrying the combined ABI.         |
| Owned state  | `stateChannelManagerAbi`.                                |
| Side effects | None during construction; calls use the supplied runner. |

## Linked requirements

| Source file                                                                  | Specification IDs                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [stateChannelManager.ts](../../../../../../src/utils/stateChannelManager.ts) | [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) |

## Assumptions, dependencies, trust boundaries, and limits

- `GeneratedArtifacts.errorAbis` is the complete reachable-manager error owner.

## Specification adherence

- Keeps one typed manager address while preserving the full revert vocabulary.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                                                         | Gap / divergence                                    |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [`REQ-CONTRACT-ARCH-1-9W5390`](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390) | Partial               | **Here:** one connector exposes the declared calls/events and all generated errors. **Other files:** the proxy and facets implement the surface. | Runtime correctness remains owned by the contracts. |

## Component test obligations

| Unit test ID                                                                        | Obligation                        | Public entry and setup                                               | Oracle and forbidden effects                                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-manager-binding-1-wb503z"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z` | Complete deployed-manager binding | Build and serialize the real merged ABI; connect with a null runner. | Calls/events equal the interface, errors equal the generated union, and proxy/facet errors parse before and after JSON transport. | <a id="unit-test-manager-binding-1-wb503z.p1"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P1` — exact functions/events; <a id="unit-test-manager-binding-1-wb503z.p2"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P2` — exact error union; <a id="unit-test-manager-binding-1-wb503z.p3"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P3` — all old proxy errors; <a id="unit-test-manager-binding-1-wb503z.p4"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P4` — facet-only argument error; <a id="unit-test-manager-binding-1-wb503z.p5"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P5` — JSON round trip parses proxy and facet errors; <a id="unit-test-manager-binding-1-wb503z.p6"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P6` — null-runner binding; <a id="unit-test-manager-binding-1-wb503z.p7"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P7` — deploy helper binding parses real proxy and facet reverts; <a id="unit-test-manager-binding-1-wb503z.p8"></a>`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P8` — custom-RPC runtime uses the canonical connector for both manager bindings |

## Related source reports

- [contractAbi.ts](./contractAbi.ts.md), [GeneratedArtifacts.ts](./GeneratedArtifacts.ts.md), [localDiamond.ts](./localDiamond.ts.md).
