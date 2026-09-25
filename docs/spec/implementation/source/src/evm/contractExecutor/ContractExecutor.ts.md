# ContractExecutor.ts

> **Source:** [src/evm/contractExecutor/ContractExecutor.ts](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)
- [`REQ-TIME-5-S9NQXK` (Every local contract execution observes the runtime's current estimated chain…)](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk)

## UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ

Ambient execution time

- Setup: Deploy timestamp bytecode and call through the public executor/factory APIs.
- Oracle: Read exact timestamps and state roots; compare worker adjustment against wall time.

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P1` — constant clock source is used exactly
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P2` — constructor sees the supplied timestamp and persists it
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P3` — simulation sees time but does not persist its write
- [ ] `UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P4` — bare inline factory before Clock initialization uses zero
- [ ] `UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P5` — bare dedicated factory before Clock initialization uses zero
- [ ] `UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P6` — dedicated executor derives a nonzero adjustment from its own wall clock
