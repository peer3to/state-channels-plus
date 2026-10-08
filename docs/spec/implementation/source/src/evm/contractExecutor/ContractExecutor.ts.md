# ContractExecutor.ts

> **Source:** [src/evm/contractExecutor/ContractExecutor.ts](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)
- [`REQ-TIME-5-S9NQXK` (Every local contract execution observes the runtime's current estimated chain…)](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)

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

## UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118

Local EVM call gas

- Setup: Call `localEvmCallGasLimit` with each input above and below the floor; deploy a Math machine whose budget needs more than 0xffffff into an executor built without and with `callGasLimit`
- Oracle: The limit is the largest of the floor, the budget and twice the replay gas; with the floor only the transition is refused with `ErrorInsufficientGasForStateTransition` and changes no state; raised to the requirement it runs

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P1` — both chain values below the floor: the limit is `DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT`
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P2` — the dispute-execution budget above the floor and twice the replay gas: the limit is the budget
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P3` — twice the replay gas above the floor and the budget: the limit is twice the replay gas
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P4` — an executor without `callGasLimit` refuses a transition whose requirement exceeds the floor, and the machine state is unchanged
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P5` — an executor built with `localEvmCallGasLimit(budget, requirement)` runs that transition

## UNIT-TEST-CONTRACT-EXECUTOR-3-2FRV62

Deferred executor mutex release

- Setup: Issue a real local call from the preceding result or rejection.
- Oracle: The lock releases in a later timer turn, preserving results and recovery.

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-3-2FRV62.P1` — Three reads issued successively from the prior read resolution return stored value five in order; a free first call finishes in its issue iteration and each later call finishes in a later event-loop iteration
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-3-2FRV62.P2` — A reverting simulation preserves the local-EVM failure marker and encoded Error(boom), releases its mutex, and lets a read issued from the rejection finish in a later loop iteration with stored value seven
