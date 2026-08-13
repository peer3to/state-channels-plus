# AStateMachine.sol — Source Report

> **Source:** [contracts/V1/AStateMachine.sol](../../../../../../../contracts/V1/AStateMachine.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/state-machine-base.md](../../../views/architecture/contracts/state-machine-base.md)

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

The integrator base contract: the `stateTransition` wrapper injecting the protocol execution
context (`_tx.header`: logical author, time, position) before dispatching to integrator logic,
`getState`/`_setState` canonical serialization hooks, `getParticipants`, `getNextToWrite`/
`peekNextToWrite` turn-taking, `joinChannel`/`removeParticipant` membership entry points, and the
custom-inbound dispatch.

## Key design decisions

1. **Context injection over ambient EVM values:** transitions read `_tx.header.*` set by the wrapper — `msg.sender`/`block.timestamp`/`msg.data` are prohibited in integrator machines because they diverge between direct execution and replay ([`REQ-SM-1`](../../../../specification/protocol-model/state-machines.md#req-sm-1) family).
2. **`abi.encode` of one state struct is the reference serialization pattern** for the round-trip requirements.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                           |
| ------------ | ------------------------------------------------------------------ |
| Inputs       | Transactions via the wrapper; encoded states; membership messages. |
| Outputs      | Post-states, outbound messages, participant/turn views.            |
| Owned state  | The integrator's application state (scratch during replay).        |
| Side effects | None outside its own storage.                                      |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                              | Specification IDs                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AStateMachine.sol](../../../../../../../contracts/V1/AStateMachine.sol) | [`REQ-SM-1`](../../../../specification/protocol-model/state-machines.md#req-sm-1), [`REQ-SM-2`](../../../../specification/protocol-model/state-machines.md#req-sm-2), [`REQ-SM-5`](../../../../specification/protocol-model/state-machines.md#req-sm-5), [`INV-ENFSM-1`](../../../../specification/enforcement/execution-and-consumer.md#inv-enfsm-1) |

## Assumptions, dependencies, trust boundaries, and limits

- One shared deployment serves all channels in the current version — full pre-state restoration is what keeps that sound ([`INV-ENFSM-1`](../../../../specification/enforcement/execution-and-consumer.md#inv-enfsm-1)).

## Specification adherence

- The injected-context contract and turn-taking surface ([`REQ-SM-5`](../../../../specification/protocol-model/state-machines.md#req-sm-5)).

## Specification contradictions

None demonstrated at the base (integrator machines can still violate — the static-check/review guidance is future work in the view).

## Missing behavior

Automated prohibited-context static checks for integrator machines (spec future work).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                           | Implementation status | Evidence                                                                                                                                                                                   | Gap / divergence |
| --------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-SM-1`](../../../../specification/protocol-model/state-machines.md#req-sm-1) | Covered               | **Here:** wrapper-injected header before dispatch. **Other files:** replay context set by [execution-and-consumer](../../../../specification/enforcement/execution-and-consumer.md) paths. | None.            |
| [`REQ-SM-5`](../../../../specification/protocol-model/state-machines.md#req-sm-5) | Covered               | **Here:** `getNextToWrite` as the block-author authority.                                                                                                                                  | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                        | Obligation                        | Public entry and setup                                                            | Oracle and forbidden effects                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-astate-machine-1"></a>`UNIT-TEST-ASTATE-MACHINE-1` | Context injection and round trips | Execute transitions reading injected vs ambient context; serialize/restore cycles | Injected values govern; ambient reads detectable; byte-exact round trips | <a id="unit-test-astate-machine-1.p1"></a>`UNIT-TEST-ASTATE-MACHINE-1.P1` — injected header per field; <a id="unit-test-astate-machine-1.p2"></a>`UNIT-TEST-ASTATE-MACHINE-1.P2` — ambient divergence detection; <a id="unit-test-astate-machine-1.p3"></a>`UNIT-TEST-ASTATE-MACHINE-1.P3` — round-trip + re-execution equality; <a id="unit-test-astate-machine-1.p4"></a>`UNIT-TEST-ASTATE-MACHINE-1.P4` — join/remove membership entry points |

## Related source reports

- [MathStateMachine](./examples/MathStateMachine/MathStateMachine.sol.md) (reference integration), [EvmDiamondStateMachine](../../src/evm/EvmDiamondStateMachine.ts.md).
