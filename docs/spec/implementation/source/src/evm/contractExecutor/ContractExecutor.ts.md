# ContractExecutor.ts — Source Report

> **Source:** [src/evm/contractExecutor/ContractExecutor.ts](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The inline executor: local EVM execution in the current context. It also owns the local EVM call-gas
rule: [`localEvmCallGasLimit`](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L43) and the `DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT` floor it starts
from ([#L27](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L27)).

## Key design decisions

Disposal releases the executor logger through its normal public disposal method. The RPC service invokes that cleanup before dropping its executor reference.

1. **Ambient block time comes from a clock source, stamped per call.** An executor built with a
   `clock` stamps every `runCall` (deploy, execute, simulate) with the EVM's default block header and
   `timestamp = clock()` ([#L170](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L170)),
   so manager and protocol views defined against current time (kill periods, evidence windows) see the
   runtime's estimated chain time in the local mirror instead of zero
   ([`REQ-TIME-5-S9NQXK`](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk)). Without a clock the
   header stays the EVM default. State transitions are unaffected: they read `_tx.header.timestamp`.
2. **Every local EVM call gets `max(0xffffff floor, dispute budget, 2 × replay requirement)`.** Engineer
   decision SY1. The executor passes one fixed `callGasLimit` to every `runCall`
   ([#L169](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L169)); the constructor option defaults to `DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT =
0xffffff` (about 16.7M, the EVM's own default call gas) ([#L78-L79](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L78-L79)). The runtime
   sets it to `localEvmCallGasLimit(disputeExecutionGasLimit, stateTransitionReplayGas)` =
   max(0xffffff, the manager's `getGasLimit()`, twice its `getStateTransitionReplayGas()`)
   ([#L43-L53](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L43-L53)). Deviation from the engineer's text "max(16.7M, getGasLimit)": the
   replay-gas term is required, because the state machine refuses to run a transition it cannot
   grant its full budget, and a replay needs more than the budget itself (the 63/64 share each
   frame keeps). Without it every local replay of a transition near its budget would fail with
   `ErrorInsufficientGasForStateTransition` where the chain, funded upfront, judges it. The term is
   twice the requirement because the requirement covers only the transition's budget and the
   machine's fixed setup: deleting the previous transition's outbound messages and copying the
   input happen before the stipend check, on top of it, and cost at most about one more budget
   (they undo or move what one budgeted run wrote). With twice the requirement a local transition
   is not refused where a funded chain replay runs it, as far as the chain's block gas limit lets
   such a replay be sent (a block whose input alone exceeds that limit cannot be replayed on-chain
   either). The requirement is still not a bound on the rest of a dispute call: a chain fraud-proof
   send also funds proof checks and restoring the machine's state through its estimate
   ([DisputeManager](../../disputeManager/DisputeManager.ts.md)), and the local call gets no such
   addition. So a local predicate call can still run out of gas where the chain would run it; that
   is a local revert, and the local-first caller falls back to the chain (decision 3), so the
   consequence is an extra chain read, not a different answer. A local `stateTransition` that is
   refused or runs out of gas in its own frame is a local failure, not an invalid transition
   ([EvmDiamondStateMachine](../EvmDiamondStateMachine.ts.md) decision 4). The floor can exceed a dispute
   transaction's budget, so a local call can do more work than one dispute transaction may. The old
   fixed 1e9 limit is gone: local work per call is bounded by the larger of the chain's budgets and
   the 16.7M floor
   ([`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys),
   [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)).
3. **A revert is reported under the shared local-revert marker.** The error thrown for an EVM
   exception starts with `LOCAL_EVM_EXECUTION_FAILED` from [evmErrorHandler](../../utils/evmErrorHandler.ts.md), followed by the
   decoded custom-error name when there is one, else the EVM's own exception (`out of gas`,
   `revert`, ...) ([#L180](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L180)); `isInvalidStateTransitionError` reads that reason. The local signer and the RPC
   boundary keep that text when they wrap the error, so `isLocalEvmExecutionFailure` recognizes a mirror
   revert wherever it surfaces, and a local-first read falls back to the chain only for it
   ([`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                              | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ContractExecutor.ts](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-TIME-5-S9NQXK`](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk), [`REQ-ENFSM-1-DKJCY2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2), [`REQ-MIRROR-4-H9C4YS`](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.
- The call-gas inputs are read once at host start; a manager whose budget changes afterwards is not
  followed (the deployed values are constants today).
- The replay requirement funds the transition's stipend and fixed setup only. Twice the
  requirement also covers deleting previous outbound messages and copying the input, as far as the
  chain's block gas limit lets a replay be sent. The rest of a dispute call (proof checks, state
  restoration) is not bounded by it, so a local predicate call can run out of gas where a chain
  call funded by the sender's estimate runs; the local-revert fallback turns that into a chain
  read, never an answer. A local state transition that is refused or runs out of gas in its own
  frame is thrown as a local failure and never judged.
- **Residual (accepted):** the 0xffffff floor. When the chain's budgets are smaller, a Byzantine
  dispute can make an auditor spend up to about 16.7M gas of local work per evaluated call before
  the chain is asked — more than the chain would run for that call, but bounded and not under the
  attacker's control.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Gap / divergence                                        |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`REQ-TIME-5-S9NQXK`](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk)                  | Covered               | **Here:** [source](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L170) stamps deploy, execute, and simulation calls from the injected clock; simulation rolls back its state writes. **Other files:** [Clock.ts](../../Clock.ts.md) (current clock and adjustment), [createContractExecutor.ts](createContractExecutor.ts.md) (clock/factory wiring), [ContractExecutorService.ts](../../rpc/internal/services/contractExecutor/ContractExecutorService.ts.md) (worker-local clock derivation).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                       |
| [`REQ-ENFSM-1-DKJCY2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2) | Covered               | **Here:** every call runs with `callGasLimit` ([#L169](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L169)), which [`localEvmCallGasLimit`](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L43) raises to at least twice the manager's replay gas, so a local transition gets its full budget after deleting previous outbound messages and copying its input, and classifies it as a funded on-chain replay does; a refusal or an out-of-gas of the call's own frame is a local failure, never a verdict. **Other files:** [EvmDiamondStateMachine](../EvmDiamondStateMachine.ts.md) and [evmErrorHandler](../../utils/evmErrorHandler.ts.md) turn such a failure into a thrown error; [P2pRuntimeHostRoot](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md) reads the chain values and sets the limit; [AStateMachine](../../../contracts/V1/AStateMachine.sol.md) refuses an under-funded transition; [StateChannelManagerProxy](../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md) refuses to adjudicate one. | —                                                       |
| [`REQ-MIRROR-4-H9C4YS`](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)         | Covered               | **Here:** [`localEvmCallGasLimit`](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L43) = max(0xffffff, dispute-execution budget, 2 × replay gas), applied to every `runCall` ([#L169](../../../../../../../src/evm/contractExecutor/ContractExecutor.ts#L169)): the second requirement covers deleting previous outbound messages and copying the input, so a local transition is not refused where a funded chain replay runs it; the requirement is not a bound on the rest of a dispute call, so a local predicate out-of-gas is possible where the chain runs and is handled as a revert (fallback to the chain); the floor can exceed a dispute transaction's budget. **Other files:** [P2pRuntimeHostRoot](../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md) (reads `getGasLimit` and `getStateTransitionReplayGas` once at start), [createContractExecutor](createContractExecutor.ts.md) and [ContractExecutorService](../../rpc/internal/services/contractExecutor/ContractExecutorService.ts.md) (carry the limit to either placement).                   | Accepted residual: the 0xffffff floor (limits section). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation             | Public entry and setup                                                                                                                                                                    | Oracle and forbidden effects                                                                                                                                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-1-jhg6kj"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ` | Ambient execution time | Deploy timestamp bytecode and call through the public executor/factory APIs.                                                                                                              | Read exact timestamps and state roots; compare worker adjustment against wall time.                                                                                                                                             | <a id="unit-test-contract-executor-1-jhg6kj.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P1` — constant clock source is used exactly; <a id="unit-test-contract-executor-1-jhg6kj.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P2` — constructor sees the supplied timestamp and persists it; <a id="unit-test-contract-executor-1-jhg6kj.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P3` — simulation sees time but does not persist its write; <a id="unit-test-contract-executor-1-jhg6kj.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P4` — bare inline factory before Clock initialization uses zero; <a id="unit-test-contract-executor-1-jhg6kj.p5"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P5` — bare dedicated factory before Clock initialization uses zero; <a id="unit-test-contract-executor-1-jhg6kj.p6"></a>`UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P6` — dedicated executor derives a nonzero adjustment from its own wall clock                                                |
| <a id="unit-test-contract-executor-2-xtm118"></a>`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118` | Local EVM call gas     | Call `localEvmCallGasLimit` with each input above and below the floor; deploy a Math machine whose budget needs more than 0xffffff into an executor built without and with `callGasLimit` | The limit is the largest of the floor, the budget and twice the replay gas; with the floor only the transition is refused with `ErrorInsufficientGasForStateTransition` and changes no state; raised to the requirement it runs | <a id="unit-test-contract-executor-2-xtm118.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P1` — both chain values below the floor: the limit is `DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT`; <a id="unit-test-contract-executor-2-xtm118.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P2` — the dispute-execution budget above the floor and twice the replay gas: the limit is the budget; <a id="unit-test-contract-executor-2-xtm118.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P3` — twice the replay gas above the floor and the budget: the limit is twice the replay gas; <a id="unit-test-contract-executor-2-xtm118.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P4` — an executor without `callGasLimit` refuses a transition whose requirement exceeds the floor, and the machine state is unchanged; <a id="unit-test-contract-executor-2-xtm118.p5"></a>`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P5` — an executor built with `localEvmCallGasLimit(budget, requirement)` runs that transition |

## Related source reports

- [AContractExecutor](./AContractExecutor.ts.md), [evmErrorHandler](../../utils/evmErrorHandler.ts.md) (the revert marker), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
