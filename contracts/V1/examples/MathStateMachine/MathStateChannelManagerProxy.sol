// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "../../StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import "../../StateChannelDiamondProxy/utils/GeneralUtils.sol";
import "../../types/DataTypes.sol";
import "./MathStateMachine.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract MathStateChannelManagerProxy is StateChannelManagerProxy {
    uint256 private constant DEFAULT_P2P_TIME = 15;
    uint256 private constant DEFAULT_AGREEMENT_TIME = 5;
    uint256 private constant DEFAULT_CHAIN_FALLBACK_TIME = 30;
    uint256 private constant DEFAULT_EVIDENCE_TIME = 30;

    constructor(
        address aStateMachineAddress,
        address disputeManagerFacet,
        address disputeVerificationFacet,
        address fraudProofFacet,
        address disputeFraudProofFacet,
        address stateSnapshotFacet,
        address joinChannelFacet,
        address utilityFacet,
        address mathConsumerFacet,
        uint256 _p2pTime,
        uint256 _agreementTime,
        uint256 _chainFallbackTime,
        uint256 _evidenceTime
    )
        StateChannelManagerProxy(
            aStateMachineAddress,
            disputeManagerFacet,
            disputeVerificationFacet,
            fraudProofFacet,
            disputeFraudProofFacet,
            stateSnapshotFacet,
            joinChannelFacet,
            utilityFacet,
            mathConsumerFacet,
            _p2pTime == 0 ? DEFAULT_P2P_TIME : _p2pTime,
            _agreementTime == 0 ? DEFAULT_AGREEMENT_TIME : _agreementTime,
            _chainFallbackTime == 0 ? DEFAULT_CHAIN_FALLBACK_TIME : _chainFallbackTime,
            _evidenceTime == 0 ? DEFAULT_EVIDENCE_TIME : _evidenceTime
        )
    {}
}
