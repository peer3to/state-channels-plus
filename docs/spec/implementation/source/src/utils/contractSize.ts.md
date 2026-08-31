# contractSize.ts — Source Report

> **Source:** [src/utils/contractSize.ts](../../../../../../src/utils/contractSize.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/architecture.md](../../../views/architecture/contracts/architecture.md)

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

Owns EIP-170 runtime and EIP-3860 initcode byte limits, byte counting, required artifact-field
validation, and structured size violations used by the build scan and artifact-backed deployment.

## Key design decisions

1. The required input is a narrow named-bytecode shape, not another repository `Artifact` type.
2. Initcode checks use fully encoded deployment data, so constructor arguments count.
3. Missing bytecode fields fail as invalid artifacts instead of measuring as zero.
4. The public package entry re-exports both structured error classes and both limit constants, so
   callers of exported deployment helpers can catch and inspect failures by type.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                            |
| ------------ | --------------------------------------------------- |
| Inputs       | Named artifact bytecode or encoded deployment data. |
| Outputs      | Byte counts or structured errors.                   |
| Owned state  | EIP-170 and EIP-3860 constants.                     |
| Side effects | None.                                               |

## Linked requirements

| Source file                                                    | Specification IDs                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [contractSize.ts](../../../../../../src/utils/contractSize.ts) | [`REQ-CONTRACT-SIZE-1-881Q6E`](../../../../specification/enforcement/contracts.md#req-contract-size-1-881q6e) |

## Assumptions, dependencies, trust boundaries, and limits

- Network deployment remains the final EIP enforcement boundary; these checks fail earlier when full artifact data is available.

## Specification adherence

- Applies the exact runtime and initcode byte ceilings and keeps local-only exemptions outside the policy module.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                           | Gap / divergence                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [`REQ-CONTRACT-SIZE-1-881Q6E`](../../../../specification/enforcement/contracts.md#req-contract-size-1-881q6e) | Partial               | **Here:** shared byte policy and diagnostics. **Other files:** build classification and `deployArtifact` apply it. | Paths without full artifacts rely on network enforcement. |

## Component test obligations

| Unit test ID                                                                    | Obligation           | Public entry and setup                                       | Oracle and forbidden effects                                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-size-1-mx797v"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V` | Contract-size policy | Scan real artifacts and exercise exact synthetic boundaries. | Production artifacts fit, malformed artifacts and oversize values fail with structured details, and exemptions remain exact. | <a id="unit-test-contract-size-1-mx797v.p1"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P1` — all production artifacts; <a id="unit-test-contract-size-1-mx797v.p2"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P2` — runtime boundary; <a id="unit-test-contract-size-1-mx797v.p3"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P3` — initcode boundary; <a id="unit-test-contract-size-1-mx797v.p4"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P4` — constructor arguments; <a id="unit-test-contract-size-1-mx797v.p5"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P5` — missing required field; <a id="unit-test-contract-size-1-mx797v.p6"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P6` — exact exemption recognition; <a id="unit-test-contract-size-1-mx797v.p7"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P7` — stale exemption rejection; <a id="unit-test-contract-size-1-mx797v.p8"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P8` — structured violation details; <a id="unit-test-contract-size-1-mx797v.p9"></a>`UNIT-TEST-CONTRACT-SIZE-1-MX797V.P9` — aggregate runtime and initcode violations in one result |

## Related source reports

- [architecture.md](../../../views/architecture/contracts/architecture.md), [routedFacets.ts](./routedFacets.ts.md).
