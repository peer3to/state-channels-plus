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

The source-by-source inventory and unit plans are not yet consolidated here. **Required resolution:** audit the linked reports against every [`INV-RUNTIME-1-AKRHAK`](../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-1-RSM6MZ`](../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y) obligation, move their exact source ownership and unit permutations into this subject, and remove duplicated claims.

## Assumptions and constraints

The implementation depends on the concrete platform, transport, storage, chain, and runtime assumptions recorded in the detailed reports. Those assumptions may narrow deployment support but may not weaken the neutral requirements.

## System design

The following concrete reports explain the current design:

- [architecture/sdk/runtime-and-concurrency.md](../architecture/sdk/runtime-and-concurrency.md)

They are implementation evidence under this subject, not independent specifications.

## System integration test plan

| Integration test ID                                                               | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Specification test IDs                    | Setup and stimulus                                                                           | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="integration-test-runtime-1-g147dn"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN` | [`INV-RUNTIME-1-AKRHAK`](../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-1-RSM6MZ`](../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | All applicable specification permutations | Exercise the complete concrete subsystem through each documented entry and failure boundary. | The subsystem preserves the neutral behavior and contains failure without partial state. | <a id="integration-test-runtime-1-g147dn.p1"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN.P1` — success; <a id="integration-test-runtime-1-g147dn.p2"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN.P2` — validation rejection; <a id="integration-test-runtime-1-g147dn.p3"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN.P3` — concurrency; <a id="integration-test-runtime-1-g147dn.p4"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN.P4` — operational failure; <a id="integration-test-runtime-1-g147dn.p5"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN.P5` — retry; <a id="integration-test-runtime-1-g147dn.p6"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN.P6` — restart; <a id="integration-test-runtime-1-g147dn.p7"></a>`INTEGRATION-TEST-RUNTIME-1-G147DN.P7` — boundary integration. |

## Source inventory

The detailed source reports own file-level behavior. These entries record the runtime files changed
for constructor-independent extension boundaries; they do not replace those reports.

| Source file                                                                     | Specification IDs                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/events/EventBus.ts](../../../../../src/events/EventBus.ts)                 | [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)                                                                                             |
| [src/P2PManager.ts](../../../../../src/P2PManager.ts)                           | [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)                                                                                             |
| [src/rpc/RemoteRpcProxy.ts](../../../../../src/rpc/RemoteRpcProxy.ts)           | [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)                                                                                             |
| [src/rpc/RpcHandler.ts](../../../../../src/rpc/RpcHandler.ts)                   | [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)                                                                                             |
| [src/transport/ATransport.ts](../../../../../src/transport/ATransport.ts)       | [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)                                                                                             |
| [src/utils/Codec.ts](../../../../../src/utils/Codec.ts)                         | [`REQ-RUNTIME-1-RSM6MZ`](../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |
| [src/utils/EthersResultProxy.ts](../../../../../src/utils/EthersResultProxy.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |
| [src/utils/ObjectChecks.ts](../../../../../src/utils/ObjectChecks.ts)           | [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)                                                                                             |

## Conformance traceability

| Requirement / invariant                                                                    | Implementation status | Implementation evidence              | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------ | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | Detailed reports under System design | None.            |
| [`REQ-RUNTIME-4-B0N70Y`](../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | Detailed reports under System design | None.            |
