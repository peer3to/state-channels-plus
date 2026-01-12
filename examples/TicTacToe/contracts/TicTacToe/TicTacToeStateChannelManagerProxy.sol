// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "@peer3/state-channels-plus/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";

/**
 * @dev Thin wrapper around the V1 diamond-style channel manager.
 *      Keeping this contract name preserves the example's TypeChain types.
 */
contract TicTacToeStateChannelManagerProxy is StateChannelManagerProxy {
    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _disputeVerificationFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet,
        address _utilityFacet,
        address _consumerFacet,
        uint256 _p2pTime,
        uint256 _agreementTime,
        uint256 _chainFallbackTime,
        uint256 _evidenceTime
    )
        StateChannelManagerProxy(
            _stateMachineImplementation,
            _disputeManagerFacet,
            _disputeVerificationFacet,
            _fraudProofFacet,
            _disputeFraudProofFacet,
            _stateSnapshotFacet,
            _joinChannelFacet,
            _utilityFacet,
            _consumerFacet,
            _p2pTime,
            _agreementTime,
            _chainFallbackTime,
            _evidenceTime
        )
    {}
}
