pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import {MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract DisputeVerificationFacetTest is DiamondHarness {
    StateChannelManagerProxy internal diamond;

    bytes32 internal constant CHANNEL_ID = keccak256("dv-channel");
    bytes32 internal constant FORK_ID = keccak256("dv-fork");

    function setUp() public {
        diamond = deployDiamond();
    }

    // reduce() must not OOB-panic when dispute.input.onChainSlashes.length exceeds
    // participants + pending (maxSlashCount).
    function test_reduce_oversizedOnChainSlashes_doesNotPanic() public {
        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;

        address[] memory fakeSlashes = new address[](20);
        for (uint256 i = 0; i < 20; i++) {
            fakeSlashes[i] = address(uint160(i + 1));
        }
        disputes[0].input.onChainSlashes = fakeSlashes;

        // maxSlashCount = 0 (no channel open → no participants) → extra slashes are skipped
        ReduceOutput memory out = diamond.reduce(disputes);
        assertEq(out.slashedParticipants.length, 0);
    }

    // slashedParticipants in the output must never exceed participants + pending,
    // regardless of what a dispute claims in onChainSlashes.
    function testFuzz_reduce_slashedParticipantsNeverExceedsMaxSlashCount(uint8 slashCount) public {
        vm.assume(slashCount > 0);

        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;

        address[] memory fakeSlashes = new address[](slashCount);
        for (uint256 i = 0; i < slashCount; i++) {
            fakeSlashes[i] = address(uint160(i + 1));
        }
        disputes[0].input.onChainSlashes = fakeSlashes;

        ReduceOutput memory out = diamond.reduce(disputes);
        // no open channel → maxSlashCount = 0; output must always be within that bound
        assertEq(out.slashedParticipants.length, 0);
    }

    function test_computeDisputeOutputState_timeoutOnly_removesTimedOutParticipant() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.timeout.participant = participants[2];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[0]);
        assertEq(output[1], participants[1]);
    }

    function test_computeDisputeOutputState_slashOnly_removesSlashedParticipant() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.slashedParticipants = new address[](1);
        reducedOutput.slashedParticipants[0] = participants[0];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[1]);
        assertEq(output[1], participants[2]);
    }

    function test_computeDisputeOutputState_slashAndTimeout_ignoresTimeout() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.slashedParticipants = new address[](1);
        reducedOutput.slashedParticipants[0] = participants[0];
        reducedOutput.timeout.participant = participants[2];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[1]);
        assertEq(output[1], participants[2]);
    }

    function test_computeDisputeOutputState_slashTimeoutAndSelfRemoval_ignoresTimeout() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.slashedParticipants = new address[](1);
        reducedOutput.slashedParticipants[0] = participants[0];
        reducedOutput.timeout.participant = participants[2];
        reducedOutput.selfRemovals = new address[](1);
        reducedOutput.selfRemovals[0] = participants[1];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 1);
        assertEq(output[0], participants[2]);
    }

    function _participants() internal pure returns (address[] memory participants) {
        participants = new address[](3);
        participants[0] = address(0xA1);
        participants[1] = address(0xA2);
        participants[2] = address(0xA3);
    }

    function _outputParticipants(ReduceOutput memory reducedOutput, address[] memory participants)
        internal
        returns (address[] memory)
    {
        MathState memory state;
        state.participants = participants;
        state.balances = new uint256[](participants.length);
        StateSnapshot memory snapshot;
        bytes memory encodedState = abi.encode(state);
        snapshot.snapshotData.stateMachineStateHash = keccak256(encodedState);
        MessageBlock[] memory inboundMessageBlocks = new MessageBlock[](0);
        (, bytes memory encodedModifiedState,) = diamond.reduceOutputToSnapshotData(
            keccak256(abi.encode(snapshot.snapshotData)), reducedOutput, snapshot, encodedState, inboundMessageBlocks
        );
        return abi.decode(encodedModifiedState, (MathState)).participants;
    }
}
