# BrowserLogger.ts — Source Report

> **Source:** [src/utils/logging/browser/BrowserLogger.ts](../../../../../../../../src/utils/logging/browser/BrowserLogger.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Browser logger implementation (console adapters).

## Key design decisions

Sample reporting delegates to the shared reporter with estimated utilization and long-task fields. Browser scheduling, stop order and error construction remain local. See [BrowserLogger.ts](../../../../../../../../src/utils/logging/browser/BrowserLogger.ts#L1).

1. **Same loop shape as the Node monitor.** The real browser source collects timer-drift delay samples and long-task durations between reports; a test can inject a scripted source. Past the threshold the monitor stops itself and throws the unchanged message with typed `eventLoopDelay` data (`runtime: "browser"`, estimated utilization, long-task fields).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | None.           |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                            | Specification IDs |
| -------------------------------------------------------------------------------------- | ----------------- |
| [BrowserLogger.ts](../../../../../../../../src/utils/logging/browser/BrowserLogger.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Platform pair must expose identical observable behavior.

## Specification adherence

- Role-consistent platform adapter.

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

| Unit test ID                                                                      | Obligation                 | Public entry and setup                 | Oracle and forbidden effects                            | Required permutations                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | -------------------------- | -------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-browser-logger-1-6fct8f"></a>`UNIT-TEST-BROWSER-LOGGER-1-6FCT8F` | Browser logger integration | Use the real browser logger and store. | The recorded warning retains browser-specific metadata. | <a id="unit-test-browser-logger-1-6fct8f.p1"></a>`UNIT-TEST-BROWSER-LOGGER-1-6FCT8F.P1` — browser logger stores long-task warning metadata with estimated utilization and no Node utilization field |

## Related source reports

- The platform-pair counterpart's report.

Shared operation owners: [performanceMonitorInternal.ts.md](../performanceMonitorInternal.ts.md).
