# test/V1/AStateMachineStipend.t.sol — Test Report

> **Test file:** [test/V1/AStateMachineStipend.t.sol](../../../../../../test/V1/AStateMachineStipend.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [AStateMachine.sol](../../../../implementation/source/contracts/V1/AStateMachine.sol.md), [StateChannelManagerProxy.sol](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md), [DisputeFraudProofFacet.sol](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Foundry suite for the rule that the gas a caller attaches never decides a transition's verdict: a
transition runs only when it can be granted its full budget, and is refused before it starts
otherwise. It runs on the `DiamondHarness` deployment with a Math machine (3M budget) or a
gas-hungry Math variant: `burn` never finishes, `guardedAdd` runs `add(1)` only if an inner
15M-gas sub-call succeeds (so an under-funded run would advance the turn without adding; deployed
with a 16M budget), and `bareRevert`/`failWithReason` fail with empty and non-empty returndata.

Directly on the machine, `stateTransition` is called with two thirds of the budget, exactly the
budget, exactly `getStateTransitionGasRequirement()`, and three times the budget. Below the
requirement `add`, `guardedAdd`, and `burn` all revert with `ErrorInsufficientGasForStateTransition`
(the refused `add` leaves `getSum` at 0); exactly the requirement runs `add`; funded, `guardedAdd`
equals `add`, `burn` and a bare revert revert with "result length 0", and a reason is re-raised
unchanged.

Through the manager, `applyFraudProofs` receives an invalid-transition proof over a block by the
turn holder, with the resulting snapshot hashed as `add(1)` would produce it. For `add` and
`guardedAdd` the block is honest: under-funded the call reverts with the machine's refusal and
nobody is slashed; funded the proof fails and the author keeps standing. For `burn` under-funded
reverts the same way, funded slashes the author. One test measures the funded cost of a
`guardedAdd` replay, then shows the cost alone is refused and the cost plus
`getStateTransitionReplayGas()` is judged (author kept standing). One test sweeps small gas
amounts into `executeStateTransition` (pranked as the diamond) until the machine frame fails with
empty returndata, and asserts every call fails and one yields `ErrorStateTransitionFrameOutOfGas`.
Three fuzzes over attached gas from 100k to the funded amount assert that the `add` and
`guardedAdd` authors are never slashed and that the `burn` author is slashed exactly when the call
succeeded. A fourth fuzz also varies the size of the `guardedAdd` transition's input (up to 128 KiB)
and asserts that its author is never slashed.

Five tests pin the upfront check itself (review items SR1 and FO3). The previous transition's
outbound messages are deleted before the gas check, at the caller's cost. One runs a transition
that leaves 40 outbound messages, cools the machine's storage (`vm.cool`), and calls a transition
with exactly `getStateTransitionGasRequirement()`: it is refused with
`ErrorInsufficientGasForStateTransition`; from the same snapshot, with 2,000,000 more gas, it runs,
reports no messages, and saw at least the budget minus 20,000 gas at entry (`recordEntryGas`). One
runs the same three-message transition after no previous messages, after three 4,096-byte ones and
after two 8-byte ones (storage cold each time) and asserts identical returned messages and a
measured transition cost (`lastTransitionGas`) never above the empty-storage run. One fuzzes the
attached gas of an honest `guardedAdd` fraud-proof replay after 20 leftover 256-byte messages and
asserts the author is never slashed. One runs 3 messages then 1 and asserts that only the one new
message is reported and stored. One fuzzes the input size (up to 128 KiB) and the attached gas
(the requirement ±300,000) directly on the machine: whenever the call succeeds, the transition saw
at least its budget minus 20,000 gas at entry.

Nine tests cover the dispute fraud proof that replays: a timeout refuted by posted calldata. The
staging (`test/V1/harness/TimeoutCalldataPostedStaging.sol`) uploads a timeout dispute by
participant 1 against participant 0 for height 0 of the genesis fork, then has participant 0 post a
signed block for that height in time, through the diamond's public entry points. The block's
snapshot hash is the one a funded replay gives, and participant 0 submits the
`TimeoutCalldataPosted` proof with `applyDisputeFraudProofs` at a chosen gas. An under-funded
`guardedAdd` refutation reverts with the machine's refusal (or `ErrorStateTransitionFrameOutOfGas`),
leaves the dispute committed and slashes nobody; funded, it kills the dispute and slashes the
disputer; a funded `burn` refutation is a failed refutation that slashes the submitter and leaves the
dispute committed. One test measures the funded cost, then shows the cost alone is refused with no
verdict and the cost plus `getStateTransitionReplayGas()` kills the dispute. Two fuzzes over the
attached gas assert that an honest `guardedAdd` refutation either kills the dispute or gives no
verdict, and that a `burn` refutation never kills it and slashes the submitter exactly when the call
succeeds.

Three of the nine post a block that is honest for its own base but not linked to the dispute's latest
state (`_stageTimeoutCalldataPostedOn`): a snapshot whose state hash names a forged genesis state
(participant 0 holds a balance it never had), with that forged state and a `previousBlockHash`
matching the forged snapshot; the real genesis snapshot with the forged state; and the real genesis
snapshot and state with a `previousBlockHash` of another block. Each funded refutation succeeds as a
call, leaves the timeout dispute committed, keeps the disputer standing and slashes the submitter.
The oracles are the revert data, `getSum`, `isParticipantSlashedOnChain`, and whether the dispute is
still committed.

[`REQ-ENFSM-1-DKJCY2.T1.P2`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p2) (exactly at the gas bound) has no test.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                           | Covers                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_stateTransition_refusesCheapTransitionBelowStipend`](../../../../../../test/V1/AStateMachineStipend.t.sol#L76) (line 76)                            | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P2`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p2)                                                                                                                                                                  |
| [`test_stateTransition_runsWithItsGasRequirement`](../../../../../../test/V1/AStateMachineStipend.t.sol#L87) (line 87)                                     | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P4`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p4)                                                                                                                                                                  |
| [`test_stateTransition_refusesTheBareBudget`](../../../../../../test/V1/AStateMachineStipend.t.sol#L98) (line 98)                                          | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P5`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p5)                                                                                                                                                                  |
| [`test_stateTransition_guardedTransitionMatchesAddWhenFunded`](../../../../../../test/V1/AStateMachineStipend.t.sol#L109) (line 109)                       | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P6`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p6)                                                                                                                                                                  |
| [`test_stateTransition_refusesGuardedTransitionBelowStipend`](../../../../../../test/V1/AStateMachineStipend.t.sol#L120) (line 120)                        | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P7`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p7)                                                                                                                                                                  |
| [`test_stateTransition_bareRevertIsAVerdictWhenFunded`](../../../../../../test/V1/AStateMachineStipend.t.sol#L130) (line 130)                              | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P8`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p8)                                                                                                                                                                  |
| [`test_stateTransition_preservesTheTransitionsError`](../../../../../../test/V1/AStateMachineStipend.t.sol#L140) (line 140)                                | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P9`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p9)                                                                                                                                                                  |
| [`test_stateTransition_refusesOutOfGasBelowStipend`](../../../../../../test/V1/AStateMachineStipend.t.sol#L150) (line 150)                                 | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P1`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p1)                                                                                                                                                                  |
| [`test_stateTransition_reportsBudgetExceededWhenFunded`](../../../../../../test/V1/AStateMachineStipend.t.sol#L160) (line 160)                             | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P3`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p3)                                                                                                                                                                  |
| [`test_applyFraudProofs_refusesUnderfundedCheapReplay`](../../../../../../test/V1/AStateMachineStipend.t.sol#L242) (line 242)                              | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P2`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p2), [`REQ-ENFSM-1-DKJCY2.T1.P8`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p8)        |
| [`test_applyFraudProofs_fundedCheapReplayKeepsHonestAuthor`](../../../../../../test/V1/AStateMachineStipend.t.sol#L251) (line 251)                         | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P6`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p6)                                                                                                                                |
| [`test_applyFraudProofs_refusesUnderfundedGuardedReplay`](../../../../../../test/V1/AStateMachineStipend.t.sol#L259) (line 259)                            | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P7`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p7), [`REQ-ENFSM-1-DKJCY2.T1.P9`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p9)        |
| [`test_applyFraudProofs_fundedGuardedReplayKeepsHonestAuthor`](../../../../../../test/V1/AStateMachineStipend.t.sol#L268) (line 268)                       | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P8`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p8), [`REQ-ENFSM-1-DKJCY2.T1.P11`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p11)      |
| [`test_getStateTransitionReplayGas_fundsReplayOnTopOfItsCost`](../../../../../../test/V1/AStateMachineStipend.t.sol#L279) (line 279)                       | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P10`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p10), [`REQ-ENFSM-1-DKJCY2.T1.P10`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p10)    |
| [`test_executeStateTransition_refusesAnOutOfGasMachineFrame`](../../../../../../test/V1/AStateMachineStipend.t.sol#L302) (line 302)                        | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P11`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p11)                                                                                                                              |
| [`test_applyFraudProofs_underfundedOutOfGasRevertsInsteadOfAdjudicating`](../../../../../../test/V1/AStateMachineStipend.t.sol#L318) (line 318)            | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P1`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p1), [`REQ-ENFSM-1-DKJCY2.T1.P5`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p5)        |
| [`test_applyFraudProofs_fundedOutOfGasIsFraud`](../../../../../../test/V1/AStateMachineStipend.t.sol#L327) (line 327)                                      | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P4`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p4), [`REQ-ENFSM-1-DKJCY2.T1.P4`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p4)        |
| [`testFuzz_applyFraudProofs_attachedGasNeverFlipsHonestVerdict`](../../../../../../test/V1/AStateMachineStipend.t.sol#L337) (line 337)                     | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P3`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p3), [`REQ-ENFSM-1-DKJCY2.T1.P6`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p6)        |
| [`testFuzz_applyFraudProofs_attachedGasNeverFlipsGuardedVerdict`](../../../../../../test/V1/AStateMachineStipend.t.sol#L349) (line 349)                    | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P9`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p9)                                                                                                                                |
| [`test_stateTransition_callerPaysForDeletingManyPreviousOutboundMessages`](../../../../../../test/V1/AStateMachineStipend.t.sol#L363) (line 363)           | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P13`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p13)                                                                                                                                                                |
| [`test_stateTransition_previousOutboundMessagesNeverRaiseTheTransitionsCost`](../../../../../../test/V1/AStateMachineStipend.t.sol#L396) (line 396)        | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P14`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p14)                                                                                                                                                                |
| [`testFuzz_applyFraudProofs_leftoverOutboundMessagesNeverFlipHonestVerdict`](../../../../../../test/V1/AStateMachineStipend.t.sol#L430) (line 430)         | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P13`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p13)                                                                                                                              |
| [`test_stateTransition_reportsOnlyThisTransitionsMessagesAfterALongerList`](../../../../../../test/V1/AStateMachineStipend.t.sol#L444) (line 444)          | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P11`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p11)                                                                                                                                                                |
| [`testFuzz_stateTransition_grantsFullBudgetForAnyInputSize`](../../../../../../test/V1/AStateMachineStipend.t.sol#L461) (line 461)                         | [`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P12`](../../../../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf.p12), [`REQ-ENFSM-1-DKJCY2.T1.P12`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p12)                                      |
| [`testFuzz_applyFraudProofs_inputSizeNeverFlipsGuardedVerdict`](../../../../../../test/V1/AStateMachineStipend.t.sol#L481) (line 481)                      | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P12`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p12)                                                                                                                              |
| [`testFuzz_applyFraudProofs_attachedGasNeverFlipsFraudVerdict`](../../../../../../test/V1/AStateMachineStipend.t.sol#L496) (line 496)                      | [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P5`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x.p5), [`REQ-ENFSM-1-DKJCY2.T1.P7`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p7)        |
| [`test_applyDisputeFraudProofs_refusesUnderfundedTimeoutCalldataReplay`](../../../../../../test/V1/AStateMachineStipend.t.sol#L551) (line 551)             | [`REQ-ENFSM-1-DKJCY2.T1.P17`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p17)                                                                                                                                                                                            |
| [`test_applyDisputeFraudProofs_fundedTimeoutCalldataReplayKillsTimeoutDispute`](../../../../../../test/V1/AStateMachineStipend.t.sol#L562) (line 562)      | [`REQ-ENFSM-1-DKJCY2.T1.P18`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p18)                                                                                                                                                                                            |
| [`test_applyDisputeFraudProofs_fundedOverBudgetPostedBlockKeepsTimeoutDispute`](../../../../../../test/V1/AStateMachineStipend.t.sol#L572) (line 572)      | [`REQ-ENFSM-1-DKJCY2.T1.P19`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p19)                                                                                                                                                                                            |
| [`test_applyDisputeFraudProofs_rejectsTimeoutRefutationFromUnlinkedSnapshot`](../../../../../../test/V1/AStateMachineStipend.t.sol#L633) (line 633)        | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P34`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p34), [`REQ-DIS-10-SAHJBN.T1.P17`](../../../../specification/disputes/disputes.md#req-dis-10-sahjbn.t1.p17) |
| [`test_applyDisputeFraudProofs_rejectsTimeoutRefutationWhoseStateMissesTheSnapshot`](../../../../../../test/V1/AStateMachineStipend.t.sol#L645) (line 645) | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P35`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p35), [`REQ-DIS-10-SAHJBN.T1.P18`](../../../../specification/disputes/disputes.md#req-dis-10-sahjbn.t1.p18) |
| [`test_applyDisputeFraudProofs_rejectsTimeoutRefutationBlockBuiltOnAnotherBlock`](../../../../../../test/V1/AStateMachineStipend.t.sol#L656) (line 656)    | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P36`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p36), [`REQ-DIS-10-SAHJBN.T1.P19`](../../../../specification/disputes/disputes.md#req-dis-10-sahjbn.t1.p19) |
| [`test_getStateTransitionReplayGas_fundsTimeoutCalldataReplayOnTopOfItsCost`](../../../../../../test/V1/AStateMachineStipend.t.sol#L670) (line 670)        | [`REQ-ENFSM-1-DKJCY2.T1.P20`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p20)                                                                                                                                                                                            |
| [`testFuzz_applyDisputeFraudProofs_attachedGasNeverFlipsHonestPostedCalldata`](../../../../../../test/V1/AStateMachineStipend.t.sol#L696) (line 696)       | [`REQ-ENFSM-1-DKJCY2.T1.P21`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p21)                                                                                                                                                                                            |
| [`testFuzz_applyDisputeFraudProofs_attachedGasNeverFlipsOverBudgetPostedCalldata`](../../../../../../test/V1/AStateMachineStipend.t.sol#L710) (line 710)   | [`REQ-ENFSM-1-DKJCY2.T1.P22`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p22)                                                                                                                                                                                            |
