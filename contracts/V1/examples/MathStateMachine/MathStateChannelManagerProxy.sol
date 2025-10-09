// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import "../../StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import "./MathStateMachine.sol";
import "./MathConsumerFacet.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract MathStateChannelManagerProxy is StateChannelManagerProxy {
    constructor(
        address aStateMachineAddress,
        address disputeManagerFacet,
        address disputeVerificationFacet,
        address fraudProofFacet,
        address disputeFraudProofFacet,
        address stateSnapshotFacet,
        address joinChannelFacet,
        address utilityFacet,
        address mathConsumerFacet
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
            mathConsumerFacet
        )
    {
        p2pTime = 5;
        agreementTime = 5;
        chainFallbackTime = 5;
        evidenceTime = 5;
    }
}
