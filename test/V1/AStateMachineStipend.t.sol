// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import {DiamondHarness} from "./harness/DiamondHarness.sol";
import {GasHungryMathStateMachine} from "./harness/GasHungryMathStateMachine.sol";
import {StateChannelManagerInterface} from "../../contracts/V1/StateChannelManagerInterface.sol";
import {MathStateMachine, MathState} from "../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {ErrorInsufficientGasForStateTransition} from "../../contracts/V1/AStateMachine.sol";
import {ErrorStateTransitionFrameOutOfGas} from "../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../contracts/V1/types/DataTypes.sol";
import "../../contracts/V1/types/ProofTypes.sol";
import {BlockInvalidStateTransitionProof} from "../../contracts/V1/types/FraudProofTypes.sol";

// The gas a caller attaches must never decide a transition's verdict. A transition runs only when
// the caller can grant it its full budget, and is refused before it starts otherwise: even a
// transition that would fit in less gas, since one that catches an inner out-of-gas can succeed
// with a different result when under-funded. The manager turns that refusal (or a machine frame
// that ran out of gas) into a failed call instead of an "invalid transition" verdict, and
// getStateTransitionReplayGas is what a sender adds to its estimate to be funded.
// test naming: test_<targetFunction>_<property>
contract AStateMachineStipendTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    bytes32 internal constant CHANNEL_ID = keccak256("channel");
    bytes32 internal constant FORK_ID = keccak256("fork");
    // Enough for the 63/64 headroom of every frame above the stipend call.
    uint256 internal constant FUNDED_GAS = SM_GAS_LIMIT * 3;
    // Below the stipend itself, so the stipend call is never granted the full budget.
    uint256 internal constant UNDERFUNDED_GAS = SM_GAS_LIMIT * 2 / 3;
    uint256 internal constant GUARDED_BUDGET = 16_000_000;
    uint256 internal constant GUARDED_FUNDED_GAS = GUARDED_BUDGET * 3;
    uint256 internal constant GUARDED_UNDERFUNDED_GAS = GUARDED_BUDGET * 2 / 3;

    function _deploy(bool gasHungry) internal returns (address[] memory participants) {
        diamond = gasHungry
            ? deployDiamondWith(new GasHungryMathStateMachine(SM_GAS_LIMIT, MAX_CHANNEL_PARTICIPANTS))
            : deployDiamond();
        participants = _open();
    }

    // `guardedAdd` needs a large budget: only then do the frames above an under-funded replay keep
    // enough gas (1/64 each) to finish a fraud verdict after the transition.
    function _deployGuarded() internal returns (address[] memory participants) {
        diamond = deployDiamondWith(new GasHungryMathStateMachine(GUARDED_BUDGET, MAX_CHANNEL_PARTICIPANTS));
        participants = _open();
    }

    function _open() internal returns (address[] memory participants) {
        uint256[] memory privateKeys = new uint256[](2);
        privateKeys[0] = 1;
        privateKeys[1] = 2;
        participants = new address[](2);
        participants[0] = vm.addr(privateKeys[0]);
        participants[1] = vm.addr(privateKeys[1]);
        _openChannel(CHANNEL_ID, privateKeys);
    }

    function _transaction(address author, bytes memory data) internal pure returns (Transaction memory transaction) {
        transaction.header.channelId = CHANNEL_ID;
        transaction.header.forkId = FORK_ID;
        transaction.header.participant = author;
        transaction.header.timestamp = 1;
        transaction.body.data = data;
    }

    function _encodedState(address[] memory participants) internal pure returns (bytes memory) {
        MathState memory state;
        state.participants = participants;
        state.balances = new uint256[](participants.length);
        state.currentTurnIndex = 0;
        return abi.encode(state);
    }

    // ---- the machine itself -------------------------------------------------------------

    function test_stateTransition_refusesCheapTransitionBelowStipend() public {
        address[] memory participants = _deploy(false);
        stateMachine.setState(_encodedState(participants));

        vm.expectPartialRevert(ErrorInsufficientGasForStateTransition.selector);
        stateMachine.stateTransition{gas: UNDERFUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(MathStateMachine.add, (1)))
        );
        assertEq(stateMachine.getSum(), 0, "a refused transition changes nothing");
    }

    function test_stateTransition_runsWithItsGasRequirement() public {
        address[] memory participants = _deploy(false);
        stateMachine.setState(_encodedState(participants));

        (bool success,) = stateMachine.stateTransition{gas: stateMachine.getStateTransitionGasRequirement()}(
            _transaction(participants[0], abi.encodeCall(MathStateMachine.add, (1)))
        );
        assertTrue(success);
        assertEq(stateMachine.getSum(), 1);
    }

    function test_stateTransition_refusesTheBareBudget() public {
        address[] memory participants = _deploy(false);
        stateMachine.setState(_encodedState(participants));

        // The budget itself is not enough: EIP-150 keeps 1/64 of it in the caller.
        vm.expectPartialRevert(ErrorInsufficientGasForStateTransition.selector);
        stateMachine.stateTransition{gas: SM_GAS_LIMIT}(
            _transaction(participants[0], abi.encodeCall(MathStateMachine.add, (1)))
        );
    }

    function test_stateTransition_guardedTransitionMatchesAddWhenFunded() public {
        address[] memory participants = _deployGuarded();
        stateMachine.setState(_encodedState(participants));

        (bool success,) = stateMachine.stateTransition{gas: GUARDED_FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.guardedAdd, ()))
        );
        assertTrue(success);
        assertEq(stateMachine.getSum(), 1, "the guarded sub-call never fails under the full budget");
    }

    function test_stateTransition_refusesGuardedTransitionBelowStipend() public {
        address[] memory participants = _deployGuarded();
        stateMachine.setState(_encodedState(participants));

        vm.expectPartialRevert(ErrorInsufficientGasForStateTransition.selector);
        stateMachine.stateTransition{gas: GUARDED_UNDERFUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.guardedAdd, ()))
        );
    }

    function test_stateTransition_bareRevertIsAVerdictWhenFunded() public {
        address[] memory participants = _deploy(true);
        stateMachine.setState(_encodedState(participants));

        vm.expectRevert(bytes("AStateMachine - Call failed - result length 0"));
        stateMachine.stateTransition{gas: FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.bareRevert, ()))
        );
    }

    function test_stateTransition_preservesTheTransitionsError() public {
        address[] memory participants = _deploy(true);
        stateMachine.setState(_encodedState(participants));

        vm.expectRevert(bytes("GasHungryMathStateMachine: rejected"));
        stateMachine.stateTransition{gas: FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.failWithReason, ()))
        );
    }

    function test_stateTransition_refusesOutOfGasBelowStipend() public {
        address[] memory participants = _deploy(true);
        stateMachine.setState(_encodedState(participants));

        vm.expectPartialRevert(ErrorInsufficientGasForStateTransition.selector);
        stateMachine.stateTransition{gas: UNDERFUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.burn, ()))
        );
    }

    function test_stateTransition_reportsBudgetExceededWhenFunded() public {
        address[] memory participants = _deploy(true);
        stateMachine.setState(_encodedState(participants));

        vm.expectRevert(bytes("AStateMachine - Call failed - result length 0"));
        stateMachine.stateTransition{gas: FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.burn, ()))
        );
    }

    // ---- the manager's replay --------------------------------------------------------------

    /// An "invalid transition" proof over a block by the turn holder. For `add(1)` the block is
    /// honest (resulting snapshot hashed exactly as the manager recomputes it), so a funded replay
    /// fails the proof and the author keeps standing. For `burn()` the transition exceeds any
    /// budget, so a funded replay proves the fraud.
    function _proof(address[] memory participants, bytes memory data)
        internal
        pure
        returns (FraudProof[] memory proofs, FraudProofVerificationContext memory context)
    {
        bytes memory encodedPreviousState = _encodedState(participants);
        StateSnapshot memory previousSnapshot;
        previousSnapshot.forkId = FORK_ID;
        previousSnapshot.snapshotData.stateMachineStateHash = keccak256(encodedPreviousState);
        previousSnapshot.snapshotData.participants = participants;

        MathState memory resultingState = abi.decode(encodedPreviousState, (MathState));
        resultingState.number = 1;
        resultingState.currentTurnIndex = 1;
        // Deep copy: a memory struct assignment would alias the previous snapshot's data.
        StateSnapshot memory resultingSnapshot = abi.decode(abi.encode(previousSnapshot), (StateSnapshot));
        resultingSnapshot.blockHeight = previousSnapshot.blockHeight + 1;
        resultingSnapshot.timestamp = 1;
        resultingSnapshot.snapshotData.originForkId = FORK_ID;
        resultingSnapshot.snapshotData.stateMachineStateHash = keccak256(abi.encode(resultingState));

        Block memory blk;
        blk.transaction = _transaction(participants[0], data);
        blk.previousBlockHash = keccak256(abi.encode(previousSnapshot));
        blk.stateSnapshotHash = keccak256(abi.encode(resultingSnapshot));
        bytes memory encodedBlock = abi.encode(blk);

        BlockInvalidStateTransitionProof memory proof = BlockInvalidStateTransitionProof({
            invalidBlock: SignedBlock({encodedBlock: encodedBlock, signature: _sign(1, encodedBlock)}),
            previousBlock: SignedBlock({encodedBlock: "", signature: ""}),
            previousBlockStateSnapshot: previousSnapshot,
            previousStateStateMachineState: encodedPreviousState
        });
        proofs = new FraudProof[](1);
        proofs[0] = FraudProof({
            proofType: FraudProofType.BlockInvalidStateTransition,
            encodedProof: abi.encode(proof),
            participant: participants[0]
        });
        context = FraudProofVerificationContext({channelId: CHANNEL_ID});
    }

    function _honestProof(address[] memory participants)
        internal
        pure
        returns (FraudProof[] memory, FraudProofVerificationContext memory)
    {
        return _proof(participants, abi.encodeCall(MathStateMachine.add, (1)));
    }

    function _burnProof(address[] memory participants)
        internal
        pure
        returns (FraudProof[] memory, FraudProofVerificationContext memory)
    {
        return _proof(participants, abi.encodeCall(GasHungryMathStateMachine.burn, ()));
    }

    function _guardedProof(address[] memory participants)
        internal
        pure
        returns (FraudProof[] memory, FraudProofVerificationContext memory)
    {
        return _proof(participants, abi.encodeCall(GasHungryMathStateMachine.guardedAdd, ()));
    }

    function test_applyFraudProofs_refusesUnderfundedCheapReplay() public {
        address[] memory participants = _deploy(false);
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _honestProof(participants);

        vm.expectPartialRevert(ErrorInsufficientGasForStateTransition.selector);
        diamond.applyFraudProofs{gas: UNDERFUNDED_GAS}(proofs, context);
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    function test_applyFraudProofs_fundedCheapReplayKeepsHonestAuthor() public {
        address[] memory participants = _deploy(false);
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _honestProof(participants);

        diamond.applyFraudProofs{gas: FUNDED_GAS}(proofs, context);
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]), "honest author kept standing");
    }

    function test_applyFraudProofs_refusesUnderfundedGuardedReplay() public {
        address[] memory participants = _deployGuarded();
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _guardedProof(participants);

        vm.expectPartialRevert(ErrorInsufficientGasForStateTransition.selector);
        diamond.applyFraudProofs{gas: GUARDED_UNDERFUNDED_GAS}(proofs, context);
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    function test_applyFraudProofs_fundedGuardedReplayKeepsHonestAuthor() public {
        address[] memory participants = _deployGuarded();
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _guardedProof(participants);

        diamond.applyFraudProofs{gas: GUARDED_FUNDED_GAS}(proofs, context);
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    // The SDK sends a replay with its estimate plus getStateTransitionReplayGas. The measured cost
    // of a funded run stands in for the estimate: alone it cannot fund the replay, with the replay
    // gas added it always does.
    function test_getStateTransitionReplayGas_fundsReplayOnTopOfItsCost() public {
        address[] memory participants = _deployGuarded();
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _guardedProof(participants);
        bytes memory call = abi.encodeCall(diamond.applyFraudProofs, (proofs, context));

        uint256 snapshot = vm.snapshotState();
        uint256 before = gasleft();
        (bool funded,) = address(diamond).call{gas: GUARDED_FUNDED_GAS}(call);
        uint256 cost = before - gasleft();
        assertTrue(funded);
        vm.revertToState(snapshot);

        (bool costOnly, bytes memory refusal) = address(diamond).call{gas: cost}(call);
        assertFalse(costOnly, "the cost alone leaves the replay under its stipend");
        assertEq(bytes4(refusal), ErrorInsufficientGasForStateTransition.selector);

        (bool withReplayGas,) = address(diamond).call{gas: cost + diamond.getStateTransitionReplayGas()}(call);
        assertTrue(withReplayGas);
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    // With too little gas left for the machine frame to even read its gas, the frame fails with
    // empty returndata; the manager refuses that instead of reading it as a failed transition.
    function test_executeStateTransition_refusesAnOutOfGasMachineFrame() public {
        address[] memory participants = _deploy(false);
        bytes memory encodedState = _encodedState(participants);
        Transaction memory transaction = _transaction(participants[0], abi.encodeCall(MathStateMachine.add, (1)));
        bytes memory call = abi.encodeCall(diamond.executeStateTransition, (CHANNEL_ID, encodedState, transaction));

        bool sawFrameOutOfGas;
        for (uint256 gas = 20_000; gas < 400_000 && !sawFrameOutOfGas; gas += 1_000) {
            vm.prank(address(diamond));
            (bool ok, bytes memory result) = address(diamond).call{gas: gas}(call);
            assertFalse(ok, "never runs below its stipend");
            sawFrameOutOfGas = result.length >= 4 && bytes4(result) == ErrorStateTransitionFrameOutOfGas.selector;
        }
        assertTrue(sawFrameOutOfGas);
    }

    function test_applyFraudProofs_underfundedOutOfGasRevertsInsteadOfAdjudicating() public {
        address[] memory participants = _deploy(true);
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _burnProof(participants);

        vm.expectPartialRevert(ErrorInsufficientGasForStateTransition.selector);
        diamond.applyFraudProofs{gas: UNDERFUNDED_GAS}(proofs, context);
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    function test_applyFraudProofs_fundedOutOfGasIsFraud() public {
        address[] memory participants = _deploy(true);
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _burnProof(participants);

        diamond.applyFraudProofs{gas: FUNDED_GAS}(proofs, context);
        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]), "over-budget transition is fraud");
    }

    // Whatever gas the submitter attaches, the honest author is never slashed: the call either
    // adjudicates on a sufficiently funded replay or fails without a verdict.
    function testFuzz_applyFraudProofs_attachedGasNeverFlipsHonestVerdict(uint256 gas) public {
        gas = bound(gas, 100_000, FUNDED_GAS);
        address[] memory participants = _deploy(false);
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _honestProof(participants);

        (bool ok,) = address(diamond).call{gas: gas}(abi.encodeCall(diamond.applyFraudProofs, (proofs, context)));
        ok; // both outcomes are allowed; only the verdict is constrained
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    // Whatever gas the submitter attaches, a transition that catches an inner out-of-gas never
    // turns an honest block into fraud.
    function testFuzz_applyFraudProofs_attachedGasNeverFlipsGuardedVerdict(uint256 gas) public {
        gas = bound(gas, 100_000, GUARDED_FUNDED_GAS);
        address[] memory participants = _deployGuarded();
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _guardedProof(participants);

        (bool ok,) = address(diamond).call{gas: gas}(abi.encodeCall(diamond.applyFraudProofs, (proofs, context)));
        ok; // both outcomes are allowed; only the verdict is constrained
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    // Deleting the previous transition's messages happens before the gas check and is paid by the
    // caller outside the budget: funded with only the requirement, a transition after many
    // leftover messages is refused (no verdict); funded for the deletion as well, it runs on its
    // full budget. Storage is cold, as in a later transaction.
    function test_stateTransition_callerPaysForDeletingManyPreviousOutboundMessages() public {
        address[] memory participants = _deployGuarded();
        stateMachine.setState(_encodedState(participants));
        stateMachine.stateTransition{gas: GUARDED_FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.recordExits, (40)))
        );
        assertEq(stateMachine.getOutboundMessages().length, 40);
        uint256 requirement = stateMachine.getStateTransitionGasRequirement();
        bytes memory call = abi.encodeCall(
            stateMachine.stateTransition,
            (_transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.recordEntryGas, (""))))
        );

        uint256 snapshot = vm.snapshotState();
        vm.cool(address(stateMachine));
        (bool requirementOnly, bytes memory refusal) = address(stateMachine).call{gas: requirement}(call);
        assertFalse(requirementOnly, "the deletion is not paid from the requirement");
        assertEq(bytes4(refusal), ErrorInsufficientGasForStateTransition.selector);
        vm.revertToState(snapshot);

        vm.cool(address(stateMachine));
        (bool ok, bytes memory result) = address(stateMachine).call{gas: requirement + 2_000_000}(call);
        assertTrue(ok, "funded for the deletion too, the transition runs");
        (, Message[] memory messages) = abi.decode(result, (bool, Message[]));
        assertEq(messages.length, 0);
        assertGe(GasHungryMathStateMachine(address(stateMachine)).lastEntryGas(), GUARDED_BUDGET - 20_000);
    }

    // What an earlier call left behind never makes a transition more expensive: previous messages
    // are deleted before the gas check, so the same message-producing transition gives the same
    // messages and spends at most what it spends on empty storage (a slot that held data at the
    // start of the transaction is cheaper to write again, EIP-2200), after a few very long messages
    // and after a few short ones (storage cold each time).
    function test_stateTransition_previousOutboundMessagesNeverRaiseTheTransitionsCost() public {
        address[] memory participants = _deployGuarded();
        Transaction memory measured =
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.recordMessagesMeasured, (3, 64)));
        uint256[3] memory previousCounts = [uint256(0), 3, 2];
        uint256[3] memory previousLengths = [uint256(0), 4096, 8];
        uint256 firstCost;
        bytes32 firstMessages;
        for (uint256 i = 0; i < 3; i++) {
            uint256 snapshot = vm.snapshotState();
            stateMachine.setState(_encodedState(participants));
            stateMachine.stateTransition{gas: GUARDED_FUNDED_GAS}(
                _transaction(
                    participants[0],
                    abi.encodeCall(GasHungryMathStateMachine.recordMessages, (previousCounts[i], previousLengths[i]))
                )
            );
            vm.cool(address(stateMachine));
            (bool success, Message[] memory messages) = stateMachine.stateTransition{gas: GUARDED_FUNDED_GAS}(measured);
            assertTrue(success);
            uint256 cost = GasHungryMathStateMachine(address(stateMachine)).lastTransitionGas();
            if (i == 0) {
                firstCost = cost;
                firstMessages = keccak256(abi.encode(messages));
            } else {
                assertLe(cost, firstCost, "history made the transition more expensive");
                assertEq(keccak256(abi.encode(messages)), firstMessages);
            }
            vm.revertToState(snapshot);
        }
    }

    // With many leftover messages in the machine's storage, no attached gas turns an honest block
    // into fraud: the deletion either fits beside the full budget or the replay is refused.
    function testFuzz_applyFraudProofs_leftoverOutboundMessagesNeverFlipHonestVerdict(uint256 gas) public {
        gas = bound(gas, 100_000, GUARDED_FUNDED_GAS);
        address[] memory participants = _deployGuarded();
        stateMachine.setState(_encodedState(participants));
        stateMachine.stateTransition{gas: GUARDED_FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.recordMessages, (20, 256)))
        );
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _guardedProof(participants);

        (bool ok,) = address(diamond).call{gas: gas}(abi.encodeCall(diamond.applyFraudProofs, (proofs, context)));
        ok; // both outcomes are allowed; only the verdict is constrained
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    function test_stateTransition_reportsOnlyThisTransitionsMessagesAfterALongerList() public {
        address[] memory participants = _deploy(true);
        stateMachine.setState(_encodedState(participants));
        stateMachine.stateTransition{gas: FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.recordExits, (3)))
        );
        (, Message[] memory messages) = stateMachine.stateTransition{gas: FUNDED_GAS}(
            _transaction(participants[0], abi.encodeCall(GasHungryMathStateMachine.recordExits, (1)))
        );
        assertEq(messages.length, 1);
        assertEq(messages[0].balance.amount, 1);
        assertEq(stateMachine.getOutboundMessages().length, 1);
        assertEq(stateMachine.getOutboundMessages()[0].participant, address(1));
    }

    // A transition that runs is always granted its full budget, whatever the size of its input:
    // the input is copied before the gas check, so the copy cannot shrink the forwarded gas.
    function testFuzz_stateTransition_grantsFullBudgetForAnyInputSize(uint256 gasOffset, uint256 inputLength) public {
        address[] memory participants = _deploy(true);
        stateMachine.setState(_encodedState(participants));
        inputLength = bound(inputLength, 0, 128 * 1024);
        uint256 requirement = stateMachine.getStateTransitionGasRequirement();
        uint256 gas = bound(gasOffset, requirement - 300_000, requirement + 300_000);
        Transaction memory transaction = _transaction(
            participants[0], abi.encodeCall(GasHungryMathStateMachine.recordEntryGas, (new bytes(inputLength)))
        );

        (bool ok,) = address(stateMachine).call{gas: gas}(abi.encodeCall(stateMachine.stateTransition, (transaction)));
        if (ok) {
            uint256 entryGas = GasHungryMathStateMachine(address(stateMachine)).lastEntryGas();
            // the callee's own dispatch and calldata decoding spend a little before `gasleft()`
            assertGe(entryGas, SM_GAS_LIMIT - 20_000, "transition ran on less than its budget");
        }
    }

    // Neither the attached gas nor the size of the transition's input turns an honest block into
    // fraud: copying a large input must be paid before the gas check, not taken from the stipend.
    function testFuzz_applyFraudProofs_inputSizeNeverFlipsGuardedVerdict(uint256 gas, uint256 inputLength) public {
        gas = bound(gas, 100_000, GUARDED_FUNDED_GAS);
        inputLength = bound(inputLength, 0, 128 * 1024);
        address[] memory participants = _deployGuarded();
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _proof(
            participants, abi.encodeCall(GasHungryMathStateMachine.guardedAddWithInput, (new bytes(inputLength)))
        );

        (bool ok,) = address(diamond).call{gas: gas}(abi.encodeCall(diamond.applyFraudProofs, (proofs, context)));
        ok; // both outcomes are allowed; only the verdict is constrained
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]));
    }

    // Whatever gas the submitter attaches, an over-budget transition is never acquitted: every
    // call that produces a verdict produces the fraud verdict, and every other call fails.
    function testFuzz_applyFraudProofs_attachedGasNeverFlipsFraudVerdict(uint256 gas) public {
        gas = bound(gas, 100_000, FUNDED_GAS);
        address[] memory participants = _deploy(true);
        (FraudProof[] memory proofs, FraudProofVerificationContext memory context) = _burnProof(participants);

        (bool ok,) = address(diamond).call{gas: gas}(abi.encodeCall(diamond.applyFraudProofs, (proofs, context)));
        assertEq(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[0]), ok);
    }
}
