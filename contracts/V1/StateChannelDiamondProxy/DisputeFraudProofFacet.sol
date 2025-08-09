pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "../types/DisputeFraudProofTypes.sol";
import "./utils/DisputeUtils.sol";

contract DisputeFraudProofFacet is StateChannelCommon {
    mapping(DisputeFraudProofType => function(bytes memory, Dispute memory) internal returns (address)) private
        proofHandlers;

    constructor() {
        //If we endup having too many fraud proofs, we'll refactor them into a seperate 'facet' (ERC-2535)
        proofHandlers[DisputeFraudProofType.TimeoutThreshold] = _handleTimeoutThreshold;
        proofHandlers[DisputeFraudProofType.TimeoutCalldataPosted] = _handleTimeoutCalldataPosted;
        proofHandlers[DisputeFraudProofType.TimeoutParticipantNotNext] = _handleTimeoutParticipantNotNext;
        proofHandlers[DisputeFraudProofType.TimeoutTooEarly] = _handleTimeoutTooEarly;
        proofHandlers[DisputeFraudProofType.DisputeNotLatestState] = _handleDisputeNotLatestState;
        proofHandlers[DisputeFraudProofType.DisputeInvalid] = _handleDisputeInvalid;
        proofHandlers[DisputeFraudProofType.DisputeInvalidRecursive] = _handleDisputeInvalidRecursive;
        proofHandlers[DisputeFraudProofType.DisputeOutOfGas] = _handleDisputeOutOfGas;
        proofHandlers[DisputeFraudProofType.DisputeInvalidOutputState] = _handleDisputeInvalidOutputState;
        proofHandlers[DisputeFraudProofType.DisputeInvalidStateProof] = _handleDisputeInvalidStateProof;
        proofHandlers[DisputeFraudProofType.DisputeInvalidPreviousRecursive] = _handleDisputeInvalidPreviousRecursive;
        proofHandlers[DisputeFraudProofType.DisputeInvalidExitChannelBlocks] = _handleDisputeInvalidExitChannelBlocks;
    }

    //This is a bit inefficient, since public/external functions always do a deep copy unlike internal/private that pas by reference, but this shares the context
    function verifyDisputeFraudProofs(DisputeFraudProof[] memory disputeFraudProofs)
        public
        returns (Dispute[] memory maliciousDisputes)
    {
        maliciousDisputes = new Dispute[](disputeFraudProofs.length);
        uint256 slashCount = 0;
        for (uint256 i = 0; i < disputeFraudProofs.length; i++) {
            Dispute memory dispute = disputeFraudProofs[i].dispute;
            if (!isDisputeCommitted(dispute)) continue;
            address slashedParticipant =
                proofHandlers[disputeFraudProofs[i].proofType](disputeFraudProofs[i].encodedProof, dispute);
            if (slashedParticipant == address(0) || slashedParticipant != disputeFraudProofs[i].participant) {
                revert ErrorInvalidFraudProof();
            }
            maliciousDisputes[slashCount] = dispute;
            slashCount++;
        }
        Dispute[] memory finalDisputes = new Dispute[](slashCount);
        for (uint256 i = 0; i < slashCount; i++) {
            finalDisputes[i] = maliciousDisputes[i];
        }
        return finalDisputes;
    }

    // ----------------------------------- Timeout Fraud Proofs -----------------------------------

    function _handleTimeoutThreshold(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        TimeoutThresholdProof memory timeoutThresholdProof = abi.decode(encodedFraudProof, (TimeoutThresholdProof));
        SignedBlock memory signedBlock = timeoutThresholdProof.thresholdBlock.signedBlock;
        bytes memory encodedBlock = signedBlock.encodedBlock;
        Block memory thresholdBlock = abi.decode(encodedBlock, (Block));

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, thresholdBlock)) revert();

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, thresholdBlock)) revert();

        // Check timeout == thresholdBlock
        if (dispute.timeout.blockHeight != _getBlockHeight(thresholdBlock)) revert();

        //check correct snapshot
        if (!_doesBlockCommitToSnapshot(thresholdBlock, timeoutThresholdProof.latestStateSnapshot)) revert();

        //check threshold
        address[] memory thresholdParticipants = timeoutThresholdProof.latestStateSnapshot.snapshotData.participants;
        bytes[] memory signatures = StateChannelUtilLibrary.insertBytesInByteArray(
            signedBlock.signature, timeoutThresholdProof.thresholdBlock.signatures
        );
        (bool isValid,) = StateChannelUtilLibrary.verifyThresholdSigned(thresholdParticipants, encodedBlock, signatures);
        if (!isValid) revert();

        return dispute.disputer;
    }

    function _handleTimeoutCalldataPosted(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        TimeoutCalldataPostedProof memory timeoutCalldataPostedProof =
            abi.decode(encodedFraudProof, (TimeoutCalldataPostedProof));
        Block memory postedBlock = timeoutCalldataPostedProof.postedBlock;

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, postedBlock)) revert();

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, postedBlock)) revert();

        // Check timeout == postedBlock
        if (dispute.timeout.blockHeight != _getBlockHeight(postedBlock)) revert();

        // Check timeout participant == block author
        if (dispute.timeout.participant != _getBlockAuthor(postedBlock)) revert();

        // Check block calldata posted
        (bool isFound,) = getBlockCallDataCommitment(
            _getDisputeChannel(dispute),
            _getDisputeFork(dispute),
            dispute.timeout.blockHeight,
            dispute.timeout.participant
        );
        if (!isFound) revert();

        return dispute.disputer;
    }

    function _handleTimeoutParticipantNotNext(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //Can be part of auditing instead of doing it here
        Block memory latestBlock = _getLatestBlock(dispute.stateProof);
        if (_getBlockAuthor(latestBlock) == dispute.timeout.participant) revert();

        return dispute.disputer;
    }

    function _handleTimeoutTooEarly(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeNotLatestState(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        DisputeNotLatestStateProof memory disputeNotLatestStateProof =
            abi.decode(encodedFraudProof, (DisputeNotLatestStateProof));
        Block memory newerBlock = abi.decode(disputeNotLatestStateProof.encodedBlock, (Block));
        Block memory latestBlock = _getLatestBlock(dispute.stateProof);

        // Check channelId
        if (!_areDisputeAndBlockSameChannel(dispute, newerBlock) || !_areBlocksSameChannel(newerBlock, latestBlock)) {
            revert();
        }

        // Check forkId
        if (!_areDisputeAndBlockSameFork(dispute, newerBlock) || !_areBlocksSameFork(newerBlock, latestBlock)) revert();

        // Check is block newer
        if (_getBlockHeight(newerBlock) <= _getBlockHeight(latestBlock)) revert();

        // Check siganture
        address retrivedAddress = StateChannelUtilLibrary.retriveSignerAddress(
            disputeNotLatestStateProof.encodedBlock, disputeNotLatestStateProof.signature
        );
        if (retrivedAddress != dispute.disputer) revert();

        return dispute.disputer;
    }

    function _handleDisputeInvalid(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeInvalidRecursive(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeOutOfGas(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeInvalidOutputState(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeInvalidStateProof(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeInvalidPreviousRecursive(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeInvalidExitChannelBlocks(bytes memory, /* encodedFraudProof */ Dispute memory dispute)
        internal
        pure
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    // function _handleTimeoutThreshold(
    //     bytes memory encodedProof,
    //     FraudProofVerificationContext memory fraudProofVerificationContext
    // ) internal view returns (address) {
    //     TimeoutThresholdProof memory timeoutThresholdProof = abi.decode(encodedProof, (TimeoutThresholdProof));
    //     BlockConfirmation memory thresholdBlockConfirmation = timeoutThresholdProof.thresholdBlock;
    //     Block memory thresholdBlock = abi.decode(thresholdBlockConfirmation.signedBlock.encodedBlock, (Block));
    //     Dispute memory originalTimedOutDispute = timeoutThresholdProof.timedOutDispute;

    //     bytes32 originalDisputeCommitment =
    //         keccak256(abi.encode(originalTimedOutDispute, timeoutThresholdProof.timedOutDisputeTimestamp));

    //     (bool isAvailable, bytes32 commitment) =
    //         getDisputeCommitment(fraudProofVerificationContext.channelId, originalTimedOutDispute.disputeIndex);
    //     if (!isAvailable && commitment != originalDisputeCommitment) {
    //         return address(0);
    //     }
    //     if (originalTimedOutDispute.latestStateSnapshotHash != keccak256(timeoutThresholdProof.latestStateSnapshot)) {
    //         revert ErrorIncorrectLatestStateSnapshot();
    //     }
    //     address[] memory participants =
    //         abi.decode(timeoutThresholdProof.latestStateSnapshot, (StateSnapshot)).participants;

    //     if (
    //         thresholdBlock.transaction.header.forkId != originalTimedOutDispute.timeout.forkId
    //             && thresholdBlock.transaction.header.transactionCnt != originalTimedOutDispute.timeout.blockHeight
    //     ) {
    //         revert ErrorInvalidBlock();
    //     }
    //     // check signatures
    //     bytes[] memory singleSignerArray = new bytes[](1);
    //     singleSignerArray[0] = thresholdBlockConfirmation.signedBlock.signature;
    //     bytes[] memory signatures =
    //         StateChannelUtilLibrary.concatBytesArrays(thresholdBlockConfirmation.signatures, singleSignerArray);
    //     address[] memory signers = StateChannelUtilLibrary.concatAddressArrays(
    //         participants,
    //         _collectBlockConfirmationAddresses(thresholdBlockConfirmation.signedBlock.encodedBlock, signatures)
    //     );

    //     (bool isVerified, string memory errorMessage) = StateChannelUtilLibrary.verifyThresholdSigned(
    //         signers, thresholdBlockConfirmation.signedBlock.encodedBlock, signatures
    //     );
    //     if (!isVerified) {
    //         revert ErrorInvalidBlock();
    //     }
    //     if (keccak256(abi.encode(participants)) != keccak256(abi.encode(signers))) {
    //         revert ErrorInvalidBlock();
    //     }
    //     // If calldata check also fails, return false with the last error message
    //     return originalTimedOutDispute.disputer;
    // }

    // ------------------------------------ Dispute Fraud Proofs ------------------------------------

    // function _collectBlockConfirmationAddresses(bytes memory encodedBlock, bytes[] memory signatures)
    //     internal
    //     pure
    //     returns (address[] memory confirmationAddress)
    // {
    //     address[] memory collectedAddresses = new address[](signatures.length);
    //     for (uint256 i = 0; i < signatures.length; i++) {
    //         address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, signatures[i]);
    //         collectedAddresses[i] = signer;
    //     }
    //     return collectedAddresses;
    // }
}
