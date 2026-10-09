# AStateMachineStipend.t.sol

Test file: [test/V1/AStateMachineStipend.t.sol](../../../../../../test/V1/AStateMachineStipend.t.sol)
Exercises: [AStateMachine.sol](../../../../implementation/source/contracts/V1/AStateMachine.sol.md), [StateChannelManagerProxy.sol](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md), [DisputeFraudProofFacet.sol](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md)

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

Ten tests cover the dispute fraud proof that replays: a timeout refuted by posted calldata. The
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

Three of the ten post a block that is honest for its own base but not linked to the dispute's latest
state (`_stageTimeoutCalldataPostedOn`): a snapshot whose state hash names a forged genesis state
(participant 0 holds a balance it never had), with that forged state and a `previousBlockHash`
matching the forged snapshot; the real genesis snapshot with the forged state; and the real genesis
snapshot and state with a `previousBlockHash` of another block. Each funded refutation succeeds as a
call, leaves the timeout dispute committed, keeps the disputer standing and slashes the submitter.

One of the ten gives the dispute a state proof with one signed block by participant 1
(`_stageTimeoutCalldataPostedAfter`), signed as that block's canonical encoding plus one trailing
zero word; it asserts that the bytes decode to the same block and hash differently. The dispute
blames participant 0 for height 1, and the posted block builds on the genesis state through a
snapshot that the proved block commits to, with a `previousBlockHash` of `keccak256` of the signed
bytes. The funded refutation kills the timeout dispute and slashes the disputer.
The oracles are the revert data, `getSum`, `isParticipantSlashedOnChain`, and whether the dispute is
still committed.

Four deterministic sweeps cover the boundary the fuzzes sample only at random: the guarded honest
`applyFraudProofs` replay, the `burn` replay, and the honest `guardedAdd` and over-budget `burn`
timeout refutations. Each binary-searches the lowest attached gas at which the call adjudicates,
checking the verdict at every probe, then steps across that point in 1,000-gas increments over
±32,000, each probe from the same snapshot. Each probe asserts the matching fuzz's verdict. A
guarded honest author or posted block is never slashed or refuted. An over-budget author or
refutation is slashed exactly when a verdict is given, and the timeout dispute is never killed.
Loosening the upfront gas check in `AStateMachine` by 2M makes both guarded sweeps fail on every
run, while the 32-run guarded fuzzes still pass. The sweeps assign no test IDs of their own:
`T1.P6`, `T1.P7`, `T1.P21` and `T1.P22` stay with the fuzzes that cover the full attached-gas range.

`REQ-ENFSM-1-DKJCY2.T1.P2` (exactly at the gas bound) has no test.

## Tests

