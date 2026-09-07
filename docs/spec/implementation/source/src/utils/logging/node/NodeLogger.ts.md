# NodeLogger.ts — Source Report

> **Source:** [src/utils/logging/node/NodeLogger.ts](../../../../../../../../src/utils/logging/node/NodeLogger.ts) > **Status:** Authored — engineer verification pending.
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

Node logger implementation (console/stream sinks, colorized).

## Key design decisions

Sample reporting delegates to the shared reporter. Node retains perf_hooks initialization, peak-only stdout markers and stopping the source before watchdog error construction. See [NodeLogger.ts](../../../../../../../../src/utils/logging/node/NodeLogger.ts#L16).

1. **One reporting loop over a sample source.** The real source wraps the perf_hooks delay histogram and event-loop utilization; a test injects a scripted source. The loop is unchanged: warn or verbose per sample, the `##E2E_TIMING##` peak marker under the test-only config, and past the threshold one throw with the unchanged message text and a typed `eventLoopDelay` (`EventLoopDelayDetails`). The monitor stops itself before it throws, so a later tick reports nothing. `onStarted` fires once the interval is installed.

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

| Source file                                                                   | Specification IDs |
| ----------------------------------------------------------------------------- | ----------------- |
| [NodeLogger.ts](../../../../../../../../src/utils/logging/node/NodeLogger.ts) |                   |

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

| Unit test ID                                                                                | Obligation              | Public entry and setup                                                                                                                                  | Oracle and forbidden effects                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-node-logger-monitor-1-s8qme5"></a>`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5` | Watchdog throw contract | Start the monitor on a real logger with a scripted sample source and a synthetic threshold under fake timers                                            | Exactly one throw with the unchanged message and structured delay data; sampling stops after it; quiet samples never throw | <a id="unit-test-node-logger-monitor-1-s8qme5.p1"></a>`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P1` — one over-threshold sample throws the unchanged message with `eventLoopDelay` data; <a id="unit-test-node-logger-monitor-1-s8qme5.p2"></a>`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P2` — sampling stops after the throw so a later tick reports nothing; <a id="unit-test-node-logger-monitor-1-s8qme5.p3"></a>`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P3` — samples below the threshold keep the monitor quiet                                                                                           |
| <a id="unit-test-node-logger-32-b1jtby"></a>`UNIT-TEST-NODE-LOGGER-32-B1JTBY`               | Monitor lifecycle       | Run the real monitor with a scripted source or real histogram; inspect source counts, peak marker output, early stop and source-initialization warning. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.               | <a id="unit-test-node-logger-32-b1jtby.p1"></a>`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P1` — resets after each sample and stops the source on explicit stop; <a id="unit-test-node-logger-32-b1jtby.p2"></a>`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P2` — can stop before the real sample source becomes ready; <a id="unit-test-node-logger-32-b1jtby.p3"></a>`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P3` — emits timing markers only when the running peak increases; <a id="unit-test-node-logger-32-b1jtby.p4"></a>`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P4` — warns when the real histogram source rejects an invalid resolution |

## Related source reports

- The platform-pair counterpart's report.

Shared operation owners: [errorMessage.ts.md](../../errorMessage.ts.md), [performanceMonitorInternal.ts.md](../performanceMonitorInternal.ts.md).
