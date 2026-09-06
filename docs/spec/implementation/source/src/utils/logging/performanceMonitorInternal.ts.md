# performanceMonitorInternal.ts — Source Report

> **Source:** [src/utils/logging/performanceMonitorInternal.ts](../../../../../../../src/utils/logging/performanceMonitorInternal.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

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

Internal types of the event-loop monitor: the typed watchdog data (`EventLoopDelayDetails`), the sample shape both monitors report, the injectable `PerformanceSampleSource`, and `PerformanceMonitorInternalOptions`.

## Key design decisions

The shared reporter owns strict threshold comparisons, exact metadata and watchdog details. Each platform retains sample acquisition, timer lifetime, stdout behavior and throw/stop ordering. See [performanceMonitorInternal.ts](../../../../../../../src/utils/logging/performanceMonitorInternal.ts#L65).

1. **Not part of the package API.** The exported `LoggerPerformanceMonitorOptions` stays as is; these types extend it for the loggers and for tests only and are not re-exported from the package root.

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                           | Specification IDs                                                                                |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [performanceMonitorInternal.ts](../../../../../../../src/utils/logging/performanceMonitorInternal.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

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

| Unit test ID                                                                                                    | Obligation                    | Public entry and setup                                                                                                                        | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-performance-monitor-internal-32-x9ntgn"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN` | Performance report projection | Use a real logger store with explicit samples; inspect exact platform fields, strict thresholds, disabled errors and per-call config changes. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-performance-monitor-internal-32-x9ntgn.p1"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P1` — reports exact Node verbose metadata below thresholds; <a id="unit-test-performance-monitor-internal-32-x9ntgn.p2"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P2` — reports browser defaults with estimated utilization only; <a id="unit-test-performance-monitor-internal-32-x9ntgn.p3"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P3` — warns and returns browser threshold details for long tasks alone; <a id="unit-test-performance-monitor-internal-32-x9ntgn.p4"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P4` — does not warn or trip at exact thresholds; <a id="unit-test-performance-monitor-internal-32-x9ntgn.p5"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P5` — warns and trips above the Node maximum threshold; <a id="unit-test-performance-monitor-internal-32-x9ntgn.p6"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P6` — disables threshold errors without disabling warnings; <a id="unit-test-performance-monitor-internal-32-x9ntgn.p7"></a>`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P7` — reads the current config threshold for each report |

## Related source reports

- Consumers per the views.
