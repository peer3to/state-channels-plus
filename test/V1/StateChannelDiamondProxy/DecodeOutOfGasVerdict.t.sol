pragma solidity ^0.8.8;

import {StateProofStaging, _emptyMessageBlocks} from "../harness/StateProofStaging.sol";
import {ErrorBlockDecodeOutOfGas} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {DisputeFraudProofType} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// sweep gas below the full verdict: every call reverts or reaches the full-gas verdict
contract DecodeOutOfGasVerdictTest is StateProofStaging {
    /// gas limits probed below the full verdict's cost
    uint256 private constant PROBES = 150;

    function setUp() public {
        _stageGenesisChannel();
    }

    /// dishonest: heavy block 6, block 7 unlinked -> true challenge at 7
    function test_underfundedTrueChallengeAtABlockAfterAHeavyPredecessorIsNoVerdict() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _heavyRun(1);
        _breakLinkAt(run, 2);
        _assertPointerGasDecidesNothing(run, anchor, 2, true);
    }

    /// dishonest: heavy run start 5, block 7 unlinked -> true challenge at 7
    function test_underfundedTrueChallengeAtABlockAfterAHeavyFirstBlockIsNoVerdict() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _heavyRun(0);
        _breakLinkAt(run, 2);
        _assertPointerGasDecidesNothing(run, anchor, 2, true);
    }

    /// honest: heavy block 7 -> false challenge never kills
    function test_underfundedFalseChallengeAtAHeavyHonestBlockIsNoVerdict() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _heavyRun(2);
        _assertPointerGasDecidesNothing(run, anchor, 2, false);
    }

    /// honest: heavy latest block 8 (latest-state check) -> false challenge at 6 never kills
    function test_underfundedFalseChallengeAtAHeavyHonestLatestBlockIsNoVerdict() public {
        (MilestoneProof memory run, StateSnapshot memory anchor) = _heavyRun(3);
        _assertPointerGasDecidesNothing(run, anchor, 1, false);
    }

    /// honest: heavy block 7 -> false structure challenge never kills
    function test_underfundedFalseBlockStructureChallengeAtAHeavyHonestBlockIsNoVerdict() public {
        (MilestoneProof memory run,) = _heavyRun(2);
        _assertGasDecidesNothing(
            _dispute(_one(run)), DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(2), false
        );
    }

    /// dishonest: heavy run start 5, block 7 unlinked -> true structure challenge at 7
    function test_underfundedTrueBlockStructureChallengeAfterAHeavyFirstBlockIsNoVerdict() public {
        (MilestoneProof memory run,) = _heavyRun(0);
        _breakLinkAt(run, 2);
        _assertGasDecidesNothing(
            _dispute(_one(run)), DisputeFraudProofType.DisputeInvalidBlockStructure, _structureProof(2), true
        );
    }

    /// dishonest: heavy last block 8 names another fork -> true header challenge
    function test_underfundedTrueHeaderChallengeAtAHeavyLastBlockIsNoVerdict() public {
        _seedAnchor(5);
        MilestoneProof memory run = _run(3, 6, keccak256("block 2"), _signers(ALICE_KEY));
        _otherForkAt(run, 5);
        _makeHeavy(run, 5);
        _assertGasDecidesNothing(
            _dispute(_one(run)), DisputeFraudProofType.DisputeStateProofHeaderMismatch, _headerMismatchProof(), true
        );
    }

    /// dishonest: heavy block 7 commits another snapshot than final state 7 -> true conflict challenge
    function test_underfundedTrueConflictChallengeAtAHeavyBlockIsNoVerdict() public {
        (MilestoneProof memory run,) = _heavyRun(2);
        _commitAt(run, 2, keccak256("a forked state at 7"), _signers(ALICE_KEY));
        StateSnapshot[] memory sevenEntries = _entries(_snapshot(7, genesisData.participants));
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_hopRun(sevenEntries[0], 1, _signers(ALICE_KEY, BOB_KEY))), sevenEntries);
        _assertGasDecidesNothing(
            _dispute(_one(run)),
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 2),
            true
        );
    }

    /// dishonest: block 7 dated before heavy block 6 -> true invalid-timestamp proof
    function test_underfundedTrueTimestampProofAfterAHeavyPredecessorIsNoVerdict() public {
        (MilestoneProof memory run,) = _heavyRun(1);
        _backdateAt(run, 2, _signers(ALICE_KEY));
        _assertGasDecidesNothing(
            _dispute(_one(run)),
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            _applyProof(_invalidTimestampAt(run, 2), 2),
            true
        );
    }

    /// the anchor run 5..8 from the anchor 5, block `heavyIndex` carrying the heavy inbound payload
    function _heavyRun(uint256 heavyIndex) private returns (MilestoneProof memory run, StateSnapshot memory anchor) {
        anchor = _seedAnchor(5);
        run = _run(5, 4, keccak256("block 4"), _signers(ALICE_KEY));
        _makeHeavy(run, heavyIndex);
    }

    /// block `blockIndex` gets 50x10 empty messages; later blocks relinked
    function _makeHeavy(MilestoneProof memory run, uint256 blockIndex) private view {
        Block memory b = _decode(run, blockIndex);
        b.messageBlocks = _emptyMessageBlocks(50, 10);
        _replaceBlock(run, blockIndex, b, _signers(_keyOf(b.transaction.header.participant)));
    }

    function _assertPointerGasDecidesNothing(
        MilestoneProof memory run,
        StateSnapshot memory anchor,
        uint256 blockIndex,
        bool killed
    ) private {
        _assertGasDecidesNothing(
            _dispute(_one(run)),
            DisputeFraudProofType.DisputeInvalidStateProof,
            _invalidBlockStep(_entries(anchor), 0, blockIndex),
            killed
        );
    }

    /// full gas -> `killed`; less -> revert or same verdict; guard hit at least once
    function _assertGasDecidesNothing(
        Dispute memory dispute,
        DisputeFraudProofType proofType,
        bytes memory proof,
        bool killed
    ) private {
        _commit(dispute);
        bytes memory data = abi.encodeCall(harness.applyDisputeFraudProofs, (_oneProof(dispute, proofType, proof)));

        uint256 state = vm.snapshotState();
        uint256 before = gasleft();
        (bool landed,) = _challenge(data, 30_000_000);
        assertTrue(landed, "the funded challenge lands");
        uint256 fullGas = before - gasleft();
        bool killedAtFull = harness.commitmentCount(CHANNEL, forkId) == 0;
        assertEq(killedAtFull, killed, "the full-gas verdict");
        vm.revertToState(state);

        uint256 guardReverts;
        uint256 step = fullGas / PROBES;
        for (uint256 gasLimit = step; gasLimit < fullGas; gasLimit += step) {
            state = vm.snapshotState();
            (bool ok, bytes4 selector) = _challenge(data, gasLimit);
            if (ok) {
                assertEq(
                    harness.commitmentCount(CHANNEL, forkId) == 0,
                    killedAtFull,
                    string.concat("verdict flipped at gas limit ", vm.toString(gasLimit))
                );
                assertEq(harness.isSlashed(CHANNEL, bob), !killedAtFull, "challenger slashing follows the verdict");
            } else if (selector == ErrorBlockDecodeOutOfGas.selector) {
                guardReverts++;
            }
            vm.revertToState(state);
        }
        assertGt(guardReverts, 0, "the sweep crosses the decode guard");
    }

    /// B sends `data` with `gasLimit`; copies only the revert selector (no memory growth)
    function _challenge(bytes memory data, uint256 gasLimit) private returns (bool ok, bytes4 selector) {
        address target = address(harness);
        vm.prank(bob);
        assembly ("memory-safe") {
            ok := call(gasLimit, target, 0, add(data, 32), mload(data), 0, 0)
            mstore(0, 0)
            if gt(returndatasize(), 3) { returndatacopy(0, 0, 4) }
            selector := mload(0)
        }
    }
}
