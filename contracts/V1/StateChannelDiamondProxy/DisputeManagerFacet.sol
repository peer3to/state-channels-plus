pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./DisputeErrors.sol";

contract DisputeManagerFacet is StateChannelCommon {
    /**
     *
     * Executes all composable operations on the global state (depositing funds, interacting with other contracts)
     * Should NOT modify the state channel state!
     * returns true on success, otherwise should revert or return false
     */
    function addParticipantComposable(
        JoinChannel memory joinChannel
    ) internal returns (bool) {
        return
            AStateChannelManagerProxy(address(this)).addParticipantComposable(
                joinChannel
            );
    }

    /**
     *
     * Executes all composable operations on the global state (depositing funds, interacting with other contracts)
     * Should NOT modify the state channel state!
     * returns true on success, otherwise should revert or return false
     */
    function removeParticipantComposable(
        bytes32 channelId,
        ProcessExit memory processExit
    ) internal returns (bool) {
        return
            AStateChannelManagerProxy(address(this))
                .removeParticipantComposable(channelId, processExit);
    }

    // function getNext
    //stateless
    function applyJoinChannelToStateMachine(
        bytes memory encodedState,
        JoinChannel[] memory joinCahnnels
    )
        internal
        virtual
        returns (bytes memory encodedModifiedState, uint successCnt)
    {
        return
            AStateChannelManagerProxy(address(this))
                .applyJoinChannelToStateMachine(encodedState, joinCahnnels);
    }

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

    function executeStateTransitionOnState(
        bytes32 channelId,
        bytes memory encodedState,
        Transaction memory _tx
    ) public virtual returns (bool, bytes memory) {
        return
            AStateChannelManagerProxy(address(this))
                .executeStateTransitionOnState(channelId, encodedState, _tx);
    }

    

    function _handleBlockFraudProofs(
       
    ) internal {
      
       

    }

    function _handleDisputeFraudProofs(
        // core specific checks
        // apply proofs
        // apply dispute to latest state
        // set state
    ) internal {

    }

    function _handleTimeoutDispute(

    ) internal {

    }

    function createDispute(
        bytes32 channelId,
        uint forkCnt,
        bytes calldata encodedLatestState,
        StateProof[] calldata stateProofs,
        address[] calldata onChainSlashes,
        Proof[] calldata proofs
    ) public { 
        // sanity checks
        if(onChainSlashes.length != onChainSlashedParticipants.length 
        || onChainSlashes[onChainSlashes.length - 1] != onChainSlashedParticipants[onChainSlashedParticipants.length - 1]) {
            revert("onChainSlashes does not match onChainSlashedParticipants");
        }
        if(proofs.length == 0) return;

        // verify latest state
        address[] memory participants = getParticipants(channelId, forkCnt);
        // check if its genesis
        if(stateProofs.length == 0) {
           bool isGenesis = isGenesisState(channelId, forkCnt, encodedLatestState); 
           if(!isGenesis) {
            revert("latest state is not valid");
           }
        }else{
            _verifyStateProof(encodedLatestState, stateProofs, participants);
        }

        //handle proof based on type
        for(uint i = 0; i < proofs.length; i++) {
            Proof memory proof = proofs[i];
            
            if (_isBlockFraudProof(proof.proofType)) {
                _handleBlockFraudProofs();

            } else if (_isTimeoutProof(proof.proofType)) {
                _handleTimeoutDispute();

            } else if (_isDisputeFraudProof(proof.proofType)) {
                _handleDisputeFraudProofs();
            }
        }

    }

    function _verifyStateProof(bytes memory encodedLatesState, StateProof[] memory stateProofs, address[] memory participants) internal {
        _verifySignedBlocks(stateProofs[0].signedBlocks, stateProofs[0].forkProof, encodedLatesState, participants);
        for(uint i = 1; i < stateProofs.length; i++) {
            _verifyForkProof(stateProofs[i].forkProof, participants);
        }
    }

    function _verifySignedBlocks(SignedBlock[] memory signedBlocks, ForkProof memory forkProof, bytes memory encodedLatestState, address[] memory participants) internal {
        for (uint i = signedBlocks.length - 1; i > 0; i--) {
            // Get current and previous blocks
            Block memory currentBlock = abi.decode(signedBlocks[i].encodedBlock, (Block));
            Block memory previousBlock = abi.decode(signedBlocks[i-1].encodedBlock, (Block));
            
            if(i == signedBlocks.length - 1 && currentBlock.stateHash != keccak256(encodedLatestState)) {
                revert("Latest state does not connect to last signed block");
            }
            require(
                currentBlock.previousStateHash == previousBlock.stateHash,
                "Parent hash mismatch"
            );
            // check if the first state connects to milestone block       
            Block memory lastMilestoneConfirmationBlock =
            abi.decode(
                forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1]
                .blockConfirmations[forkProof.forkMilestoneProofs[forkProof.forkMilestoneProofs.length - 1].blockConfirmations.length - 1].encodedBlock,
                (Block)
            );

            if(i == 1 && previousBlock.previousStateHash != lastMilestoneConfirmationBlock.stateHash) {
                revert("Latest state does not connect to milestone block");
            }
        }
        
    }

    function _verifyForkProof(ForkProof memory forkProof, address[] memory expectedAddresses) internal {
        // per each forkMilestoneProof we expect the signatures to reduce by 1
        uint expectedSignatures = expectedAddresses.length;
        // 1. verify forkMilestoneProofs
        for (uint i = 0; i < forkProof.forkMilestoneProofs.length; i++) {
        ForkMilestoneProof memory milestone = forkProof.forkMilestoneProofs[i];
        
            // Verify each block confirmation
            for (uint j = 0; j < milestone.blockConfirmations.length; j++) {
                BlockConfirmation memory confirmation = milestone.blockConfirmations[j];
                
                // Verify block signatures
                if(confirmation.signatures.length != expectedSignatures) {
                    revert("Invalid number of signatures");
                }
                // verify signatures are from peers in genesis state
                _verifyBlockConfirmationSignatures(
                    confirmation.encodedBlock,
                    expectedAddresses,
                    confirmation.signatures
                );
                expectedSignatures--;
            }
        }

    }

    function _verifyBlockConfirmationSignatures(bytes memory encodedBlock, address[] memory expectedAddresses, bytes[] memory signatures) internal {
        for (uint i = 0; i < signatures.length; i++) {
            address signer = StateChannelUtilLibrary.retriveSignerAddress(encodedBlock, signatures[i]);
            if(!StateChannelUtilLibrary.isAddressInArray(expectedAddresses, signer)) {
                revert("Invalid signature");
            }
        }
    }

    function _isBlockFraudProof(ProofType proofType) private pure returns (bool) {
    return proofType == ProofType.BlockDoubleSign ||
           proofType == ProofType.BlockEmptyBlock ||
           proofType == ProofType.BlockInvalidStateTransition ||
           proofType == ProofType.BlockOutOfGas;
    }

    function _isTimeoutProof(ProofType proofType) private pure returns (bool) {
    return proofType == ProofType.TimeoutThreshold ||
           proofType == ProofType.TimeoutPriorInvalid ||
           proofType == ProofType.TimeoutParticipantNoNext;
    }

    function _isDisputeFraudProof(ProofType proofType) private pure returns (bool) {
    return proofType == ProofType.DisputeNotLatestState ||
           proofType == ProofType.DisputeInvalid ||
           proofType == ProofType.DisputeInvalidRecursive ||
           proofType == ProofType.DisputeOutOfGas ||
           proofType == ProofType.DisputeInvalidOutputState ||
           proofType == ProofType.DisputeInvalidStateProof ||
           proofType == ProofType.DisputeInvalidPreeviousRecursive ||
           proofType == ProofType.DisputeInvalidExitChannelBlocks;
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
      // todo
    }

    function applyDisputeToLatestState(Dispute storage dispute) internal {
      // todo
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
                    } else if (proof[i].proofType == ProofType.DoubleSign) {
                DoubleSignProof memory doubleSignProof = abi.decode(
                    proof[i].encodedProof,
                    (DoubleSignProof)
                );
                atLeastOneSuccess =
                    applyDoubleSignProof(dispute, doubleSignProof) ||
                    atLeastOneSuccess;
            } else if (proof[i].proofType == ProofType.IncorrectData) {
                IncorrectDataProof memory incorrectDataProof = abi.decode(
                    proof[i].encodedProof,
                    (IncorrectDataProof)
                );
                atLeastOneSuccess =
                    applyIncorrectDataProof(dispute, incorrectDataProof) ||
                    atLeastOneSuccess;
            } else if (proof[i].proofType == ProofType.NewerState) {
                NewerStateProof memory newerStateProof = abi.decode(
                    proof[i].encodedProof,
                    (NewerStateProof)
                );
                atLeastOneSuccess =
                    applyNewerStateProof(dispute, newerStateProof) ||
                    atLeastOneSuccess;
            } else if (proof[i].proofType == ProofType.FoldPriorBlock) {
                FoldPriorBlockProof memory foldPriorBlockProof = abi.decode(
                    proof[i].encodedProof,
                    (FoldPriorBlockProof)
                );
                atLeastOneSuccess =
                    applyFoldPriorBlockProof(dispute, foldPriorBlockProof) ||
                    atLeastOneSuccess;
            } else if (proof[i].proofType == ProofType.BlockTooFarInFuture) {
                BlockTooFarInFutureProof memory blockTooFarInFutureProof = abi
                    .decode(proof[i].encodedProof, (BlockTooFarInFutureProof));
                atLeastOneSuccess =
                    applyBlockTooFarInFutureProof(
                        dispute,
                        blockTooFarInFutureProof
                    ) ||
                    atLeastOneSuccess;
            } else if (proof[i].proofType == ProofType.JoinChannel) {
                JoinChannelProof memory joinChannelProof = abi.decode(
                    proof[i].encodedProof,
                    (JoinChannelProof)
                );
                atLeastOneSuccess =
                    applyJoinChannelProof(dispute, joinChannelProof) ||
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

    function applyDoubleSignProof(
        Dispute storage dispute,
        DoubleSignProof memory doubleSignProof
    ) private returns (bool) {
        bool success = false;
        for (uint i = 0; i < doubleSignProof.doubleSigns.length; i++) {
            DoubleSign memory doubleSign = doubleSignProof.doubleSigns[i];
            Block memory block1 = abi.decode(
                doubleSign.block1.encodedBlock,
                (Block)
            );
            Block memory block2 = abi.decode(
                doubleSign.block2.encodedBlock,
                (Block)
            );
            require(
                block1.transaction.header.channelId == dispute.channelId &&
                    block2.transaction.header.channelId == dispute.channelId,
                ErrorChannelIdMismatch()
            );
            require(
                block1.transaction.header.forkCnt == dispute.forkCnt &&
                    block2.transaction.header.forkCnt == dispute.forkCnt,
                ErrorDisputeForkMismatch()
            );

            require(
                block1.transaction.header.transactionCnt ==
                    block2.transaction.header.transactionCnt,
                ErrorTransactionCountMismatch()
            );
            require(
                keccak256(doubleSign.block1.encodedBlock) !=
                    keccak256(doubleSign.block2.encodedBlock),
                ErrorDoubleSignBlocksAreSame()
            );

            address retrived1 = StateChannelUtilLibrary.retriveSignerAddress(
                doubleSign.block1.encodedBlock,
                doubleSign.block1.signature
            );
            address retrived2 = StateChannelUtilLibrary.retriveSignerAddress(
                doubleSign.block2.encodedBlock,
                doubleSign.block2.signature
            );
            require(retrived1 == retrived2, ErrorDoubleSignSignersNotTheSame());
            //If we're here - the proof is valid
            success =
                insertIfNotExist(dispute.slashedParticipants, retrived1) ||
                success;
            if (success)
                tryCancelFold(
                    dispute,
                    block1.transaction.header.transactionCnt
                );
        }
        return success;
    }

    function applyIncorrectDataProof(
        Dispute storage dispute,
        IncorrectDataProof memory incorrectDataProof
    ) private returns (bool) {
        Block memory block1 = abi.decode(
            incorrectDataProof.block1.encodedBlock,
            (Block)
        );
        Block memory block2 = abi.decode(
            incorrectDataProof.block2.encodedBlock,
            (Block)
        );
        //Check signature Block1 and Block2
        address retrived1 = StateChannelUtilLibrary.retriveSignerAddress(
            incorrectDataProof.block1.encodedBlock,
            incorrectDataProof.block1.signature
        );
        address retrived2 = StateChannelUtilLibrary.retriveSignerAddress(
            incorrectDataProof.block2.encodedBlock,
            incorrectDataProof.block2.signature
        );
        require(
            retrived1 == block1.transaction.header.participant &&
                retrived2 == block2.transaction.header.participant,
            ErrorSignatureInvalid()
        );
        require(
            block1.transaction.header.channelId == dispute.channelId &&
                block2.transaction.header.channelId == dispute.channelId,
            ErrorChannelIdMismatch()
        );
        require(
            block1.transaction.header.forkCnt == dispute.forkCnt &&
                block2.transaction.header.forkCnt == dispute.forkCnt,
            ErrorDisputeForkMismatch()
        );
        uint previousTimestamp;
        //If encodedState is genesis => Block2 is first block and block1 is just a copy of block2 and is ignored
        if (
            isGenesisState(
                dispute.channelId,
                dispute.forkCnt,
                incorrectDataProof.encodedState
            )
        ) {
            //if encoded state is genesis - block1 is ignored and block2 builds on genesis istead of block1
            require(
                block2.previousStateHash ==
                    keccak256(incorrectDataProof.encodedState),
                ErrorIncorrectDataStateHashNotLinkedToBlock(2)
            );
            previousTimestamp = getGenesisTimestamp(
                dispute.channelId,
                dispute.forkCnt
            );
        } else {
            //Not genesis - block2 builds on block1
            //Check linked
            require(
                block2.previousStateHash == block1.stateHash,
                ErrorIncorrectDataBlocksNotLinked()
            );
            require(
                block1.stateHash == keccak256(incorrectDataProof.encodedState),
                ErrorIncorrectDataStateHashNotLinkedToBlock(1)
            );
            previousTimestamp = block1.transaction.header.timestamp;
        }

        bool success = isGoodTimestampNonDeterministic(
            previousTimestamp,
            block2
        );
        bytes memory executedEncodedState;

        if (success) {
            (success, executedEncodedState) = executeStateTransitionOnState(
                dispute.channelId,
                incorrectDataProof.encodedState,
                block2.transaction
            );
        }

        //IF not success - tryAppendSlash(Block2.transaction.header.participant) && if Block1 and Block2 exist in dispute (finalBlock and [Block]) add disputer to slash[]
        //else nothing - the disputer paid for a correct transition
        bool challengeSuccess = false;
        if (!success)
            challengeSuccess = insertIfNotExist(
                dispute.slashedParticipants,
                block2.transaction.header.participant
            ); //dispute is correct - remove disputed participant
        else if (block2.stateHash != keccak256(executedEncodedState))
            challengeSuccess = insertIfNotExist(
                dispute.slashedParticipants,
                block2.transaction.header.participant
            ); //dispute is correct - remove disputed participant

        if (challengeSuccess)
            tryCancelFold(dispute, block1.transaction.header.transactionCnt);
        return challengeSuccess;
    }

    function applyNewerStateProof(
        Dispute storage dispute,
        NewerStateProof memory newerStateProof
    ) private returns (bool) {
        Block memory _block = abi.decode(newerStateProof.encodedBlock, (Block));
        require(
            _block.transaction.header.channelId == dispute.channelId,
            ErrorChannelIdMismatch()
        );
        require(
            _block.transaction.header.forkCnt == dispute.forkCnt,
            ErrorDisputeForkMismatch()
        );
        address retrivedAddress = StateChannelUtilLibrary.retriveSignerAddress(
            newerStateProof.encodedBlock,
            newerStateProof.confirmationSignature
        );
        require(
            retrivedAddress == dispute.postedStateDisputer,
            ErrorNewerStateConfirmationInvalid()
        );
        Block memory latestKnownBlock = abi.decode(
            dispute
                .virtualVotingBlocks[dispute.virtualVotingBlocks.length - 1]
                .encodedBlock,
            (Block)
        );
        require(
            _block.transaction.header.transactionCnt >=
                latestKnownBlock.transaction.header.transactionCnt,
            ErrorTransactionCountMismatch()
        );
        return
            insertIfNotExist(
                dispute.slashedParticipants,
                dispute.postedStateDisputer
            );
    }

    function applyFoldPriorBlockProof(
        Dispute storage dispute,
        FoldPriorBlockProof memory foldPriorBlockProof
    ) private returns (bool) {
        bool isTransactionCntInVirtualVotes = false;
        Block memory _block;
        for (uint i = 0; i < dispute.virtualVotingBlocks.length; i++) {
            _block = abi.decode(
                dispute.virtualVotingBlocks[i].encodedBlock,
                (Block)
            );
            if (
                _block.transaction.header.transactionCnt ==
                foldPriorBlockProof.transactionCnt
            ) isTransactionCntInVirtualVotes = true;
        }
        require(
            isTransactionCntInVirtualVotes,
            ErrorTimeoutPriorBlockNotInVirtualVotes()
        );
        require(
            foldPriorBlockProof.transactionCnt < dispute.foldedTransactionCnt,
            ErrorTimeoutPriorBlockNotPrior()
        );

        //Check timestamp for BlockCalldata
        (bool found, BlockCalldata memory _blockCalldata) = getBlockCallData(
            dispute.channelId,
            dispute.forkCnt,
            foldPriorBlockProof.transactionCnt,
            _block.transaction.header.participant
        );
        require(
            !found || _blockCalldata.timestamp > dispute.creationTimestamp,
            ErrorTimeoutPriorCalldataExists()
        );

        dispute.timedoutParticipant = _block.transaction.header.participant;
        dispute.timeoutDisputer = msg.sender;
        return true;
    }

    function applyBlockTooFarInFutureProof(
        Dispute storage dispute,
        BlockTooFarInFutureProof memory blockTooFarInFutureProof
    ) private returns (bool) {
        Block memory _block;

        _block = abi.decode(
            blockTooFarInFutureProof.block1.encodedBlock,
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
        address retrivedAddress = StateChannelUtilLibrary.retriveSignerAddress(
            blockTooFarInFutureProof.block1.encodedBlock,
            blockTooFarInFutureProof.block1.signature
        );
        require(
            retrivedAddress == _block.transaction.header.participant,
            ErrorSignatureInvalid()
        );

        bool isParticipant = StateChannelUtilLibrary.isAddressInArray(
            dispute.participants,
            retrivedAddress
        );
        require(isParticipant, ErrorNotParticipant());
        require(
            _block.transaction.header.timestamp > block.timestamp,
            ErrorBlockToFarInTheFutureActuallyNotInTheFuture()
        );
        return
            insertIfNotExist(
                dispute.slashedParticipants,
                _block.transaction.header.participant
            );
    }

    function applyJoinChannelProof(
        Dispute storage dispute,
        JoinChannelProof memory joinChannelProof
    ) private returns (bool) {
        (bool succeeds, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            dispute.participants,
            joinChannelProof.encodedSignedJoinChannel,
            joinChannelProof.signatures
        );
        require(succeeds, ErrorSignatureInvalid());
        SignedJoinChannel memory sjc = abi.decode(
            joinChannelProof.encodedSignedJoinChannel,
            (SignedJoinChannel)
        );
        JoinChannel memory jc = abi.decode(
            sjc.encodedJoinChannel,
            (JoinChannel)
        );
        //verifying "joiner's" signature
        address[] memory a = new address[](1);
        a[0] = jc.participant;
        bytes[] memory s = new bytes[](1);
        s[0] = sjc.signature;
        (succeeds, ) = StateChannelUtilLibrary.verifyThresholdSigned(
            a,
            sjc.encodedJoinChannel,
            s
        );
        require(succeeds, ErrorSignatureInvalid());
        require(jc.channelId == dispute.channelId, ErrorChannelIdMismatch());
        require(
            msg.sender ==
                getNextToWrite(
                    dispute.channelId,
                    dispute.encodedLatestCorrectState
                ),
            ErrorJoinChannelNotMyTurn()
        );
        bool isParticipant = StateChannelUtilLibrary.isAddressInArray(
            dispute.participants,
            jc.participant
        );
        require(!isParticipant, ErrorJoinChannelAlreadyInChannel());
        require(
            block.timestamp > jc.deadlineTimestamp,
            ErrorJoinChannelExpired()
        );
        require(
            insertJoinChannelIfNotExist(dispute.joinChannelParticipants, jc),
            ErrorJoinChannelAlreadyAdded()
        );
        require(addParticipantComposable(jc), ErrorJoinChannelFailed());
        return true;
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

    // function insertProcessExitIfNotExist(
    //     ProcessExit[] storage array,
    //     ProcessExit memory adr
    // ) private returns (bool) {
    //     for (uint i = 0; i < array.length; i++) {
    //         if (array[i].participant == adr.participant) return false;
    //     }
    //     array.push(adr);
    //     return true;
    // }

    function insertJoinChannelIfNotExist(
        JoinChannel[] storage array,
        JoinChannel memory jc
    ) private returns (bool) {
        for (uint i = 0; i < array.length; i++) {
            if (array[i].participant == jc.participant) return false;
        }
        array.push(jc);
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

    //Possible race condition off/on-chain -> non-deterministic
    function isGoodTimestampNonDeterministic(
        uint previousCanonicalTimestamp,
        Block memory block2
    ) internal returns (bool) {
        uint timestamp = block2.transaction.header.timestamp;
        uint lastTransactionTimestamp = previousCanonicalTimestamp;

        uint latestChainTimestamp = getChainLatestBlockTimestamp(
            block2.transaction.header.channelId,
            block2.transaction.header.forkCnt,
            block2.transaction.header.transactionCnt
        );
        uint referenceTime = latestChainTimestamp > lastTransactionTimestamp
            ? latestChainTimestamp
            : lastTransactionTimestamp;

        if (timestamp < lastTransactionTimestamp) return false; //Timestamp must be strictly increasing - Dispute BLOCK data not good

        if (timestamp > referenceTime + getP2pTime()) return false; // Not Valid Timestamp - This subjective (non-deterministic) - may fail due to race condition on chain

        return true;
    }
}
