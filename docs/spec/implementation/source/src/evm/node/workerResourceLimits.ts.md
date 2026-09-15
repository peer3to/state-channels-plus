# workerResourceLimits.ts — Source Report

> **Source:** [src/evm/node/workerResourceLimits.ts](../../../../../../../src/evm/node/workerResourceLimits.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Node worker resource-limit configuration.

## Key design decisions

All root workers use SCP_WORKER_MAX_OLD_SPACE_MB with a 1,024 MB default. Nonpositive values disable the cap. SDK/VM-specific overrides are removed; thread names do not select resource policy.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                |
| ------------ | --------------------------------------- |
| Inputs       | Shared worker memory-cap configuration. |
| Outputs      | Shared worker memory-cap configuration. |
| Owned state  | Shared worker memory-cap configuration. |
| Side effects | Shared worker memory-cap configuration. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                          | Specification IDs |
| ------------------------------------------------------------------------------------ | ----------------- |
| [workerResourceLimits.ts](../../../../../../../src/evm/node/workerResourceLimits.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Role-consistent with the runtime views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                      | Obligation                    | Public entry and setup         | Oracle and forbidden effects  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-worker-resource-limits-1-9hcgk8"></a>`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8` | Absent override uses 1024 MB. | Real owner with scoped inputs. | Absent override uses 1024 MB. | <a id="unit-test-worker-resource-limits-1-9hcgk8.p1"></a>`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P1` — Absent override uses 1024 MB.; <a id="unit-test-worker-resource-limits-1-9hcgk8.p2"></a>`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P2` — Positive finite override is used.; <a id="unit-test-worker-resource-limits-1-9hcgk8.p3"></a>`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P3` — Zero disables the cap.; <a id="unit-test-worker-resource-limits-1-9hcgk8.p4"></a>`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P4` — Negative override disables the cap.; <a id="unit-test-worker-resource-limits-1-9hcgk8.p5"></a>`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P5` — Infinite override uses the default.; <a id="unit-test-worker-resource-limits-1-9hcgk8.p6"></a>`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P6` — Invalid override uses the default. |

## Related source reports

- [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
