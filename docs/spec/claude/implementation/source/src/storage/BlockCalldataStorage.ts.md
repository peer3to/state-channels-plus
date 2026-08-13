# BlockCalldataStorage.ts — Source Report

> **Source:** [src/storage/BlockCalldataStorage.ts](../../../../../../../src/storage/BlockCalldataStorage.ts) > **Status:** Authored — engineer verification pending.
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

Observed on-chain block-calldata records keyed by (fork, height, author), with exact-hash
matching against a queried block.

## Key design decisions

1. **Match means hash equality.** `getMatchingBlockCalldata` returns a record only when the
   stored signed block hashes to the queried block's hash ([#L52](../../../../../../../src/storage/BlockCalldataStorage.ts#L52)) — same coordinates with different content is a divergence for the consumer to judge, never a match.
2. **Overwrite-safe by chain rules.** The manager contract forbids re-posting a slot, so a
   repeated observation carries identical content; the map overwrite is a replay no-op.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                |
| ------------ | ------------------------------------------------------- |
| Inputs       | Calldata records (signed block + on-chain timestamp).   |
| Outputs      | Record by coordinates; hash-matched record for a block. |
| Owned state  | `coordinatesToBlockMap` keyed `fork:height:author`.     |
| Side effects | None.                                                   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                         | Specification IDs                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [BlockCalldataStorage.ts](../../../../../../../src/storage/BlockCalldataStorage.ts) | [`REQ-CDSTORE-1`](../../../../specification/storage/calldata-and-timeouts.md#req-cdstore-1) |

## Assumptions, dependencies, trust boundaries, and limits

- Records come from chain observation; their protocol meaning (windows, slashability) is judged by the dispute path.
- In-memory medium for this protocol version: durability across restart is not yet provided; the
  target contract is [durability.md](../../../../specification/storage/durability.md).

## Specification adherence

- Coordinate keying and exact-hash matching ([`REQ-CDSTORE-1`](../../../../specification/storage/calldata-and-timeouts.md#req-cdstore-1)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                     | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                | Gap / divergence |
| ------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-CDSTORE-1`](../../../../specification/storage/calldata-and-timeouts.md#req-cdstore-1) | Covered               | **Here:** `fork:height:author` keying; hash-equality match ([#L52](../../../../../../../src/storage/BlockCalldataStorage.ts#L52)). **Other files:** posting rules on-chain — [admission of the commitment](../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md); consumers — [StateManager](../stateManager/StateManager.ts.md) timeout checks. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation          | Public entry and setup                                                               | Oracle and forbidden effects                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-calldata-storage-1"></a>`UNIT-TEST-BLOCK-CALLDATA-STORAGE-1` | Keying and matching | Store records; query by coordinates and by matching blocks with equal/unequal hashes | Coordinate reads exact; match only on hash equality; absent coordinates explicit | <a id="unit-test-block-calldata-storage-1.p1"></a>`UNIT-TEST-BLOCK-CALLDATA-STORAGE-1.P1` — store/read by coordinates; <a id="unit-test-block-calldata-storage-1.p2"></a>`UNIT-TEST-BLOCK-CALLDATA-STORAGE-1.P2` — match equal hash; <a id="unit-test-block-calldata-storage-1.p3"></a>`UNIT-TEST-BLOCK-CALLDATA-STORAGE-1.P3` — same coordinates different hash → no match; <a id="unit-test-block-calldata-storage-1.p4"></a>`UNIT-TEST-BLOCK-CALLDATA-STORAGE-1.P4` — absent coordinates |

## Related source reports

- [EventHandler](../eventHandlers/EventHandler.ts.md) (writer on posted-calldata events), [StateManager](../stateManager/StateManager.ts.md) (timeout race checks).
