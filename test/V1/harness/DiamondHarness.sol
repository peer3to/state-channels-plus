pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
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

abstract contract DiamondHarness is Test {
    MathStateMachine internal stateMachine;
    UtilityFacet internal utilityFacet;
    FraudProofFacet internal fraudProofFacet;
    MathConsumerFacet internal consumerFacet;

    // non-zero so tests check against a known value, not the contract default
    uint256 internal constant P2P_TIME = 100;
    uint256 internal constant SM_GAS_LIMIT = 3_000_000;

    function deployDiamond() internal returns (StateChannelManagerProxy diamond) {
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

        diamond = new StateChannelManagerProxy(
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
        );
    }

    // must match UtilityFacet.retrieveSignerAddress: EIP-191 over keccak256(encodedData)
    function _sign(uint256 pk, bytes memory encodedBlock) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(keccak256(encodedBlock)));
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
}
