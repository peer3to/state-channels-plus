pragma solidity ^0.8.8;

import "./StateChannelManagerProxy.sol";
import "./UtilityFacet.sol";
import "../types/DataTypes.sol";
import "../types/DisputeTypes.sol";
import "../types/MessageTypeHashes.sol";
import "../StateChannelManagerEvents.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";
import "./utils/GeneralUtils.sol";
import "hardhat/console.sol";

/**
 * @title LocalDiamond
 * @dev Local implementation of the diamond proxy.
 * It runs the protocol's pure checks over supplied data; it holds no copy of the chain's channel state.
 *
 */
contract LocalDiamond is StateChannelManagerProxy {
    constructor(
        address _stateMachineImplementation,
        address _disputeManagerFacet,
        address _disputeVerificationFacet,
        address _fraudProofFacet,
        address _disputeFraudProofFacet,
        address _stateSnapshotFacet,
        address _joinChannelFacet,
        address _stateProofFacet,
        address _utilityFacet,
        uint256 _p2pTime,
        uint256 _agreementTime,
        uint256 _chainFallbackTime,
        uint256 _evidenceTime,
        uint256 _disputeExecutionGasLimit,
        uint256 _maxChannelParticipants
    )
        StateChannelManagerProxy(
            _stateMachineImplementation,
            _disputeManagerFacet,
            _disputeVerificationFacet,
            _fraudProofFacet,
            _disputeFraudProofFacet,
            _stateSnapshotFacet,
            _joinChannelFacet,
            _stateProofFacet,
            _utilityFacet,
            address(0), // Use 0x00 for consumer facet in local environment
            _p2pTime,
            _agreementTime,
            _chainFallbackTime,
            _evidenceTime,
            _disputeExecutionGasLimit,
            _maxChannelParticipants
        )
    {}

    function computeDisputeOutputSnapshotData(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (SnapshotData memory outputSnapshotData) {
        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.computeDisputeOutputSnapshotData,
            (disputeInput, latestStateSnapshot, latestStateMachineState, inboundMessageBlocks)
        );

        outputSnapshotData = abi.decode(_delegateDisputeExecution(data), (SnapshotData));
    }

    function computeDisputeOutputState(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (DisputeOutputState memory outputState) {
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.computeDisputeOutputState,
            (disputeInput, latestStateSnapshot, latestStateMachineState, inboundMessageBlocks)
        );

        outputState = abi.decode(_delegateDisputeExecution(data), (DisputeOutputState));
    }

    function checkDisputeAuditingDataCommitment(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        view
        returns (bool)
    {
        // The underlying function is pure, so no need for a delegatecall
        return DisputeVerificationFacet(disputeVerificationFacetAddress)
            .checkDisputeAuditingDataCommitment(dispute, disputeAuditingData);
    }

    function isBlockAuthorParticipant(
        Block memory _block,
        StateSnapshot memory previousSnapshot,
        StateSnapshot memory resultingSnapshot
    ) public pure returns (bool) {
        return _isBlockAuthorParticipant(_block, previousSnapshot, resultingSnapshot);
    }

    // function isCorrectAuditingData(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
    //     public
    //     view
    //     returns (bool)
    // {
    //     // The underlying function is pure, so no need for a delegatecall
    //     return
    //         DisputeVerificationFacet(disputeVerificationFacetAddress)
    //             .isCorrectAuditingData(dispute, disputeAuditingData);
    // }

    function isDisputeOutputCorrect(
        Dispute memory dispute,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestFinalizedStateStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (bool) {
        // Encode the function selector and arguments
        bytes memory data = abi.encodeCall(
            DisputeVerificationFacet.isDisputeOutputCorrect,
            (dispute, latestStateSnapshot, latestFinalizedStateStateMachineState, inboundMessageBlocks)
        );
        return abi.decode(_delegateDisputeExecution(data), (bool));
    }

    /**
     * Runs `data` on the dispute verification facet within the dispute
     * execution gas limit and returns its result. A frame that used up the
     * forwarded budget (all but the 1/64 a nested call leaves it) without
     * return data reverts with
     * ErrorDisputeExecutionOutOfGas; any other failure is re-thrown as is.
     */
    function _delegateDisputeExecution(bytes memory data) internal returns (bytes memory returnData) {
        uint256 gasLimit = _getGasLimit();
        address target = disputeVerificationFacetAddress;
        bool success;
        uint256 gasBefore;
        uint256 gasAfter;
        uint256 returnSize;
        assembly ("memory-safe") {
            gasBefore := gas()
            success := delegatecall(gasLimit, target, add(data, 0x20), mload(data), 0, 0)
            gasAfter := gas()
            returnSize := returndatasize()
        }
        returnData = new bytes(returnSize);
        assembly ("memory-safe") {
            returndatacopy(add(returnData, 0x20), 0, returndatasize())
        }
        if (success) return returnData;
        uint256 gasUsed = gasBefore - gasAfter;
        // The frame receives at most all but 1/64 of the remaining gas (EIP-150).
        // An out-of-gas inside a nested call (e.g. a state machine call) leaves
        // the facet the 1/64 it kept; `forwarded / 64` covers it, and 5_000 covers
        // the call's own cost before the frame starts.
        uint256 forwarded = gasLimit < gasBefore - gasBefore / 64 ? gasLimit : gasBefore - gasBefore / 64;
        if (returnData.length == 0 && gasUsed + forwarded / 64 + 5_000 >= forwarded) {
            revert ErrorDisputeExecutionOutOfGas(gasLimit, gasUsed);
        }
        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }

    function getLatestBlockFromStateProof(StateProof memory stateProof)
        public
        pure
        returns (bool hasBlock, Block memory)
    {
        return _getLatestBlock(stateProof);
    }

    function hasDisputeReason(DisputeInput memory input, StateSnapshot memory latestStateSnapshot)
        public
        pure
        returns (bool)
    {
        return _hasDisputeReason(input, latestStateSnapshot);
    }

    function isDisputeInboundAnchorBehindLatestState(Dispute memory dispute, StateSnapshot memory latestStateSnapshot)
        public
        pure
        returns (bool)
    {
        return _isDisputeInboundAnchorBehindLatestState(dispute, latestStateSnapshot);
    }

    /// The state-proof walk from a locally trusted final snapshot instead of the mirrored anchor (local only).
    function verifyMilestonesFromTrustedStart(ProofWalkInput memory input, StateSnapshot memory trustedSnapshot)
        public
        view
        returns (ProofWalkResult memory)
    {
        return _walkStateProof(input, trustedSnapshot);
    }

    // ========== Override for debugging - Browser compatible console logs ==========

    function _isBlockAuthentic(SignedBlock memory _block) internal view override returns (bool) {
        (bool decoded, Block memory decodedBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(_block.encodedBlock);
        if (!decoded) {
            console.log("isBlockAuthentic - false - 1");
            return false;
        }
        (address signer, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(_block.encodedBlock, _block.signature);
        if (signer != decodedBlock.transaction.header.participant || !isValid) {
            console.log("isBlockAuthentic - false - 2");
            return false;
        }
        return true;
    }
}
