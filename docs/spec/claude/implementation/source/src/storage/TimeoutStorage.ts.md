# TimeoutStorage.ts — Source Report

> **Source:** [src/storage/TimeoutStorage.ts](../../../../../../../src/storage/TimeoutStorage.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

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

At most one timeout candidate per fork, retaining the lowest block height.

## Key design decisions

1. **Lowest height wins.** A stored update with a higher height than the retained candidate is
   ignored ([#L20](../../../../../../../src/storage/TimeoutStorage.ts#L20)), mirroring the protocol's lowest-timed-out-height precedence so local escalation never skips ahead. Equal height replaces (refreshing evidence context for the same slot).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                |
| ------------ | --------------------------------------- |
| Inputs       | (fork, timeout struct).                 |
| Outputs      | Candidate per fork or explicit absence. |
| Owned state  | `timeouts` fork → struct.               |
| Side effects | None.                                   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                             | Specification IDs                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [TimeoutStorage.ts](../../../../../../../src/storage/TimeoutStorage.ts) | [`REQ-TOSTORE-1-JQPXBC`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-1-jqpxbc) |

## Assumptions, dependencies, trust boundaries, and limits

- Holds a candidate, not a claim: validity and submission decisions live with dispute processing.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Lowest-height retention independent of arrival order ([`REQ-TOSTORE-1-JQPXBC`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-1-jqpxbc)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                   | Implementation status | Evidence                                                                                                                                                                                                                                              | Gap / divergence |
| --------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-TOSTORE-1-JQPXBC`](../../../../specification/storage/calldata-and-timeouts.md#req-tostore-1-jqpxbc) | Covered               | **Here:** higher-height updates ignored ([#L20](../../../../../../../src/storage/TimeoutStorage.ts#L20)). **Other files:** candidate production and precedence checks — [StateManager](../stateManager/StateManager.ts.md) (`tryTimeoutParticipant`). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation              | Public entry and setup                                       | Oracle and forbidden effects                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-timeout-storage-1-tax9c3"></a>`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3` | Lowest-height retention | Store candidates at varied heights per fork in varied orders | Lowest retained for every order; equal height replaces; forks independent | <a id="unit-test-timeout-storage-1-tax9c3.p1"></a>`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P1` — lower replaces higher; <a id="unit-test-timeout-storage-1-tax9c3.p2"></a>`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P2` — higher ignored; <a id="unit-test-timeout-storage-1-tax9c3.p3"></a>`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P3` — order permutations converge; <a id="unit-test-timeout-storage-1-tax9c3.p4"></a>`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P4` — equal-height replacement; <a id="unit-test-timeout-storage-1-tax9c3.p5"></a>`UNIT-TEST-TIMEOUT-STORAGE-1-TAX9C3.P5` — per-fork isolation |

## Related source reports

- [StateManager](../stateManager/StateManager.ts.md) (producer), [DisputeManager](../disputeManager/DisputeManager.ts.md) (consumer at construction).
