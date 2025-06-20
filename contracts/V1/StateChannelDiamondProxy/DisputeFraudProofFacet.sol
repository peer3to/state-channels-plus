pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "../types/DisputeFraudProofTypes.sol";

contract DisputeFraudProofFacet is StateChannelCommon {
    mapping(
        DisputeFraudProofType
            => function(bytes memory encodedFraudProof, Dispute memory dispute) internal returns (address)
    ) private proofHandlers;

    constructor() {
        //If we endup having too many fraud proofs, we'll refactor them into a seperate 'facet' (ERC-2535)
        proofHandlers[DisputeFraudProofType.TimeoutThreshold] = _handleTimeoutThreshold;
        proofHandlers[DisputeFraudProofType.TimeoutPriorInvalid] = _handleTimeoutPriorInvalid;
        proofHandlers[DisputeFraudProofType.DisputeInvalidPreviousRecursive] = _handleDisputeInvalidPreviousRecursive;
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
        view
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleTimeoutPriorInvalid(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
        returns (address)
    {
        //TODO
        return dispute.disputer;
    }

    function _handleDisputeInvalidPreviousRecursive(bytes memory encodedFraudProof, Dispute memory dispute)
        internal
        view
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

    // function _handleTimeoutPriorInvalid(
    //     bytes memory encodedProof,
    //     FraudProofVerificationContext memory fraudProofVerificationContext
    // ) internal view returns (address) {
    //     TimeoutPriorInvalidProof memory timeoutPriorInvalidProof = abi.decode(encodedProof, (TimeoutPriorInvalidProof));
    //     Dispute memory originalDispute = timeoutPriorInvalidProof.originalDispute;
    //     Dispute memory recursiveDispute = timeoutPriorInvalidProof.recursiveDispute;

    //     if (
    //         recursiveDispute.channelId != originalDispute.channelId
    //             && recursiveDispute.channelId != fraudProofVerificationContext.channelId
    //     ) {
    //         revert ErrorNotSameChannelId();
    //     }
    //     // check if the recursive dispute is available
    //     bytes32 recursiveDisputeCommitment =
    //         keccak256(abi.encode(recursiveDispute, timeoutPriorInvalidProof.recursiveDisputeTimestamp));
    //     bytes32 originalDisputeCommitment =
    //         keccak256(abi.encode(originalDispute, timeoutPriorInvalidProof.originalDisputeTimestamp));

    //     (bool isAvailable, bytes32 commitment) =
    //         getDisputeCommitment(fraudProofVerificationContext.channelId, recursiveDispute.disputeIndex);

    //     if (!isAvailable && commitment != recursiveDisputeCommitment) {
    //         revert ErrorDisputeCommitmentNotAvailable();
    //     }
    //     if (
    //         recursiveDispute.previousRecursiveDisputeIndex == type(uint256).max
    //             || recursiveDispute.previousRecursiveDisputeIndex == originalDispute.disputeIndex
    //     ) {
    //         revert ErrorDisputeCommitmentNotAvailable();
    //     }

    //     // check if the previous recursive dispute is available
    //     (bool isOriginalDisputeAvailable, bytes32 originalCommitment) =
    //         getDisputeCommitment(fraudProofVerificationContext.channelId, originalDispute.disputeIndex);
    //     if (!isOriginalDisputeAvailable && originalCommitment != originalDisputeCommitment) {
    //         revert ErrorDisputeCommitmentNotAvailable();
    //     }

    //     // check if the original timeout is greater than the recursive timeout
    //     if (originalDispute.timeout.blockHeight <= recursiveDispute.timeout.blockHeight) {
    //         revert ErrorInvalidBlock();
    //     }

    //     return recursiveDispute.disputer;
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
