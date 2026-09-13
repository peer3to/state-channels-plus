# ContractExecutorRootUrl.ts — Source Report

> **Source:** [src/rpc/internal/node/ContractExecutorRootUrl.ts](../../../../../../../../src/rpc/internal/node/ContractExecutorRootUrl.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Resolves the fixed internal ContractExecutor root worker entry on node.

## Key design decisions

Built-in worker identity is selected by the SDK, not public setup options. The URL is passed to the common platform worker creator.

## Inputs, outputs, state, and side effects

Node resolves the installed root module path relative to the platform runtime module. Placement remains a separate creation option.

## Linked requirements

| Source file                                                                                            | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [ContractExecutorRootUrl.ts](../../../../../../../../src/rpc/internal/node/ContractExecutorRootUrl.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

Node resolves the installed root module path relative to the platform runtime module. Placement remains a separate creation option.

## Specification adherence

This file contributes its boundary to the linked requirements; the related owners provide the remaining lifecycle and dispatch behavior.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                            | Gap / divergence                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [ContractExecutorRootUrl.ts](../../../../../../../../src/rpc/internal/node/ContractExecutorRootUrl.ts#L1) resolves the fixed internal ContractExecutor root worker entry on node. **Other files:** [createRoot.ts](../createRoot.ts.md); [RootWorkerRuntime.ts](RootWorkerRuntime.ts.md). | None demonstrated for this contribution. |

## Component test obligations

| Unit test ID                                                                            | Obligation                  | Public entry and setup                             | Oracle and forbidden effects                                              | Required permutations                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-node-executor-url-1-59b523"></a>`UNIT-TEST-NODE-EXECUTOR-URL-1-59B523` | Fixed built-in worker entry | Real production roots and their public operations. | Fixed built-in worker entry; no duplicate completion or leaked ownership. | <a id="unit-test-node-executor-url-1-59b523.p1"></a>`UNIT-TEST-NODE-EXECUTOR-URL-1-59B523.P1` — Normal setup resolves the built-in worker without caller URL configuration, awaits initialization and completes its domain operation. |

## Related source reports

[createRoot.ts](../createRoot.ts.md); [RootWorkerRuntime.ts](RootWorkerRuntime.ts.md).
