# P2pRuntimeHostRootUrl.ts — Source Report

> **Source:** [src/rpc/internal/browser/P2pRuntimeHostRootUrl.ts](../../../../../../../../src/rpc/internal/browser/P2pRuntimeHostRootUrl.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Resolves the fixed internal P2pRuntimeHost root worker entry on browser.

## Key design decisions

Built-in worker identity is selected by the SDK, not public setup options. The URL is passed to the common platform worker creator.

## Inputs, outputs, state, and side effects

Browser resolution uses a static `?worker&url` asset import. Placement remains a separate creation option.

## Linked requirements

| Source file                                                                                           | Specification IDs                                                                                   |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [P2pRuntimeHostRootUrl.ts](../../../../../../../../src/rpc/internal/browser/P2pRuntimeHostRootUrl.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

Browser resolution uses a static `?worker&url` asset import. Placement remains a separate creation option.

## Specification adherence

This file contributes its boundary to the linked requirements; the related owners provide the remaining lifecycle and dispatch behavior.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                            | Gap / divergence                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [P2pRuntimeHostRootUrl.ts](../../../../../../../../src/rpc/internal/browser/P2pRuntimeHostRootUrl.ts#L1) resolves the fixed internal P2pRuntimeHost root worker entry on browser. **Other files:** [createRoot.ts](../createRoot.ts.md); [RootWorkerRuntime.ts](RootWorkerRuntime.ts.md). | None demonstrated for this contribution. |

## Component test obligations

| Unit test ID                                                                          | Obligation                  | Public entry and setup                             | Oracle and forbidden effects                                              | Required permutations                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-browser-host-url-1-sd21t9"></a>`UNIT-TEST-BROWSER-HOST-URL-1-SD21T9` | Fixed built-in worker entry | Real production roots and their public operations. | Fixed built-in worker entry; no duplicate completion or leaked ownership. | <a id="unit-test-browser-host-url-1-sd21t9.p1"></a>`UNIT-TEST-BROWSER-HOST-URL-1-SD21T9.P1` — Normal setup resolves the built-in worker without caller URL configuration, awaits initialization and completes its domain operation. |

## Related source reports

[createRoot.ts](../createRoot.ts.md); [RootWorkerRuntime.ts](RootWorkerRuntime.ts.md).
