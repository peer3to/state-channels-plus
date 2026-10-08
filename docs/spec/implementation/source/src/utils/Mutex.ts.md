# Mutex.ts

> **Source:** [src/utils/Mutex.ts](../../../../../../src/utils/Mutex.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)

## UNIT-TEST-MUTEX-1-YQGDQH

Serialization

- Setup: Contend, throw inside critical sections, verify order
- Oracle: Exclusive FIFO; throws release; no deadlock on reentry attempts

- [ ] `UNIT-TEST-MUTEX-1-YQGDQH.P1` — contention order
- [ ] `UNIT-TEST-MUTEX-1-YQGDQH.P2` — throw releases
- [ ] `UNIT-TEST-MUTEX-1-YQGDQH.P3` — unlock discipline
