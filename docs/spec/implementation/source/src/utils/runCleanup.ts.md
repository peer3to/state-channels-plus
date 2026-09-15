# runCleanup.ts — Source Report

> **Source:** [src/utils/runCleanup.ts](../../../../../../src/utils/runCleanup.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime execution](../../../views/runtime/execution.md)

## Responsibility and observable boundary

Attempt every supplied cleanup step in order and report the first failure after all steps finish. The synchronous variant returns or throws before returning control to its caller; the asynchronous variant awaits each step.

## Key design decisions

- Keep synchronous disposal synchronous through `runCleanupSync`; `runCleanup` handles promise-returning cleanup.
- Store only the first failure. A separate boolean preserves thrown `undefined` and other non-Error values.
- Callers retain lifecycle admission, idempotency and any intentional suppression of already-reported failures. The helper does not retry, cache calls or log errors.

## Inputs, outputs, state, and side effects

Inputs are cleanup callbacks. Outputs are void or Promise<void>. Each invocation tracks its first failure locally. Every callback is attempted exactly once, including callbacks after a failure. Async callbacks run sequentially; callers that need concurrent work explicitly join it inside a step.

## Linked requirements

| Source file                                                | Specification IDs                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [runCleanup.ts](../../../../../../src/utils/runCleanup.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

This utility contributes failure-isolated cleanup to the runtime disposal contract. Root owners retain responsibility for admission, child ordering, acknowledgement and platform shutdown.

## Assumptions, dependencies, trust boundaries, and limits

Callbacks are trusted local cleanup operations. The synchronous variant accepts synchronous steps only. A never-settling asynchronous callback prevents subsequent steps; no timeout or cancellation is added. Idempotency remains the caller's responsibility.

## Specification adherence

The helper supports existing owner-level cleanup guarantees without introducing a protocol or wire change.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Specification ID                                                                              | Status  | Evidence                                                                                                                                                                                                                                                                                                                                                   | Gap |
| --------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered | **Here:** [ordered cleanup](../../../../../../src/utils/runCleanup.ts#L2) and first-failure preservation. **Other files:** [AInternalRpcRoot](../rpc/internal/AInternalRpcRoot.ts.md) orders owned cleanup; [RuntimeLifecycleService](../rpc/internal/services/lifecycle/RuntimeLifecycleService.ts.md) coordinates acknowledgement and platform shutdown. | —   |

## Component test obligations

| Unit test ID                                                        | Behavior                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-cleanup-1-14nfgw"></a>`UNIT-TEST-CLEANUP-1-14NFGW` | Ordered cleanup and failure preservation | <a id="unit-test-cleanup-1-14nfgw.p1"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P1` — Empty sync and async sequences complete without error.; <a id="unit-test-cleanup-1-14nfgw.p2"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P2` — Synchronous steps execute in order before return.; <a id="unit-test-cleanup-1-14nfgw.p3"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P3` — Synchronous failures do not skip later steps; the original first error is thrown.; <a id="unit-test-cleanup-1-14nfgw.p4"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P4` — An async step settles before the next step begins.; <a id="unit-test-cleanup-1-14nfgw.p5"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P5` — A synchronous throw followed by a rejection still runs final cleanup and rejects with the original error.; <a id="unit-test-cleanup-1-14nfgw.p6"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P6` — An async rejection remains the first failure when a later step throws synchronously.; <a id="unit-test-cleanup-1-14nfgw.p7"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P7` — A synchronous throw of undefined remains a failure, not a success sentinel.; <a id="unit-test-cleanup-1-14nfgw.p8"></a>`UNIT-TEST-CLEANUP-1-14NFGW.P8` — An async rejection with undefined remains a failure, not a success sentinel. |

## Related source reports

- [ProfileManager](../ProfileManager.ts.md) uses synchronous cleanup.
- [P2PManager](../P2PManager.ts.md) uses asynchronous cleanup.
- [AInternalRpcRoot](../rpc/internal/AInternalRpcRoot.ts.md) retains concurrent child disposal inside its ordered cleanup.
