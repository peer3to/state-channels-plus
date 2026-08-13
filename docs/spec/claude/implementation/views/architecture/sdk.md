# Participant SDK and Service Architecture — Implementation

> **Specification subject:** [specification/runtime/sdk.md](../../../specification/runtime/sdk.md)

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

The documented architecture is intended to implement [the neutral subject](../../../specification/runtime/sdk.md). Existing design reports cover the major mechanisms and failure paths.

### Specification contradiction

No additional contradiction is asserted here. Contradictions demonstrated in the detailed reports or conformance audit remain binding findings.

### Missing

The source-by-source inventory and unit plans are not yet consolidated here. **Required resolution:** audit the linked reports against every [`INV-SDK-ARCH-1-KNAX7F`](../../../specification/runtime/sdk.md#inv-sdk-arch-1-knax7f), [`REQ-SDK-ARCH-1-7H14H6`](../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6), [`REQ-SDK-ARCH-2-QBZAT8`](../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8), [`REQ-SDK-ARCH-3-WHTDWX`](../../../specification/runtime/sdk.md#req-sdk-arch-3-whtdwx), [`REQ-SDK-ARCH-4-GTN7QN`](../../../specification/runtime/sdk.md#req-sdk-arch-4-gtn7qn) obligation, move their exact source ownership and unit permutations into this subject, and remove duplicated claims.

## Assumptions and constraints

The implementation depends on the concrete platform, transport, storage, chain, and runtime assumptions recorded in the detailed reports. Those assumptions may narrow deployment support but may not weaken the neutral requirements.

## System design

The following concrete reports explain the current design:

- [architecture/sdk/architecture.md](./sdk/architecture.md)
- [architecture/sdk/components.md](./sdk/components.md)

They are implementation evidence under this subject, not independent specifications.

## System integration test plan

| Integration test ID                                                                 | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                      | Specification test IDs                    | Setup and stimulus                                                                           | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="integration-test-sdk-arch-1-98pfbk"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK` | [`INV-SDK-ARCH-1-KNAX7F`](../../../specification/runtime/sdk.md#inv-sdk-arch-1-knax7f), [`REQ-SDK-ARCH-1-7H14H6`](../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6), [`REQ-SDK-ARCH-2-QBZAT8`](../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8), [`REQ-SDK-ARCH-3-WHTDWX`](../../../specification/runtime/sdk.md#req-sdk-arch-3-whtdwx), [`REQ-SDK-ARCH-4-GTN7QN`](../../../specification/runtime/sdk.md#req-sdk-arch-4-gtn7qn) | All applicable specification permutations | Exercise the complete concrete subsystem through each documented entry and failure boundary. | The subsystem preserves the neutral behavior and contains failure without partial state. | <a id="integration-test-sdk-arch-1-98pfbk.p1"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK.P1` — success; <a id="integration-test-sdk-arch-1-98pfbk.p2"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK.P2` — validation rejection; <a id="integration-test-sdk-arch-1-98pfbk.p3"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK.P3` — concurrency; <a id="integration-test-sdk-arch-1-98pfbk.p4"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK.P4` — failure path; <a id="integration-test-sdk-arch-1-98pfbk.p5"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK.P5` — retry; <a id="integration-test-sdk-arch-1-98pfbk.p6"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK.P6` — restart; <a id="integration-test-sdk-arch-1-98pfbk.p7"></a>`INTEGRATION-TEST-SDK-ARCH-1-98PFBK.P7` — boundary integration. |

## Source inventory

The detailed reports above currently own the source analysis. This table remains empty until those claims are consolidated and audited; generated source coverage continues to expose missing or duplicate ownership.

| Source file | Specification IDs |
| ----------- | ----------------- |

## Conformance traceability

| Requirement / invariant                                                                | Implementation status | Implementation evidence              | Gap / divergence |
| -------------------------------------------------------------------------------------- | --------------------- | ------------------------------------ | ---------------- |
| [`INV-SDK-ARCH-1-KNAX7F`](../../../specification/runtime/sdk.md#inv-sdk-arch-1-knax7f) | Covered               | Detailed reports under System design | None.            |
| [`REQ-SDK-ARCH-1-7H14H6`](../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6) | Covered               | Detailed reports under System design | None.            |
| [`REQ-SDK-ARCH-2-QBZAT8`](../../../specification/runtime/sdk.md#req-sdk-arch-2-qbzat8) | Covered               | Detailed reports under System design | None.            |
| [`REQ-SDK-ARCH-3-WHTDWX`](../../../specification/runtime/sdk.md#req-sdk-arch-3-whtdwx) | Covered               | Detailed reports under System design | None.            |
| [`REQ-SDK-ARCH-4-GTN7QN`](../../../specification/runtime/sdk.md#req-sdk-arch-4-gtn7qn) | Covered               | Detailed reports under System design | None.            |
