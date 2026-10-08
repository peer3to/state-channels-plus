# RuntimeLifecycleService.ts

> **Source:** [src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts](../../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T

Common readiness and prepared child cleanup.

- Setup: Actual SDK-owned roots and channels; held real responses and real post failures.
- Oracle: Retained readiness, selected-child isolation, child-before-local disposal, completed error collection and no upward cleanup cycle.

- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P1` — Readiness arriving before a waiter is retained for that child
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P2` — A pending readiness wait resolves after a child notification; repeated notifications do not create another completion
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P3` — Closing an unready child rejects its wait while an already-ready sibling remains ready
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P4` — Graceful disposal runs child cleanup before local cleanup and repeated calls reuse completion
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P5` — A child disposal post failure is reported after local cleanup still runs
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P6` — Quiescence waits for a held child reply, shares the in-flight drain for concurrent callers; later calls drain again and return only new rejections
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P7` — Upward disposal and quiescence requests reject without closing the parent or preventing later work
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P8` — Held host preparation keeps children open and callable; child and local cleanup follow once it completes
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P9` — Preparation failure still cleans children and local resources and repeated disposal preserves the original failure
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P10` — A disposal notification sent by a parent is rejected without closing either endpoint; only children may announce their disposal
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P11` — A later inline quiesce collects an error raised after the first drain
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P12` — A later worker quiesce collects an error raised after the first drain
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P13` — Worker custom RPC cleanup runs before manager cleanup
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P14` — Worker manager cleanup completes after custom RPC cleanup rejects
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P15` — An admitted disposal loses its parent during held cleanup; final closure still runs once after the failed reply attempt
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P16` — A worker loses its parent during admitted cleanup; final closure releases the worker and a separate runtime remains usable
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P17` — Failed application setup loses its error reply during cleanup; final closure releases the worker and a separate runtime remains usable
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P18` — A worker SDK abort with a worker executor waits for disposal acknowledgement while its parent loop is blocked; no false fatal exit, one final closure and a usable sibling
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P19` — Executor exit under a worker SDK rejects pending execution with the original cause and reports once; SDK cleanup completes and a sibling remains usable
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P20` — Worker SDK disposal closes its worker executor while execution is held, exits without a fatal report and preserves a sibling
- [x] `UNIT-TEST-RUNTIME-LIFECYCLE-1-GRZ48T.P21` — Parent-requested disposal of a worker SDK and worker executor awaits final acknowledgement while the parent is busy; no code-zero fatal exit and one final close
