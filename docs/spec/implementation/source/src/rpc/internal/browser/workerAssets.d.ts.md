# workerAssets.d.ts — Source Report

> **Source:** [src/rpc/internal/browser/workerAssets.d.ts](../../../../../../../../src/rpc/internal/browser/workerAssets.d.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Types bundler-emitted worker asset URL imports.

## Key design decisions

The declaration describes the existing bundler asset convention; it registers no root and performs no runtime work.

## Inputs, outputs, state, and side effects

The source boundary uses the root's explicit dependencies and lifetime. The browser bundler must emit a worker asset for ?worker&url imports. Node compilation excludes this platform directory.

## Linked requirements

| Source file                                                                             | Specification IDs                                                                                   |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [workerAssets.d.ts](../../../../../../../../src/rpc/internal/browser/workerAssets.d.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

The browser bundler must emit a worker asset for ?worker&url imports. Node compilation excludes this platform directory.

## Specification adherence

This file contributes its boundary to the linked requirements; the related owners provide the remaining lifecycle and dispatch behavior.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                    | Gap / divergence                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [workerAssets.d.ts](../../../../../../../../src/rpc/internal/browser/workerAssets.d.ts#L1) types bundler-emitted worker asset URL imports. **Other files:** [ContractExecutorRootUrl.ts](ContractExecutorRootUrl.ts.md); [P2pRuntimeHostRootUrl.ts](P2pRuntimeHostRootUrl.ts.md). | None demonstrated for this contribution. |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

This declaration has no runtime operation. Browser compilation checks its URL export type; the two linked URL reports own the executable worker-loading obligations.

## Related source reports

[ContractExecutorRootUrl.ts](ContractExecutorRootUrl.ts.md); [P2pRuntimeHostRootUrl.ts](P2pRuntimeHostRootUrl.ts.md).
