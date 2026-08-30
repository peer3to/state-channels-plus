# DeferredAdmissionGuard.ts — Source Report

> **Source:** [src/rpc/guards/DeferredAdmissionGuard.ts](../../../../../../../src/rpc/guards/DeferredAdmissionGuard.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

This guard owns deferred RPC admission once for every policy that needs it. It keeps one FIFO queue and one readiness waiter per transport, suppresses the premature failure response for queued requests, and replays through the owning service only after the policy becomes ready. The fixed deadline is two agreement windows. Exact transport close, final profile loss, expiry, or owner disposal clears the queue before policy failure handling runs.

The policy owns only readiness, deferral eligibility, the readiness wait, and rejection or expiry consequences. The guard does not know about handshakes, lobbies, or negotiation transcripts.

## Design and limits

- Queues are isolated by exact transport and replay in arrival order.
- A ready request passes without queueing. An ineligible request is rejected immediately.
- One failed queued item causes one expiry consequence after the queue is cleared.
- The queue has no item cap in this pass. [`OQ-SPEC-LOBBY-1-D65YTT`](../../../../../specification/open-questions.md#oq-spec-lobby-1-d65ytt) owns that hardening decision.

## Linked requirements

| Source file                                                                                | Specification IDs                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DeferredAdmissionGuard.ts](../../../../../../../src/rpc/guards/DeferredAdmissionGuard.ts) | [`REQ-LOBBY-7-BXQ1QA`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-7-bxq1qa), [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) |

## Conformance traceability

| Requirement                                                                                                  | Implementation status | Evidence                                                                                      | Gap / divergence                                               |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`REQ-LOBBY-7-BXQ1QA`](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-7-bxq1qa) | Covered               | Exact-transport FIFO admission, one waiter, two-window deadline, cleanup, and service replay. | Queue-size hardening remains the separate open question above. |
| [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)                | Covered               | The handshake adapter uses this shared queue and no longer sends a premature request error.   | None for deferred admission.                                   |

## Component test obligations

| Unit test ID                                                                              | Obligation                | Public entry and setup                                             | Oracle and forbidden effects                                                                                                   | Required permutations                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-deferred-admission-1-12gvz7"></a>`UNIT-TEST-DEFERRED-ADMISSION-1-12GVZ7` | Shared deferred admission | Run the guard through a real RPC service with a controlled policy. | Ready work runs immediately; eligible work replays once in FIFO order; ineligible and expired work take separate policy paths. | <a id="unit-test-deferred-admission-1-12gvz7.p1"></a>`UNIT-TEST-DEFERRED-ADMISSION-1-12GVZ7.P1` — immediate pass, one waiter, FIFO replay, immediate rejection, and expiry. |

## Related source reports

- [HandshakeCompletedGuard.ts](./HandshakeCompletedGuard.ts.md)
- [OpenChannelNegotiationService.ts](../services/openChannelNegotiation/OpenChannelNegotiationService.ts.md)
