# Dispute Intake, Verification, and Reduction Pipeline — Implementation

> **Specification subject:** [specification/disputes/dispute-processing.md](../../../specification/disputes/dispute-processing.md)

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

The documented architecture is intended to implement [the neutral subject](../../../specification/disputes/dispute-processing.md). Existing design reports cover the major mechanisms and failure paths.

### Specification contradiction

No additional contradiction is asserted here. Contradictions demonstrated in the detailed reports or conformance audit remain binding findings.

### Missing

The source-by-source inventory and unit plans are not yet consolidated here. **Required resolution:** audit the linked reports against every `INV-DISPUTE-PIPE-1`, `REQ-DISPUTE-PIPE-1`, `REQ-DISPUTE-PIPE-2`, `REQ-DISPUTE-PIPE-3`, `REQ-DISPUTE-PIPE-4` obligation, move their exact source ownership and unit permutations into this subject, and remove duplicated claims.

## Assumptions and constraints

The implementation depends on the concrete platform, transport, storage, chain, and runtime assumptions recorded in the detailed reports. Those assumptions may narrow deployment support but may not weaken the neutral requirements.

## System design

The following concrete reports explain the current design:

- [architecture/sdk/dispute-pipeline.md](../architecture/sdk/dispute-pipeline.md)

They are implementation evidence under this subject, not independent specifications.

## System integration test plan

| Integration test ID                                                           | Specification IDs                                                                                            | Specification test IDs                    | Setup and stimulus                                                                           | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="integration-test-dispute-pipe-1"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1` | `INV-DISPUTE-PIPE-1`, `REQ-DISPUTE-PIPE-1`, `REQ-DISPUTE-PIPE-2`, `REQ-DISPUTE-PIPE-3`, `REQ-DISPUTE-PIPE-4` | All applicable specification permutations | Exercise the complete concrete subsystem through each documented entry and failure boundary. | The subsystem preserves the neutral behavior and contains failure without partial state. | <a id="integration-test-dispute-pipe-1.p1"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1.P1` — success; <a id="integration-test-dispute-pipe-1.p2"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1.P2` — validation/failure/retry; <a id="integration-test-dispute-pipe-1.p3"></a>`INTEGRATION-TEST-DISPUTE-PIPE-1.P3` — concurrency, restart, and boundary integration. |

## Source inventory

The detailed reports above currently own the source analysis. This table remains empty until those claims are consolidated and audited; generated source coverage continues to expose missing or duplicate ownership.

| Source file | Specification IDs |
| ----------- | ----------------- |

## Conformance traceability

| Requirement / invariant | Implementation status  | Implementation evidence              | Gap / divergence                                                                      |
| ----------------------- | ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| `INV-DISPUTE-PIPE-1`    | Claimed; audit pending | Detailed reports under System design | Source-level conformance and unit evidence require consolidation and engineer review. |
| `REQ-DISPUTE-PIPE-1`    | Claimed; audit pending | Detailed reports under System design | Source-level conformance and unit evidence require consolidation and engineer review. |
| `REQ-DISPUTE-PIPE-2`    | Claimed; audit pending | Detailed reports under System design | Source-level conformance and unit evidence require consolidation and engineer review. |
| `REQ-DISPUTE-PIPE-3`    | Claimed; audit pending | Detailed reports under System design | Source-level conformance and unit evidence require consolidation and engineer review. |
| `REQ-DISPUTE-PIPE-4`    | Claimed; audit pending | Detailed reports under System design | Source-level conformance and unit evidence require consolidation and engineer review. |
