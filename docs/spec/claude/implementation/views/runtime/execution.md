# Runtime Isolation and Concurrency — Implementation

> **Specification subject:** [specification/runtime/execution.md](../../../specification/runtime/execution.md)

> **Agent authoring status:** Current implementation architecture assembled; source-level consolidation requires engineer verification.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
- [Assumptions and constraints](#assumptions-and-constraints)
- [System design](#system-design)
- [System integration test plan](#system-integration-test-plan)
- [Source inventory](#source-inventory)
- [Conformance traceability](#conformance-traceability)

## Implementation overview

**Status:** Partial; the detailed implementation reports exist, but their source inventories and unit plans still require consolidation into this subject.

### Specification adherence

The documented architecture is intended to implement [the neutral subject](../../../specification/runtime/execution.md). Existing design reports cover the major mechanisms and failure paths.

### Specification contradiction

No additional contradiction is asserted here. Contradictions demonstrated in the detailed reports or conformance audit remain binding findings.

### Missing

The source-by-source inventory and unit plans are not yet consolidated here. **Required resolution:** audit the linked reports against every `INV-RUNTIME-1`, `REQ-RUNTIME-1`, `REQ-RUNTIME-2`, `REQ-RUNTIME-3`, `REQ-RUNTIME-4` obligation, move their exact source ownership and unit permutations into this subject, and remove duplicated claims.

## Assumptions and constraints

The implementation depends on the concrete platform, transport, storage, chain, and runtime assumptions recorded in the detailed reports. Those assumptions may narrow deployment support but may not weaken the neutral requirements.

## System design

The following concrete reports explain the current design:

- [architecture/sdk/runtime-and-concurrency.md](../architecture/sdk/runtime-and-concurrency.md)

They are implementation evidence under this subject, not independent specifications.

## System integration test plan

| Integration test ID                                                 | Specification IDs                                                                   | Specification test IDs                    | Setup and stimulus                                                                           | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="integration-test-runtime-1"></a>`INTEGRATION-TEST-RUNTIME-1` | `INV-RUNTIME-1`, `REQ-RUNTIME-1`, `REQ-RUNTIME-2`, `REQ-RUNTIME-3`, `REQ-RUNTIME-4` | All applicable specification permutations | Exercise the complete concrete subsystem through each documented entry and failure boundary. | The subsystem preserves the neutral behavior and contains failure without partial state. | <a id="integration-test-runtime-1.p1"></a>`INTEGRATION-TEST-RUNTIME-1.P1` — success; <a id="integration-test-runtime-1.p2"></a>`INTEGRATION-TEST-RUNTIME-1.P2` — validation rejection; <a id="integration-test-runtime-1.p3"></a>`INTEGRATION-TEST-RUNTIME-1.P3` — concurrency; <a id="integration-test-runtime-1.p4"></a>`INTEGRATION-TEST-RUNTIME-1.P4` — operational failure; <a id="integration-test-runtime-1.p5"></a>`INTEGRATION-TEST-RUNTIME-1.P5` — retry; <a id="integration-test-runtime-1.p6"></a>`INTEGRATION-TEST-RUNTIME-1.P6` — restart; <a id="integration-test-runtime-1.p7"></a>`INTEGRATION-TEST-RUNTIME-1.P7` — boundary integration. |

## Source inventory

The detailed reports above currently own the source analysis. This table remains empty until those claims are consolidated and audited; generated source coverage continues to expose missing or duplicate ownership.

| Source file | Specification IDs |
| ----------- | ----------------- |

## Conformance traceability

| Requirement / invariant | Implementation status | Implementation evidence              | Gap / divergence |
| ----------------------- | --------------------- | ------------------------------------ | ---------------- |
| `INV-RUNTIME-1`         | Covered               | Detailed reports under System design | None.            |
| `REQ-RUNTIME-1`         | Covered               | Detailed reports under System design | None.            |
| `REQ-RUNTIME-2`         | Covered               | Detailed reports under System design | None.            |
| `REQ-RUNTIME-3`         | Covered               | Detailed reports under System design | None.            |
| `REQ-RUNTIME-4`         | Covered               | Detailed reports under System design | None.            |
