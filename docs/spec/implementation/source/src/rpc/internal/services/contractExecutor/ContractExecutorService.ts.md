# ContractExecutorService.ts

> **Source:** [src/rpc/internal/services/contractExecutor/ContractExecutorService.ts](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorService.ts)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-6-6F4SSM` (Cross-context clock equivalence)](../../../../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)

## UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K

Transfer-safe executor messages for [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) and readiness input for [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

- Setup: Drive the SDK-owned executor with real precompile options, calls, errors, and disposal.
- Oracle: Boundary values survive exactly; invalid states reject; responses stay correlated.

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P1` — init configuration and precompile manifest
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P2` — successful request/response correlation
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P3` — serialized error correlation
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P4` — disposal message and terminal state
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P5` — An inline root with a zero adjustment uses wall time even when Clock is initialized
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P6` — An inline root with an explicit adjustment uses that offset rather than the shared Clock
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P7` — Without an adjustment or initialized Clock, real timestamp bytecode observes zero

## UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB

Admission closes before child disposal and admitted work drains within the shared drain limit, for [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

- Setup: A real SDK-owned inline executor loads a custom precompile whose factory creates a real probe child under the executor owner; the child's echo reply is held so an `executeCall` stays admitted while disposal begins. For completion after the limit, a real inline executor loads a precompile that answers, or fails, 1.2 seconds after the drain limit, and disposal starts right after the calls are sent.
- Oracle: Admitted and mutex-queued operations return their own results or errors before the child closes; later calls reject with `Contract executor is shutting down` without reaching the precompile; repeated disposal returns the same promise; an admitted operation that never settles holds disposal open only for `IN_FLIGHT_REPLY_DRAIN_MS`, after which the child closes, the caller's request rejects, and no error reaches the host; a caller still waiting at the limit settles with exactly `Contract executor shut down before the operation finished`, and that outcome holds through an absence window that outlasts the operation's late completion. Forbidden: disposing the child while admitted work that settles within the limit runs, a late call entering the EVM, a lost operation error, disposal outliving the limit, a host error from abandoned work, a late success or failure replacing the disposal rejection.

- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P1` — held admitted call plus a deploy and a simulation queued behind it all succeed, and disposal completes last with the child closed
- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P2` — a call, a deploy, and a simulation after disposal began each reject with the shutdown error and the precompile call count does not grow
- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P3` — an admitted deploy that fails in the EVM keeps its failure while disposal waits, and the child closes afterwards
- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P4` — two disposal calls during admitted work return the same promise and both settle after release
- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P5` — an admitted call whose child reply never arrives holds disposal open for at least the drain limit and well under three times it; the child then closes, the call rejects, the precompile ran once, and the host records no executor error
- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P6` — an admitted call whose precompile succeeds after the drain limit settles its caller with exactly the disposal rejection, which stays unchanged after the late success, and the host records no executor error
- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P7` — an admitted call whose precompile fails after the drain limit settles its caller with exactly the disposal rejection, not the late failure, and the host records no executor error
- [x] `UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P8` — a deploy and a simulation queued on the executor mutex behind a call that finishes after the drain limit each settle, with that call, with exactly the disposal rejection, and the host records no executor error
