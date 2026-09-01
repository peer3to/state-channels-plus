// @spec-test-coverage-ignore: shared Foundry diamond deployment harness exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DisputeManagerFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {FraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {StateSnapshotFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol";
import {JoinChannelFacet} from "../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {MathConsumerFacet} from "../../../contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol";

import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

abstract contract DiamondHarness is Test {
    MathStateMachine internal stateMachine;
    UtilityFacet internal utilityFacet;
    FraudProofFacet internal fraudProofFacet;
    MathConsumerFacet internal consumerFacet;
    StateChannelManagerInterface internal deployedDiamond;

    // non-zero so tests check against a known value, not the contract default
    uint256 internal constant P2P_TIME = 100;
    uint256 internal constant SM_GAS_LIMIT = 3_000_000;

    /// @dev Returns the diamond typed as its full external surface: the proxy
    /// implements only a few selectors itself and routes the rest to facets.
    function deployDiamond() internal returns (StateChannelManagerInterface diamond) {
        stateMachine = new MathStateMachine(SM_GAS_LIMIT);
        DisputeManagerFacet disputeManager = new DisputeManagerFacet();
        DisputeVerificationFacet disputeVerification = new DisputeVerificationFacet();
        fraudProofFacet = new FraudProofFacet();
        DisputeFraudProofFacet disputeFraudProof = new DisputeFraudProofFacet();
        StateSnapshotFacet stateSnapshot = new StateSnapshotFacet();
        JoinChannelFacet joinChannel = new JoinChannelFacet();
        StateProofFacet stateProof = new StateProofFacet();
        utilityFacet = new UtilityFacet();
        consumerFacet = new MathConsumerFacet();

        diamond = StateChannelManagerInterface(
            address(
                new StateChannelManagerProxy(
                    address(stateMachine),
                    address(disputeManager),
                    address(disputeVerification),
                    address(fraudProofFacet),
                    address(disputeFraudProof),
                    address(stateSnapshot),
                    address(joinChannel),
                    address(stateProof),
                    address(utilityFacet),
                    address(consumerFacet),
                    P2P_TIME,
                    0, // agreementTime  -> contract default
                    0, // chainFallbackTime -> default
                    0, // evidenceTime -> default
                    0 // disputeExecutionGasLimit -> default
                )
            )
        );
        deployedDiamond = diamond;
    }

    function _sign(uint256 pk, bytes memory encodedBlock) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(encodedBlock)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _makeSignedBlock(
        uint256 pk,
        bytes32 channelId,
        bytes32 forkId,
        uint256 transactionCnt,
        uint256 timestamp,
        bytes32 previousBlockHash
    ) internal pure returns (SignedBlock memory) {
        Block memory b;
        b.transaction.header.channelId = channelId;
        b.transaction.header.participant = vm.addr(pk);
        b.transaction.header.forkId = forkId;
        b.transaction.header.transactionCnt = transactionCnt;
        b.transaction.header.timestamp = timestamp;
        b.previousBlockHash = previousBlockHash;
        bytes memory enc = abi.encode(b);
        return SignedBlock({encodedBlock: enc, signature: _sign(pk, enc)});
    }

    function _makeSignedGenesisBlock(
        uint256 pk,
        bytes32 channelId,
        bytes32 forkId,
        uint256 timestamp,
        bytes32 previousBlockHash
    ) internal pure returns (SignedBlock memory) {
        return _makeSignedBlock(pk, channelId, forkId, 0, timestamp, previousBlockHash);
    }

    function _openChannel(bytes32 channelId, uint256[] memory participantPrivateKeys) internal {
        OpenChannel memory openChannel;
        openChannel.channelId = channelId;
        openChannel.participants = new address[](participantPrivateKeys.length);
        openChannel.balances = new Balance[](participantPrivateKeys.length);
        openChannel.deadlineTimestamp = block.timestamp + 1 days;
        openChannel.isAtomic = true;

        for (uint256 i = 0; i < participantPrivateKeys.length; i++) {
            openChannel.participants[i] = vm.addr(participantPrivateKeys[i]);
            openChannel.balances[i] = Balance({amount: 0, data: ""});
        }

        bytes memory encodedOpenChannel = abi.encode(openChannel);
        bytes[] memory signatures = new bytes[](participantPrivateKeys.length);
        for (uint256 i = 0; i < participantPrivateKeys.length; i++) {
            signatures[i] = _sign(participantPrivateKeys[i], encodedOpenChannel);
        }

        deployedDiamond.open(OpenChannelConfirmation({encodedOpenChannel: encodedOpenChannel, signatures: signatures}));
    }

    function _makeFinalCloseSnapshot(bytes32 channelId, address[] memory participants, uint256[] memory pks)
        internal
        view
        returns (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots)
    {
        require(participants.length == pks.length && participants.length >= 2, "invalid close participants");

        StateSnapshot memory currentSnapshot = deployedDiamond.getStateSnapshot(channelId);
        StateSnapshot memory finalSnapshot = currentSnapshot;
        finalSnapshot.snapshotData.participants = new address[](0);
        finalSnapshot.blockHeight = currentSnapshot.blockHeight + 1;
        finalSnapshot.timestamp = currentSnapshot.timestamp + 1;

        Block memory finalBlock;
        finalBlock.transaction.header.channelId = channelId;
        finalBlock.transaction.header.participant = participants[0];
        finalBlock.transaction.header.forkId = currentSnapshot.forkId;
        finalBlock.transaction.header.transactionCnt = finalSnapshot.blockHeight;
        finalBlock.transaction.header.timestamp = finalSnapshot.timestamp;
        finalBlock.stateSnapshotHash = keccak256(abi.encode(finalSnapshot));

        bytes memory encodedBlock = abi.encode(finalBlock);
        BlockConfirmation memory confirmation;
        confirmation.signedBlock = SignedBlock({encodedBlock: encodedBlock, signature: _sign(pks[0], encodedBlock)});
        confirmation.signatures = new bytes[](pks.length - 1);
        for (uint256 i = 1; i < pks.length; i++) {
            confirmation.signatures[i - 1] = _sign(pks[i], encodedBlock);
        }

        proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](1);
        proofs[0].blockConfirmations[0] = confirmation;
        snapshots = new StateSnapshot[](1);
        snapshots[0] = finalSnapshot;
    }
}