- `test_stateTransition_refusesCheapTransitionBelowStipend`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P2
- `test_stateTransition_runsWithItsGasRequirement`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P4
- `test_stateTransition_refusesTheBareBudget`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P5
- `test_stateTransition_guardedTransitionMatchesAddWhenFunded`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P6
- `test_stateTransition_refusesGuardedTransitionBelowStipend`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P7
- `test_stateTransition_bareRevertIsAVerdictWhenFunded`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P8
- `test_stateTransition_preservesTheTransitionsError`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P9
- `test_stateTransition_refusesOutOfGasBelowStipend`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P1
- `test_stateTransition_reportsBudgetExceededWhenFunded`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P3
- `test_applyFraudProofs_refusesUnderfundedCheapReplay`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P2, REQ-ENFSM-1-DKJCY2.T1.P8
- `test_applyFraudProofs_fundedCheapReplayKeepsHonestAuthor`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P6
- `test_applyFraudProofs_refusesUnderfundedGuardedReplay`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P7, REQ-ENFSM-1-DKJCY2.T1.P9
- `test_applyFraudProofs_fundedGuardedReplayKeepsHonestAuthor`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P8, REQ-ENFSM-1-DKJCY2.T1.P11
- `test_getStateTransitionReplayGas_fundsReplayOnTopOfItsCost`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P10, REQ-ENFSM-1-DKJCY2.T1.P10
- `test_executeStateTransition_refusesAnOutOfGasMachineFrame`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P11
- `test_applyFraudProofs_underfundedOutOfGasRevertsInsteadOfAdjudicating`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P1, REQ-ENFSM-1-DKJCY2.T1.P5
- `test_applyFraudProofs_fundedOutOfGasIsFraud`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P4, REQ-ENFSM-1-DKJCY2.T1.P4
- `testFuzz_applyFraudProofs_attachedGasNeverFlipsHonestVerdict`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P3, REQ-ENFSM-1-DKJCY2.T1.P6
- `testFuzz_applyFraudProofs_attachedGasNeverFlipsGuardedVerdict`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P9
- `test_stateTransition_callerPaysForDeletingManyPreviousOutboundMessages`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P13
- `test_stateTransition_previousOutboundMessagesNeverRaiseTheTransitionsCost`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P14
- `testFuzz_applyFraudProofs_leftoverOutboundMessagesNeverFlipHonestVerdict`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P13
- `test_stateTransition_reportsOnlyThisTransitionsMessagesAfterALongerList`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P11
- `testFuzz_stateTransition_grantsFullBudgetForAnyInputSize`: UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P12, REQ-ENFSM-1-DKJCY2.T1.P12
- `testFuzz_applyFraudProofs_inputSizeNeverFlipsGuardedVerdict`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P12
- `testFuzz_applyFraudProofs_attachedGasNeverFlipsFraudVerdict`: UNIT-TEST-MANAGER-PROXY-3-C3NY4X.P5, REQ-ENFSM-1-DKJCY2.T1.P7
- `test_applyDisputeFraudProofs_refusesUnderfundedTimeoutCalldataReplay`: REQ-ENFSM-1-DKJCY2.T1.P17
- `test_applyDisputeFraudProofs_fundedTimeoutCalldataReplayKillsTimeoutDispute`: REQ-ENFSM-1-DKJCY2.T1.P18
- `test_applyDisputeFraudProofs_fundedOverBudgetPostedBlockKeepsTimeoutDispute`: REQ-ENFSM-1-DKJCY2.T1.P19
- `test_applyDisputeFraudProofs_rejectsTimeoutRefutationFromUnlinkedSnapshot`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P34, REQ-DIS-10-SAHJBN.T1.P17
- `test_applyDisputeFraudProofs_rejectsTimeoutRefutationWhoseStateMissesTheSnapshot`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P35, REQ-DIS-10-SAHJBN.T1.P18
- `test_applyDisputeFraudProofs_rejectsTimeoutRefutationBlockBuiltOnAnotherBlock`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P36, REQ-DIS-10-SAHJBN.T1.P19
- `test_applyDisputeFraudProofs_timeoutRefutationLinksToLatestBlockSignedBytes`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P37
- `test_getStateTransitionReplayGas_fundsTimeoutCalldataReplayOnTopOfItsCost`: REQ-ENFSM-1-DKJCY2.T1.P20
- `testFuzz_applyDisputeFraudProofs_attachedGasNeverFlipsHonestPostedCalldata`: REQ-ENFSM-1-DKJCY2.T1.P21
- `testFuzz_applyDisputeFraudProofs_attachedGasNeverFlipsOverBudgetPostedCalldata`: REQ-ENFSM-1-DKJCY2.T1.P22
- `test_applyFraudProofs_sweepAcrossRequirementKeepsGuardedHonestAuthor`: none
- `test_applyFraudProofs_sweepAcrossRequirementNeverAcquitsOverBudget`: none
- `test_applyDisputeFraudProofs_sweepAcrossRequirementKeepsHonestPostedCalldata`: none
- `test_applyDisputeFraudProofs_sweepAcrossRequirementNeverAcceptsOverBudgetPostedCalldata`: none
