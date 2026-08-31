# Clock.ts — Source Report

> **Source:** [src/Clock.ts](../../../../../src/Clock.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

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

The process-wide chain-time tracker. `Clock.init` derives an adjustment and average block time from
the active provider, then the static read methods serve estimated or direct chain time to protocol
window calculations. A provider replacement is a make-before-break handover: the initialized clock
stays readable until the replacement has synchronized successfully.

## Key design decisions

1. **Local wall time is adjusted from chain observations.** Consumers use the chain-derived clock,
   while `getBlockchainTime` reads the provider directly
   ([`REQ-TIME-1-FM4651`](../../../specification/protocol-model/time.md#req-time-1-fm4651)).
2. **Initialization is shared.** Calls using the same provider await one synchronization promise.
3. **Provider replacement is make-before-break.** A different provider starts a new synchronization
   without clearing the live instance. Successful synchronization swaps the singleton; failure
   clears only the pending promise, leaving the previous clock available and allowing retry.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Inputs       | An ethers provider at initialization; wall time and recent chain blocks during synchronization.                       |
| Outputs      | Estimated chain seconds, average observed block time, direct latest-block time/height, and provider ownership checks. |
| Owned state  | One live `Clock` instance and one shared initialization promise.                                                      |
| Side effects | Provider reads during initialization and direct chain-time/network queries; atomic replacement of the live singleton. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                             | Specification IDs                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Clock.ts](../../../../../src/Clock.ts) | [`REQ-TIME-1-FM4651`](../../../specification/protocol-model/time.md#req-time-1-fm4651), [`REQ-TIME-2-VG94S7`](../../../specification/protocol-model/time.md#req-time-2-vg94s7) |

## Assumptions, dependencies, trust boundaries, and limits

- The provider is the trusted chain-view dependency described by the protocol trust model.
- `Clock` is process-global. Concurrent runtimes therefore share the live instance and replacement
  handover.
- The previous provider may be stale or shutting down during replacement. It remains a temporary
  read fallback, not the final owner after the new provider synchronizes.

## Specification adherence

- The estimate is based on recent block timestamps and is exposed instead of raw wall time.
- A successful replacement is not published until its chain reads and adjustment calculation
  complete.
- A failed replacement neither installs the failed provider nor creates an uninitialized interval
  for concurrent readers.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                | Implementation status | Evidence                                                                                                                                                  | Gap / divergence                                                                                                             |
| -------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-TIME-1-FM4651`](../../../specification/protocol-model/time.md#req-time-1-fm4651) | Covered               | **Here:** initialization derives the local protocol clock from the provider's latest block timestamp; direct chain-time reads use the same live provider. | None.                                                                                                                        |
| [`REQ-TIME-2-VG94S7`](../../../specification/protocol-model/time.md#req-time-2-vg94s7) | Partial               | **Here:** `syncClock` estimates adjustment and average block time from up to ten recent blocks, including replacement providers.                          | The specification does not set a numeric skew bound, and this file does not periodically resynchronize after initialization. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                    | Obligation                  | Public entry and setup                                                           | Oracle and forbidden effects                                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-clock-1-6k546k"></a>`UNIT-TEST-CLOCK-1-6K546K` | Initialization and handover | Call `Clock.init` with identical, replacement, failed, and overlapping providers | One usable owner is published; failed or pending replacement never creates an uninitialized interval or claims ownership | <a id="unit-test-clock-1-6k546k.p1"></a>`UNIT-TEST-CLOCK-1-6K546K.P1` — overlapping calls for one provider share initialization; <a id="unit-test-clock-1-6k546k.p2"></a>`UNIT-TEST-CLOCK-1-6K546K.P2` — a synchronized replacement becomes the live owner and serves reads; <a id="unit-test-clock-1-6k546k.p3"></a>`UNIT-TEST-CLOCK-1-6K546K.P3` — failed replacement does not take ownership and a later live replacement succeeds; <a id="unit-test-clock-1-6k546k.p4"></a>`UNIT-TEST-CLOCK-1-6K546K.P4` — reads during replacement continue through the previous initialized instance until atomic cutover; <a id="unit-test-clock-1-6k546k.p5"></a>`UNIT-TEST-CLOCK-1-6K546K.P5` — overlapping different-provider initializations settle on one usable owner |

## Related source reports

- [EventSyncService](./stateManager/eventSync/EventSyncService.ts.md) (feeds observations).
