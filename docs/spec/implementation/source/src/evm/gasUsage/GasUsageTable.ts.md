# GasUsageTable.ts — Source Report

> **Source:** [src/evm/gasUsage/GasUsageTable.ts](../../../../../../../src/evm/gasUsage/GasUsageTable.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

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

Aggregates finished receipts into one row per (contract address, function) and answers a snapshot
of those rows. Its whole surface is `record(entry)` and `snapshot()`.

## Key design decisions

1. **Pure, so the arithmetic is testable without a chain.** The table has no timers, no chain
   access and no logging; the waiting belongs to [GasUsageRecorder.ts](./GasUsageRecorder.ts.md).
2. **A reverted transaction is a mined transaction.** It counts in `minedCount` and in the
   total/min/max because it burned that gas, and `revertedCount` says how many of the mined ones
   reverted, so one denominator describes the whole row.
3. **Gas leaves as decimal strings.** The accumulators are `bigint`, and the snapshot stringifies
   them, so a row survives `JSON.stringify` across the runtime port and into a log line without a
   `BigInt.prototype.toJSON` shim and without losing precision.
4. **Rows are ordered by code units, not by locale**, so two hosts produce the same snapshot.
5. **The key is (contract address, selector), not the function name**, so the same selector on two
   contracts stays two rows.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| Inputs       | `GasUsageEntry`: contract address, selector, function name, gas used, reverted. |
| Outputs      | `GasUsageRow[]`, deterministically ordered and JSON-safe.                       |
| Owned state  | One `GasUsageAggregate` per key, in memory for the life of the owner.           |
| Side effects | None.                                                                           |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                      | Specification IDs                                                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [GasUsageTable.ts](../../../../../../../src/evm/gasUsage/GasUsageTable.ts) | [`REQ-SDK-ARCH-5-NSJYQT`](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt) — owns the aggregation and the ordering of the exposed table. |

## Assumptions, dependencies, trust boundaries, and limits

- Callers hand over receipts that already settled; the table never decides whether a transaction mined.
- Memory grows with the number of distinct (contract, function) pairs a peer calls, not with the
  number of transactions.

## Specification adherence

- Aggregation, reverted counting, and deterministic ordering per [`REQ-SDK-ARCH-5-NSJYQT` (Chain spending is observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt).

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
| [`REQ-SDK-ARCH-5-NSJYQT`](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt) | Partial | **Here:** counting, totals, bounds, reverted counting, and snapshot ordering in [record/snapshot](../../../../../../../src/evm/gasUsage/GasUsageTable.ts#L57). **Other files:** [GasUsageRecorder.ts](./GasUsageRecorder.ts.md) decides what mined, [HostNonceManager.ts](../signer/HostNonceManager.ts.md) is the single producer, [P2pRuntimeHostRoot.ts](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md) reports it on disposal, and [P2pInstance.ts](../P2pInstance.ts.md) exposes it. | This file never observes a chain, so it cannot establish that only mined transactions reach it. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |
| <a id="unit-test-gas-usage-table-1-jx3hrb"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB` | Aggregate recorded receipts into deterministic rows. | A fresh `GasUsageTable`; `record` called with hand-chosen entries; `snapshot()` read. | Hand-computed counts, totals, and bounds; the snapshot must stay JSON-safe and must not depend on the host locale. | <a id="unit-test-gas-usage-table-1-jx3hrb.p1"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P1` — empty table; <a id="unit-test-gas-usage-table-1-jx3hrb.p2"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P2` — one entry; <a id="unit-test-gas-usage-table-1-jx3hrb.p3"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P3` — repeated entries for one key; <a id="unit-test-gas-usage-table-1-jx3hrb.p4"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P4` — reverted entry; <a id="unit-test-gas-usage-table-1-jx3hrb.p5"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P5` — one selector on two contracts; <a id="unit-test-gas-usage-table-1-jx3hrb.p6"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P6` — row ordering; <a id="unit-test-gas-usage-table-1-jx3hrb.p7"></a>`UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P7` — total beyond the safe integer range. |

## Related source reports

- [GasUsageRecorder.ts](./GasUsageRecorder.ts.md), [HostNonceManager.ts](../signer/HostNonceManager.ts.md).
