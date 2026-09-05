# SnapshotAssemblyService.ts — Source Report

> **Source:** [src/stateManager/block/SnapshotAssemblyService.ts](../../../../../../../src/stateManager/block/SnapshotAssemblyService.ts) > **Status:** Authored — engineer verification pending.
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

Assembles the next state snapshot for a transaction: carries the previous snapshot forward, binds consumed inbound blocks (hash, height, deposits), builds the outbound block for a leave (height, withdrawals, `participantChanges`), and reports the writer-turn and state-machine refusals as `success: false` or a throw.

## Key design decisions

1. **One assembly owner.** Block production and snapshot posting build every snapshot here; the writer-turn rule and state-machine refusal are reported, never patched around.

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

| Source file                                                                                          | Specification IDs |
| ---------------------------------------------------------------------------------------------------- | ----------------- |
| [SnapshotAssemblyService.ts](../../../../../../../src/stateManager/block/SnapshotAssemblyService.ts) |                   |

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

| Unit test ID                                                                            | Obligation        | Public entry and setup                                                                                                                                       | Oracle and forbidden effects                                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-snapshot-assembly-1-4g64j7"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7` | Snapshot assembly | Drive `createStateSnapshot`, `getPreviousStateSnapshotOrThrow`, and `assembleFromTransaction` host-side on live channels with real storage and state machine | Decoded snapshot fields, heights, hashes, and participant changes match the consumed blocks; refusals are reported, never hidden | <a id="unit-test-snapshot-assembly-1-4g64j7.p1"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P1` — carry-forward with no inbound or outbound block; <a id="unit-test-snapshot-assembly-1-4g64j7.p2"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P2` — a real leave advances the outbound height and total withdrawals; <a id="unit-test-snapshot-assembly-1-4g64j7.p3"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P3` — a real join binds the consumed inbound hash, height, and total deposits; <a id="unit-test-snapshot-assembly-1-4g64j7.p4"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P4` — an unknown fork throws instead of assembling; <a id="unit-test-snapshot-assembly-1-4g64j7.p5"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P5` — the writer's real transaction yields the next-height snapshot binding the post-inbound state with no participant changes; <a id="unit-test-snapshot-assembly-1-4g64j7.p6"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P6` — own turn succeeds with a new state hash and another peer's header returns `success: false`; <a id="unit-test-snapshot-assembly-1-4g64j7.p7"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P7` — a transaction the state machine refuses returns `success: false` with nothing else computed; <a id="unit-test-snapshot-assembly-1-4g64j7.p8"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P8` — supplied pending inbound blocks are bound by head and deposits; <a id="unit-test-snapshot-assembly-1-4g64j7.p9"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P9` — a leave names the leaver in `participantChanges.left` and builds an outbound block; <a id="unit-test-snapshot-assembly-1-4g64j7.p10"></a>`UNIT-TEST-SNAPSHOT-ASSEMBLY-1-4G64J7.P10` — an inbound block the state machine cannot process makes the assembly throw |

## Related source reports

- Consumers per the views.
