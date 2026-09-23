# kernelCounters.ts — Source Report

> **Source:** [src/utils/logging/node/kernelCounters.ts](../../../../../../../../src/utils/logging/node/kernelCounters.ts) > **Status:** Authored — engineer verification pending.
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

Linux kernel scheduler counters for the event-loop monitor in [NodeLogger.ts](./NodeLogger.ts.md): the calling thread's CPU time and run-queue wait from `/proc/thread-self/schedstat`, and for one thread per process the host's busy and steal share from `/proc/stat`, the CPU pressure-stall total from `/proc/pressure/cpu` and this cgroup's quota throttling from `cpu.stat`. `hostDelta` turns two host readings into the per-interval sample fields. Every reader returns `undefined` off Linux or where a file is not exposed, so the monitor omits the fields rather than reporting placeholders.

## Key design decisions

1. **Reads are cheap and rare.** Each reader is a single synchronous procfs or cgroupfs read of a few bytes to about a kilobyte, performed once per monitor interval (1 s by default) per monitored thread, and only while the test-only event-loop threshold is configured.
2. **Absence is silence, never a zero.** A missing file yields `undefined` and the sample carries no field, so a reported number is always a kernel measurement.
3. **The cgroup is resolved from the process's own membership** (`/proc/self/cgroup`, then the v2 root and the v1 location), so inside a worker container the throttling figure is the container's.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| Inputs       | procfs and cgroupfs files named above.                                         |
| Outputs      | Thread counters, host counters, and the per-interval delta fields of a sample. |
| Owned state  | None.                                                                          |
| Side effects | File reads only.                                                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                           | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [kernelCounters.ts](../../../../../../../../src/utils/logging/node/kernelCounters.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Linux only; other platforms report nothing. `/proc/thread-self` needs Linux 3.17 or later, pressure-stall files need PSI enabled, and per-thread schedstats need `CONFIG_SCHED_INFO`.

## Specification adherence

- Supplies the optional scheduler and host fields of the watchdog delay data ([`REQ-RUNTIME-3-VQXW59.T1.P60`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p60)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                  | Gap / divergence                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Partial               | **Here:** the readers and `hostDelta`. **Other files:** the sampling loop and projection in [NodeLogger.ts](./NodeLogger.ts.md) and [performanceMonitorInternal.ts](../performanceMonitorInternal.ts.md). | Verified through the monitor's real-source test ([`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P5`](NodeLogger.ts.md#unit-test-node-logger-32-b1jtby.p5)). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [NodeLogger.ts](./NodeLogger.ts.md) — the only consumer.
- [performanceMonitorInternal.ts](../performanceMonitorInternal.ts.md) — the sample and details types.
