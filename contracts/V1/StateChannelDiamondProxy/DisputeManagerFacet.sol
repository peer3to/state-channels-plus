pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./DisputeErrors.sol";

contract DisputeManagerFacet is StateChannelCommon {
    //stateless
    function applySlashesToStateMachine(
        bytes memory encodedState,
        address[] memory slashedParticipants
    )
        internal
        virtual
        returns (
            bytes memory encodedModifiedState,
            ProcessExit[] memory,
            uint successCnt
        )
    {
        return
            AStateChannelManagerProxy(address(this)).applySlashesToStateMachine(
                encodedState,
                slashedParticipants
            );
    }

    //stateless
    function removeParticipantsFromStateMachine(
        bytes memory encodedState,
        address[] memory participants
    )
        internal
        virtual
        returns (
            bytes memory encodedModifiedState,
            ProcessExit[] memory,
            uint successCnt
        )
    {
        return
            AStateChannelManagerProxy(address(this))
                .removeParticipantsFromStateMachine(encodedState, participants);
    }

    function getDispute(
        bytes32 channelId
    ) public view returns (Dispute memory) {
        return disputes[channelId];
    }

    function createDispute(
        bytes32 channelId,
        uint forkCnt,
        bytes memory encodedLatestFinalizedState,
        bytes memory encodedLatestCorrectState,
        ConfirmedBlock[] memory virtualVotingBlocks,
        address timedoutParticipant,
        uint foldedTransactionCnt,
        Proof[] memory proofs
    ) public {
        require(!isDisputeInProgress(channelId), ErrorDisputeInProgrees());
        require(getForkCnt(channelId) == forkCnt, ErrorDisputeForkMismatch());
        address[] memory participants = getParticipants(channelId, forkCnt);
        bool isParticipant = StateChannelUtilLibrary.isAddressInArray(
            participants,
            msg.sender
        );
        require(isParticipant, ErrorNotParticipant());

        require(
            isFinalizedAndLatest(
                channelId,
                forkCnt,
                encodedLatestFinalizedState,
                encodedLatestCorrectState,
                virtualVotingBlocks,
                participants
            ),
            ErrorLatestFinalizedBlock()
        );
        if (timedoutParticipant != address(0)) {
            //Check if participant posted BLOCK onChain as calldata
            uint latestTimestamp = getGenesisTimestamp(channelId, forkCnt);
            if (foldedTransactionCnt != 0) {
                Block memory lastBlock = abi.decode(
                    virtualVotingBlocks[virtualVotingBlocks.length - 1]
                        .encodedBlock,
                    (Block)
                );
                require(
                    lastBlock.transaction.header.transactionCnt ==
                        foldedTransactionCnt - 1,
                    ErrorTimeoutNotLinkedToPreviousBlock()
                );
                latestTimestamp = lastBlock.transaction.header.timestamp;
            }
            require(
                timedoutParticipant ==
                    getNextToWrite(channelId, encodedLatestCorrectState),
                ErrorTimeoutParticipantNotNextToWrite()
            );
            (bool found, ) = getBlockCallData(
                channelId,
                forkCnt,
                foldedTransactionCnt,
                timedoutParticipant
            );
            if (!found) {
                //Check folding timestamp
                uint lastBlockTimestamp = getChainLatestBlockTimestamp(
                    channelId,
                    forkCnt,
                    foldedTransactionCnt
                );
                if (lastBlockTimestamp > latestTimestamp)
                    latestTimestamp = lastBlockTimestamp;
                if (
                    block.timestamp <
                    latestTimestamp +
                        getP2pTime() +
                        getAgreementTime() +
                        getChainFallbackTime()
                ) {
                    timedoutParticipant = address(0);
                }
            } else {
                timedoutParticipant = address(0);
            }
            require(timedoutParticipant != address(0), ErrorTimeoutInvalid());
            require(timedoutParticipant != msg.sender, ErrorTimeoutSelf());
        }
        Dispute storage dispute = disputes[channelId];
        dispute.channelId = channelId;
        dispute.forkCnt = forkCnt;
        dispute.challengeCnt = 0; //this can be removed - default value
        dispute.foldedTransactionCnt = foldedTransactionCnt;
        copyConfirmedBlockArrayIntoStorage(
            dispute.virtualVotingBlocks,
            virtualVotingBlocks
        );
        dispute.encodedLatestFinalizedState = encodedLatestFinalizedState;
        dispute.encodedLatestCorrectState = encodedLatestCorrectState;
        dispute.timedoutParticipant = timedoutParticipant;
        if (dispute.timedoutParticipant != address(0))
            dispute.timeoutDisputer = msg.sender;
        dispute.postedStateDisputer = msg.sender;
        // dispute.slashedParticipants = []; //default empty array
        dispute.participants = participants;
        dispute.creationTimestamp = block.timestamp;
        dispute.deadlineTimestamp = block.timestamp + getChallengeTime();
        //apply proofs
        bool success = applyProofs(dispute, proofs);
        require(
            success || dispute.timedoutParticipant != address(0),
            ErrorDisputeInvalid()
        );
        applyDisputeToLatestState(dispute);
        setState(dispute.channelId, dispute.encodedLatestCorrectState);
        emit DisputeUpdated(channelId, dispute);
    }

    function challengeDispute(
        bytes32 channelId,
        uint forkCnt,
        uint challengeCnt,
        Proof[] memory proofs,
        ConfirmedBlock[] memory virtualVotingBlocks,
        bytes memory encodedLatestFinalizedState,
        bytes memory encodedLatestCorrectState
    ) public {
        Dispute storage dispute = disputes[channelId];
        require(dispute.channelId != bytes32(0), ErrorDisputeDoesntExist());
        require(dispute.forkCnt == forkCnt, ErrorDisputeForkMismatch());
        require(
            dispute.challengeCnt == challengeCnt,
            ErrorDisputeChallengeMismatch()
        );
        require(
            dispute.deadlineTimestamp > block.timestamp,
            ErrorDisputeExpired()
        );

        bool isParticipant = StateChannelUtilLibrary.isAddressInArray(
            dispute.participants,
            msg.sender
        );
        require(isParticipant, ErrorNotParticipant());
        bool notSlashed = true;
        for (uint i = 0; i < dispute.slashedParticipants.length; i++) {
            if (dispute.slashedParticipants[i] == msg.sender) {
                notSlashed = false;
                break;
            }
        }
        require(notSlashed, ErrorParticipantAlredySlashed());
        require(applyProofs(dispute, proofs), ErrorDisputeInvalid());

        //Modify dispute with new data
        require(
            isFinalizedAndLatest(
                dispute.channelId,
                dispute.forkCnt,
                encodedLatestFinalizedState,
                encodedLatestCorrectState,
                virtualVotingBlocks,
                dispute.participants
            ),
            ErrorLatestFinalizedBlock()
        );
        Block memory oldBlock = abi.decode(
            dispute.virtualVotingBlocks[0].encodedBlock,
            (Block)
        );
        Block memory newBlock = abi.decode(
            virtualVotingBlocks[0].encodedBlock,
            (Block)
        );
        require(
            newBlock.transaction.header.transactionCnt >=
                oldBlock.transaction.header.transactionCnt,
            ErrorChallengeNewFinalizedBeforeOldFinalized()
        );
        copyConfirmedBlockArrayIntoStorage(
            dispute.virtualVotingBlocks,
            virtualVotingBlocks
        );
        dispute.encodedLatestFinalizedState = encodedLatestFinalizedState;
        dispute.encodedLatestCorrectState = encodedLatestCorrectState;
        dispute.postedStateDisputer = msg.sender;
        dispute.deadlineTimestamp = block.timestamp + getChallengeTime();
        dispute.challengeCnt++;

        applyDisputeToLatestState(dispute);
        setState(dispute.channelId, dispute.encodedLatestCorrectState);
        emit DisputeUpdated(channelId, dispute);
    }

    function applyDisputeToLatestState(Dispute storage dispute) internal {
        bytes memory latestEncodedState = dispute.encodedLatestCorrectState;
        uint successCnt = 0;

        // Clear processExits
        delete dispute.processExits;

        // 2.1) Shrink the set of participants - apply slashes
        ProcessExit[] memory processExits;
        (
            latestEncodedState,
            processExits,
            successCnt
        ) = applySlashesToStateMachine(
            latestEncodedState,
            dispute.slashedParticipants
        );
        for (uint i = 0; i < successCnt; i++)
            dispute.processExits.push(processExits[i]);

        // 2.2) Shrink the set of participants - apply leaveChannelForce requests
        (
            latestEncodedState,
            processExits,
            successCnt
        ) = removeParticipantsFromStateMachine(
            latestEncodedState,
            dispute.leaveChannelParticipants
        );
        for (uint i = 0; i < successCnt; i++)
            dispute.processExits.push(processExits[i]);

        // 2.3) Shrink the set of participants - apply timeout
        if (dispute.timedoutParticipant != address(0)) {
            address[] memory arr = new address[](1);
            arr[0] = dispute.timedoutParticipant;
            (
                latestEncodedState,
                processExits,
                successCnt
            ) = removeParticipantsFromStateMachine(latestEncodedState, arr);
            for (uint i = 0; i < successCnt; i++)
                dispute.processExits.push(processExits[i]);
        }
        dispute.encodedLatestCorrectState = latestEncodedState;
    }

    function applyProofs(
        Dispute storage dispute,
        Proof[] memory proof
    ) private returns (bool) {
        bool atLeastOneSuccess = false;
        for (uint i = 0; i < proof.length; i++) {
            if (proof[i].proofType == ProofType.FoldRechallenge) {
                FoldRechallengeProof memory foldRechallengeProof = abi.decode(
                    proof[i].encodedProof,
                    (FoldRechallengeProof)
                );
                atLeastOneSuccess =
                    applyFoldRechallengeProof(dispute, foldRechallengeProof) ||
                    atLeastOneSuccess;
            }
        }
        bool isSlashed = false;
        for (uint i = 0; i < dispute.slashedParticipants.length; i++) {
            if (dispute.slashedParticipants[i] == msg.sender) {
                isSlashed = true;
                break;
            }
        }
        require(!isSlashed, ErrorSlashedParticipantCantDispute());
        return atLeastOneSuccess;
    }

    function applyFoldRechallengeProof(
        Dispute storage dispute,
        FoldRechallengeProof memory foldRechallengeProof
    ) private returns (bool) {
        Block memory _block = abi.decode(
            foldRechallengeProof.encodedBlock,
            (Block)
        );
        require(
            _block.transaction.header.channelId == dispute.channelId,
            ErrorChannelIdMismatch()
        );
        require(
            _block.transaction.header.forkCnt == dispute.forkCnt,
            ErrorDisputeForkMismatch()
        );
        require(
            _block.transaction.header.transactionCnt ==
                dispute.foldedTransactionCnt,
            ErrorTransactionCountMismatch()
        );
        (bool succeeds, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            dispute.participants,
            foldRechallengeProof.encodedBlock,
            foldRechallengeProof.signatures
        );
        require(succeeds, ErrorSignatureInvalid());
        dispute.timedoutParticipant = address(0); //Undo the fold
        return
            insertIfNotExist(
                dispute.slashedParticipants,
                dispute.timeoutDisputer
            );
    }

    function tryCancelFold(
        Dispute storage dispute,
        uint successfulProofTransactionCnt
    ) internal {
        if (successfulProofTransactionCnt < dispute.foldedTransactionCnt) {
            dispute.timedoutParticipant = address(0);
            dispute.timeoutDisputer = address(0);
        }
    }

    function insertIfNotExist(
        address[] storage array,
        address adr
    ) private returns (bool) {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == adr) return false;
        }
        array.push(adr);
        return true;
    }

    function isFinalizedAndLatest(
        bytes32 channelId,
        uint forkCnt,
        bytes memory encodedFinalizedState,
        bytes memory encodedLatestCorrectState,
        ConfirmedBlock[] memory virtualVotingBlocks,
        address[] memory thresholdSingers
    ) private view returns (bool) {
        bool isGenesis = isGenesisState(
            channelId,
            forkCnt,
            encodedFinalizedState
        );

        //Check through virtual voting and treshold
        bytes32 finalizedStateHash = keccak256(encodedFinalizedState);
        bytes32 previousStateHash = finalizedStateHash; //assume genesis
        address[] memory addressesInThreshold = new address[](
            thresholdSingers.length
        );
        uint countThreshold = 0;
        for (uint i = 0; i < virtualVotingBlocks.length; i++) {
            Block memory _block = abi.decode(
                virtualVotingBlocks[i].encodedBlock,
                (Block)
            );

            require(
                _block.transaction.header.channelId == channelId,
                ErrorChannelIdMismatch()
            );
            require(
                _block.transaction.header.forkCnt == forkCnt,
                ErrorDisputeForkMismatch()
            );

            bool isSignedByParticipant = false;
            for (
                uint j = 0;
                j < virtualVotingBlocks[i].signatures.length;
                j++
            ) {
                address retrivedAddress = StateChannelUtilLibrary
                    .retriveSignerAddress(
                        virtualVotingBlocks[i].encodedBlock,
                        virtualVotingBlocks[i].signatures[j]
                    );
                if (retrivedAddress == _block.transaction.header.participant) {
                    isSignedByParticipant = true;
                }
                countThreshold = StateChannelUtilLibrary
                    .tryInsertAddressInThresholdSet(
                        retrivedAddress,
                        addressesInThreshold,
                        countThreshold,
                        thresholdSingers
                    );
            }
            require(
                isSignedByParticipant,
                ErrorFinalizedAndLatestNotSignedByParticipant()
            );
            if (i == 0 && !isGenesis) {
                //check initial finalzed state
                //if genesis -> linked to genesis
                // if not genesis -> linked to previous block which we don't have -> just check if commits to the state it wants to finalize
                require(
                    finalizedStateHash == _block.stateHash,
                    ErrorFinalizedAndLatestFirstBlockNotVotingForFinalizedState()
                );
            } else {
                //check linked
                //if genesis -> previousStateHash should start as keccak(genesis)
                require(
                    previousStateHash == _block.previousStateHash,
                    ErrorFinalizedAndLatestSecondBlocksNotLinked()
                );
            }
            if (i == virtualVotingBlocks.length - 1) {
                //check latest state
                require(
                    _block.stateHash == keccak256(encodedLatestCorrectState),
                    ErrorFinalizedAndLatestLastBlockNotVoringForLatestState()
                );
            }
            previousStateHash = _block.stateHash;
        }

        return isGenesis || countThreshold == thresholdSingers.length;
    }

    function copyConfirmedBlockArrayIntoStorage(
        ConfirmedBlock[] storage _storage,
        ConfirmedBlock[] memory _memory
    ) internal {
        for (uint i = 0; i < _memory.length; i++) {
            _storage.push(_memory[i]);
        }
    }
}
