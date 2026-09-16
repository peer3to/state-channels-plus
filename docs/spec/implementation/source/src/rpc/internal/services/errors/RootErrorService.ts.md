# RootErrorService.ts — Source Report

> **Source:** [src/rpc/internal/services/errors/RootErrorService.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorService.ts#L1) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Provides the common upward error service on every internal root. Receives only child reports; startup failures reject readiness and fatal connection failures settle pending calls.

## Key design decisions

A closed connection preserves its first failure. A worker exit during disposal closes the connection and rejects the pending acknowledgement; it does not emit a second autonomous report. A request rejection is not automatically forwarded as an autonomous error. The top-level root supplies the application sink. Internal test handlers and diagnostic observers select a concrete child connection.

## Inputs, outputs, state, and side effects

Owns weak child handler/observer registrations. Uses the existing lifecycle readiness state and transport close settlement; it creates no request or readiness registry.

## Linked requirements

| Source file                                                                                               | Specification IDs                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RootErrorService.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorService.ts#L1) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

Ownership is per connection. Lifecycle requirements cover initialized return, startup failure settlement and later failure reporting.

## Assumptions, dependencies, trust boundaries, and limits

Internal connections are created by their owners. Startup data and error projections must be cloneable. Built-in browser worker URLs are resolved internally. These endpoints are not composed into the network root.

## Specification adherence

The owner relationships and error path are explicit. Request failures retain their response path; autonomous reports travel upward.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                             | Gap / divergence   |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** [RootErrorService.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorService.ts#L1) provides the boundary described above. **Other files:** [Common creation](../../createRoot.ts.md) registers the exact parent/child connection and retains ownership.                             | None demonstrated. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** [RootErrorService.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorService.ts#L1) provides the startup or failure behavior described above. **Other files:** [Common creation](../../createRoot.ts.md) awaits the lifecycle readiness promise and cleans up unsuccessful creation. | None demonstrated. |

## Component test obligations

| Unit test ID                                                              | Obligation         | Public entry and setup                              | Oracle and forbidden effects                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------ | --------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-root-error-1-0n4xm4"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4` | Root error routing | Actual SDK-owned roots and their real service ports | Exactly one upward report, no duplicate request report, valid later traffic | <a id="unit-test-root-error-1-0n4xm4.p1"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P1` — An inline SDK forwards one child report to the application and both roots keep serving.<br><a id="unit-test-root-error-1-0n4xm4.p2"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P2` — A worker SDK forwards one child report to the application and both roots keep serving.<br><a id="unit-test-root-error-1-0n4xm4.p3"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P3` — An inline child request rejection reaches only its awaiting caller.<br><a id="unit-test-root-error-1-0n4xm4.p4"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P4` — A worker child request rejection reaches only its awaiting caller.<br><a id="unit-test-root-error-1-0n4xm4.p5"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P5` — A parent-origin error report is rejected and the connection remains usable.<br><a id="unit-test-root-error-1-0n4xm4.p6"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P6` — A real worker exits during disposal; the request rejects, repeated disposal retains failure and the parent still serves.; <a id="unit-test-root-error-1-0n4xm4.p7"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P7` — A ready SDK worker exits unexpectedly with pending work; callers reject, the public error listener receives one original cause and client cleanup completes.; <a id="unit-test-root-error-1-0n4xm4.p8"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P8` — An error before readiness rejects the retained wait, closes the child and does not report a ready-host fatal error.; <a id="unit-test-root-error-1-0n4xm4.p9"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P9` — The startupFailed wire endpoint rejects readiness with the original error and closes the child.; <a id="unit-test-root-error-1-0n4xm4.p10"></a>`UNIT-TEST-ROOT-ERROR-1-0N4XM4.P10` — A fire-and-forget endpoint rejection produces one public report and the root remains usable. |

## Related source reports

[Common creation](../../createRoot.ts.md) owns startup coordination.
