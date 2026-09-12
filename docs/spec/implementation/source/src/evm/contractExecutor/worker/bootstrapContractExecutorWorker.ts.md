# bootstrapContractExecutorWorker.ts — Source Report

> **Source:** [src/evm/contractExecutor/worker/bootstrapContractExecutorWorker.ts](../../../../../../../../src/evm/contractExecutor/worker/bootstrapContractExecutorWorker.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The whole vm worker, for both platforms: an `RpcRouter` serving `ContractExecutorRoot` over the
scope that spawned this worker, a typed endpoint back to the owner's root, and the funnel that
reports an error caught outside a request. The worker keeps serving; the report crosses and every
realm is asked to upload.

## Key design decisions

- **One bootstrap, two entries.** The node and browser entries differ only in the platform funnel
  they hand in, so the router, the transport, the report and the flush round live here once; a
  behaviour added to one platform can no longer go missing on the other.
- **The scripted test worker runs this same function**, handing in its own executor options and
  its own port, so a fixture can script the monitor without re-implementing the bootstrap.
- **Shared, so browser-compiled.** Nothing here reaches a `node:` module: the worker's own scope
  arrives through the `@platform/p2pRuntimeChannel` alias and the error funnel is a parameter.
- **The flush round is deferred by a macrotask**, because the logger's own hook records the failure
  in a later listener and a round collected before it ran would ship an empty report. Nothing waits
  on the acks: the thread stays alive and keeps answering calls.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                               |
| ------------ | ---------------------------------------------------------------------- |
| Inputs       | The platform's funnel, the executor options, and the worker's port.    |
| Outputs      | None; the line and the funnel are installed as side effects.           |
| Owned state  | The router and the transport for this worker's lifetime.               |
| Side effects | Opens the parent line; reports detached errors; asks realms to upload. |

## Linked requirements

| Source file                                                                                                                      | Specification IDs                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bootstrapContractExecutorWorker.ts](../../../../../../../../src/evm/contractExecutor/worker/bootstrapContractExecutorWorker.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-LOG-10-69CTN1`](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) |

## Assumptions, dependencies, trust boundaries, and limits

- The far end of the worker scope is this process's own owning thread, so its line is trusted.
- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules
  ([`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)).
- An error outside a request is reported to the owner over the worker-errors endpoint and this
  thread keeps serving; it also asks every reachable thread to send its logs, waiting for none of
  them ([`REQ-LOG-10-69CTN1`](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID                                                                                | Obligation                                                                                                                     | Public entry and setup                                                                                                                           | Oracle and forbidden effects                                                            | Required permutations                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-vm-worker-bootstrap-1-d9rg7t"></a>`UNIT-TEST-VM-WORKER-BOOTSTRAP-1-D9RG7T` | The bootstrap a vm worker runs on both platforms: its line, its report path, and the round it asks for after a detached error. | A real browser worker under a real owner, crashing a precompile on purpose, with the report taken on the owning thread so nothing else collects. | What the real crash-log receiver stored for the worker realm; the worker keeps serving. | <a id="unit-test-vm-worker-bootstrap-1-d9rg7t.p1"></a>`UNIT-TEST-VM-WORKER-BOOTSTRAP-1-D9RG7T.P1` — a detached vm error in a browser worker produces an upload round covering the vm realm, with no collection asked for from above |

## Related source reports

- [node/ContractExecutorWorkerEntry.ts.md](../node/ContractExecutorWorkerEntry.ts.md), [browser/ContractExecutorWorkerEntry.ts.md](../browser/ContractExecutorWorkerEntry.ts.md) — the two entries that call it.
- [rpc/ContractExecutorRoot.ts.md](../rpc/ContractExecutorRoot.ts.md) — the root it serves.
