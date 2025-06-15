pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

contract DisputeManagerFacet is StateChannelCommon {
    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(msg.sender == dispute.disputer, ErrorDisputerNotMsgSender());
        require(_canParticipateInDisputes(dispute.channelId, msg.sender), ErrorCantParticipateInDispute());

        // race condition checks
        _disputeRaceConditionCheck(dispute);

        DisputeData storage disputeData = disputeData[dispute.channelId];
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        bytes32 forkId = dispute.genesisSnapshotDataHash;
        DisputeWindow storage disputeWindow = disputeWindowMap[forkId];
        bool isThresholdFinal = _isDisputeThresholdFinal(disputeConfirmation);
        bool isAuditingRequired;
        if (!isThresholdFinal) {
            require(!_isAuditingRequired(disputeConfirmation), ErrorDisputeAuditingRequired());
        }

        //check if dispute window is created/opened for the disputed fork, otherwise create/open it
        if (disputeWindow.evidence.creationTimestamp == 0) {
            //create the dispute window
            disputeWindow.forkId = forkId;
            disputeWindow.evidence.creationTimestamp = block.timestamp; //challenge period started
        } else {
            require(
                block.timestamp <= disputeWindow.evidence.creationTimestamp + getChallengeTime(),
                ErrorDisputeChallengePeriodExpired()
            );
            require(!disputeWindow.evidence.hasPosted[dispute.disputer], ErrorDisputeAlreadyPosted());
        }

        if (isThresholdFinal) {
            disputeWindow.evidence.creationTimestamp = block.timestamp - 2 * getChallengeTime() - 1;
            delete disputeWindow.evidence.disputeCommitments; //delete all previous commitments
            _commitToDisputeReducedResult(
                disputeWindow, dispute.outputSnapshotDataHash, block.timestamp - getChallengeTime() - 1
            );
        }
        disputeWindow.evidence.disputeCommitments.push(keccak256(abi.encode(dispute, block.timestamp)));
        disputeWindow.evidence.hasPosted[dispute.disputer] = true; //disputer has posted the dispute
        emit DisputeCommited(
            dispute.channelId, dispute, block.timestamp, isThresholdFinal, disputeWindow.evidence.creationTimestamp
        );
    }

    function uploadDisputeAndAudit(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        uploadDispute(disputeConfirmation);
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        address[] memory slashes = AStateChannelManagerProxy(address(this)).auditDispute(dispute, disputeAuditingData);
        for (uint256 i = 0; i < slashes.length; i++) {
            addOnChainSlashedParticipants(dispute.channelId, slashes[i]);
        }
    }

    function commitToReducedResult(bytes32 channelId, bytes32 disputedForkId, bytes32 reducedForkId) public {
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputedForkId];
        require(_canParticipateInDisputes(channelId, msg.sender), ErrorCantParticipateInDispute());
        _commitToDisputeReducedResult(disputeWindow, reducedForkId, block.timestamp);
        //TODO - emit event
    }

    function reduce(Dispute[] memory disputes, uint256 disputeWindowExpirationTimestamp)
        public
        view
        returns (ReduceOutput memory reducedOutput)
    {
        uint256 maxSlashCount;
        uint256 slashCount;
        uint256 selfRemovalCount;
        address[] memory slashParticipants;
        address[] memory selfRemovalParticipants = new address[](disputes.length);
        require(disputes.length > 0, ErrorNoDisputesProvided());

        for (uint256 i = 0; i < disputes.length; i++) {
            Dispute memory dispute = disputes[i];

            // ***** setup / first run *****
            if (maxSlashCount == 0) {
                SnapshotData storage snapshotData = stateSnapshots[dispute.channelId].snapshotData;
                DisputeData storage disputeData = disputeData[dispute.channelId];
                maxSlashCount == snapshotData.participants.length + disputeData.pendingParticipants.length;
                slashParticipants = new address[](maxSlashCount);

                //populate initially with on-chain slashes up to the dispute window expiration timestamp
                for (uint256 j = 0; j < disputeData.onChainSlashes.length; j++) {
                    if (disputeData.onChainSlashes[j].timestamp <= disputeWindowExpirationTimestamp) {
                        slashParticipants[slashCount++] = disputeData.onChainSlashes[j].participant;
                    }
                }
                // ***** reducedOutput.latestJoinChannelBlockHash *****
                // All disputes have the same latestJoinChannelBlockHash - enforced by the chain at creation
                reducedOutput.latestJoinChannelBlockHash = disputeData.latestJoinChannelBlockHash;
            }

            // ***** reducedOutput.latestBlock *****
            // Extract the latest block from the state proof - it's either the last signed block or the last one in milestones
            StateProof memory stateProof = dispute.stateProof;
            Block memory disputeLatestBlock = _getLatestBlock(stateProof);

            // Take the latest block possible
            if (
                disputeLatestBlock.transaction.header.transactionCnt
                    >= reducedOutput.latestBlock.transaction.header.transactionCnt
            ) {
                reducedOutput.latestBlock = disputeLatestBlock;
            }

            // ***** reducedOutput.slashedParticipants *****
            for (uint256 j = 0; j < dispute.fraudProofs.length; j++) {
                Proof memory fraudProof = dispute.fraudProofs[j];
                bool isAlreadySlashed = false;
                for (uint256 k = 0; k < slashCount; k++) {
                    if (slashParticipants[k] == fraudProof.participant) {
                        isAlreadySlashed = true;
                        break;
                    }
                }
                if (!isAlreadySlashed) {
                    slashParticipants[slashCount++] = fraudProof.participant;
                }
            }

            // ***** reducedOutput.timeout *****
            if (
                reducedOutput.timeout.participant == address(0)
                    || dispute.timeout.blockHeight < reducedOutput.timeout.blockHeight
            ) {
                reducedOutput.timeout = dispute.timeout;
            }

            // ***** reducedOutput.selfRemovals *****
            if (dispute.selfRemoval) {
                selfRemovalParticipants[selfRemovalCount++] = dispute.disputer;
            }
        }
        // allocate correct size arrays
        reducedOutput.slashedParticipants = new address[](slashCount);
        for (uint256 i = 0; i < slashCount; i++) {
            reducedOutput.slashedParticipants[i] = slashParticipants[i];
        }
        reducedOutput.selfRemovals = new address[](selfRemovalCount);
        for (uint256 i = 0; i < selfRemovalCount; i++) {
            reducedOutput.selfRemovals[i] = selfRemovalParticipants[i];
        }
    }

    function reduceOutputToSnapshotData(
        ReduceOutput memory reducedOutput,
        StateSnapshot memory stateSnapshot,
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public returns (SnapshotData memory outputSnapshotData) {
        //verify snapshot linked to reducedOutput.latestBlock
        Block memory latestBlock = reducedOutput.latestBlock;
        require(latestBlock.stateSnapshotHash == keccak256(abi.encode(stateSnapshot)), ErrorInvalidStateSnapshot());
        //verify encodedStateMachineState linked to snapshot
        require(
            stateSnapshot.snapshotData.stateMachineStateHash == keccak256(encodedStateMachineState),
            ErrorInvalidLatestState()
        );
        //verify JoinChannelBlocks
        require(
            _verifyJoinChannelBlocks(
                stateSnapshot.snapshotData.latestJoinChannelBlockHash,
                reducedOutput.latestJoinChannelBlockHash,
                joinChannelBlocks
            ),
            ErrorDisputeJoinChannelBlocksInvalid()
        );

        address[] memory removals = reducedOutput.selfRemovals;
        if (reducedOutput.timeout.participant != address(0)) {
            removals =
                StateChannelUtilLibrary.insertIntoAddressArrayNoDuplicates(removals, reducedOutput.timeout.participant);
        }

        DisputeOutputState memory outputState = generateDisputeOutputState(
            encodedStateMachineState, reducedOutput.slashedParticipants, removals, joinChannelBlocks, stateSnapshot
        );

        return SnapshotData({
            stateMachineStateHash: keccak256(outputState.encodedModifiedState),
            participants: getStatemachineParticipants(outputState.encodedModifiedState),
            latestJoinChannelBlockHash: reducedOutput.latestJoinChannelBlockHash, // This has been verified in _verifyJoinChannelBlocks
            latestExitChannelBlockHash: keccak256(abi.encode(outputState.exitBlock)),
            totalDeposits: outputState.totalDeposits,
            totalWithdrawals: outputState.totalWithdrawals
        });
    }

    function auditDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        external
        onlySelf
        returns (address[] memory slashParticipants)
    {
        require(_isCorrectAuditingData(dispute, disputeAuditingData), ErrorDisputeWrongAuditingData());
        require(_isCorrectGenesis(dispute), ErrorDisputeGenesisInvalid());
        require(_verifyStateProof(dispute, disputeAuditingData), ErrorDisputeStateProofInvalid());
        require(
            _verifyJoinChannelBlocks(
                disputeAuditingData.latestStateSnapshot.snapshotData.latestJoinChannelBlockHash,
                dispute.onChainLatestJoinChannelBlockHash,
                disputeAuditingData.joinChannelBlocks
            ),
            ErrorDisputeJoinChannelBlocksInvalid()
        );
        require(_verifyExitChannelBlocks(dispute, disputeAuditingData), ErrorDisputeExitChannelBlocksInvalid());

        FraudProofVerificationContext memory poofContext = FraudProofVerificationContext({channelId: dispute.channelId});
        address[] memory slashes = _verifyFraudProofs(dispute.fraudProofs, poofContext);
        slashes = StateChannelUtilLibrary.concatAddressArrays(slashes, dispute.onChainSlashes);
        address[] memory removals = _calculateRemovals(dispute);

        DisputeOutputState memory disputeOutputState = generateDisputeOutputState(
            disputeAuditingData.latestStateStateMachineState,
            slashes,
            removals,
            disputeAuditingData.joinChannelBlocks,
            disputeAuditingData.latestStateSnapshot
        );
        require(
            _verifyBalanceInvariantCheck(
                dispute.channelId, disputeOutputState.totalDeposits, disputeOutputState.totalWithdrawals
            ),
            ErrorDisputeBalanceInvariantInvalid()
        );

        // ***************** Generate output snapshot ***************
        SnapshotData memory outputSnapshotData = SnapshotData({
            stateMachineStateHash: keccak256(disputeOutputState.encodedModifiedState),
            participants: getStatemachineParticipants(disputeOutputState.encodedModifiedState),
            latestJoinChannelBlockHash: disputeAuditingData.outputStateSnapshot.snapshotData.latestJoinChannelBlockHash, // This has been verified in _verifyJoinChannelBlocks
            latestExitChannelBlockHash: keccak256(abi.encode(disputeOutputState.exitBlock)),
            totalDeposits: disputeOutputState.totalDeposits,
            totalWithdrawals: disputeOutputState.totalWithdrawals
        });

        //verify outputStateSnapshot commitment
        if (keccak256(abi.encode(outputSnapshotData)) != dispute.outputSnapshotDataHash) {
            revert ErrorDisputeOutputStateSnapshotInvalid();
        }

        return slashes;
    }

    function challengeDispute(
        Dispute memory dispute,
        uint256 disputeCreationTimestamp,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        uint256 gasLimit = getGasLimit();
        bytes memory data = abi.encodeCall(DisputeManagerFacet.auditDispute, (dispute, disputeAuditingData));
        (bool success, bytes memory returnData) = address(this).call{gas: gasLimit}(data);
        if (!success) {
            _killDispute(dispute, disputeCreationTimestamp);
        } else {
            // slash the challenger
            if (_canParticipateInDisputes(dispute.channelId, msg.sender)) {
                addOnChainSlashedParticipants(dispute.channelId, msg.sender);
            }
        }
    }

    function challengeDisputeReduction(
        Dispute[] memory disputes,
        uint256[] memory disputeCreationTimestamps,
        uint256 disputeWindowExpirationTimestamp,
        StateSnapshot memory stateSnapshot,
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public {
        require(disputes.length > 0, ErrorNoDisputesProvided());
        bytes32 channelId = disputes[0].channelId;
        require(_canParticipateInDisputes(channelId, msg.sender), ErrorCantParticipateInDispute());
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputes[0].genesisSnapshotDataHash];

        //rquire all disputes are part of commitment

        require(
            areDisputesCommitted(disputeWindow, disputes, disputeCreationTimestamps),
            ErrorDisputeCommitmentNotAvailable()
        );
        //require reduce challenge period is not expired - this also ashures it's commited
        require(!_isReduceChallengePeriodExpired(disputeWindow), ErrorDisputeChallengePeriodExpired());

        ReduceOutput memory reducedOutput = reduce(disputes, disputeWindowExpirationTimestamp);

        SnapshotData memory snapshotData =
            reduceOutputToSnapshotData(reducedOutput, stateSnapshot, encodedStateMachineState, joinChannelBlocks);

        bytes32 winingForkId = keccak256(abi.encode(snapshotData));

        if (winingForkId != disputeWindow.reducedResult.reducedForkId) {
            addOnChainSlashedParticipants(channelId, disputeWindow.reducedResult.reducer);
            disputeWindow.reducedResult.reducedForkId = bytes32(0); // unset
            _commitToDisputeReducedResult(disputeWindow, winingForkId, block.timestamp - getChallengeTime() - 1);
        } else {
            addOnChainSlashedParticipants(channelId, msg.sender);
        }
    }

    // Doesn't do any checks and just applies all slashes, removals and joins to a specific stateMachineState and generates the outputStateMachineState - similar logic to playTransaction in the typescript code - this is done to help the backer generate a correct output state while forging the dispute
    function generateDisputeOutputState(
        bytes memory encodedStateMachineState,
        address[] memory slashParticipants,
        address[] memory removeParticipants,
        JoinChannelBlock[] memory joinChannelBlocks,
        StateSnapshot memory latestStateSnapshot
    ) public returns (DisputeOutputState memory outputState) {
        outputState.totalDeposits = latestStateSnapshot.snapshotData.totalDeposits;
        outputState.totalWithdrawals = latestStateSnapshot.snapshotData.totalWithdrawals;

        // Apply joins
        outputState.encodedModifiedState =
            _applyJoins(encodedStateMachineState, joinChannelBlocks, outputState.totalDeposits);

        // Apply slashes
        ExitChannel[] memory slashExitChannels;
        (outputState.encodedModifiedState, slashExitChannels) =
            _applySlashes(outputState.encodedModifiedState, slashParticipants);

        // Apply removals
        ExitChannel[] memory removalExitChannels;
        (outputState.encodedModifiedState, removalExitChannels) =
            _applyRemovals(outputState.encodedModifiedState, removeParticipants);

        // Combine exit channels and calculate totals
        ExitChannel[] memory allExitChannels =
            StateChannelUtilLibrary.concatExitChannelArrays(slashExitChannels, removalExitChannels);
        outputState.totalWithdrawals = _calculateTotalWithdrawals(outputState.totalWithdrawals, allExitChannels);

        outputState.exitBlock =
            _formExitChannelBlock(latestStateSnapshot.snapshotData.latestExitChannelBlockHash, allExitChannels);

        return outputState;
    }

    function _killDispute(Dispute memory dispute, uint256 disputeCreationTimestamp) internal {
        DisputeData storage disputeData = disputeData[dispute.channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[dispute.genesisSnapshotDataHash];

        // require that the dispute window exists and is not expired
        require(
            disputeWindow.evidence.creationTimestamp != 0
                && block.timestamp < disputeWindow.evidence.creationTimestamp + getChallengeTime(),
            ErrorDisputeExpired()
        );

        bytes32 commitment = keccak256(abi.encode(dispute, disputeCreationTimestamp));
        bool isFound = false;
        uint256 foundIndex;
        for (uint256 i = 0; i < disputeWindow.evidence.disputeCommitments.length; i++) {
            if (disputeWindow.evidence.disputeCommitments[i] == commitment) {
                isFound = true;
                foundIndex = i;
                break;
            }
        }
        // require that the dispute cimmitment exists
        require(isFound, ErrorDisputeCommitmentNotAvailable());

        // add the disputer to on-chain slashes
        addOnChainSlashedParticipants(dispute.channelId, dispute.disputer);

        // remove the dispute commitment
        disputeWindow.evidence.disputeCommitments[foundIndex] =
            disputeWindow.evidence.disputeCommitments[disputeWindow.evidence.disputeCommitments.length - 1];
        disputeWindow.evidence.disputeCommitments.pop();

        //if dispute window is empty, delete it
        if (disputeWindow.evidence.disputeCommitments.length == 0) {
            delete disputeData.disputeWindowMap[dispute.genesisSnapshotDataHash];

            for (uint256 i = 0; i < disputeData.disputedForks.length; i++) {
                if (disputeData.disputedForks[i] == dispute.genesisSnapshotDataHash) {
                    //remove disputed fork from the list
                    disputeData.disputedForks[i] = disputeData.disputedForks[disputeData.disputedForks.length - 1];
                    disputeData.disputedForks.pop();
                    break;
                }
            }
        }
    }
    // =============================== State Proofs Verification  ===============================

    function _verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        returns (bool isValid)
    {
        //This runs after verifying auditingData and genesisStateSnapshot => we can skip those checks here

        // Milestone checking
        (bool isValid, bytes memory lastBlockEncoded) = verifyMilestones(
            dispute.stateProof.milestones,
            disputeAuditingData.milestoneSnapshots,
            disputeAuditingData.genesisStateSnapshot
        );
        if (!isValid) {
            return false;
        }
        // If no blocks in milestones
        if (lastBlockEncoded.length == 0) {
            if (dispute.stateProof.signedBlocks.length == 0) {
                //no blocks at all => genesis == latest
                if (dispute.genesisSnapshotDataHash != dispute.latestStateSnapshotHash) return false;
            } else {
                //check if signedBlocks are linked, signed and build on genesis
                if (
                    !_areSignedBlocksLinkedAndVerified(dispute.stateProof.signedBlocks, dispute.genesisSnapshotDataHash)
                ) return false;

                Block memory lastBlock = abi.decode(
                    dispute.stateProof.signedBlocks[dispute.stateProof.signedBlocks.length - 1].encodedBlock, (Block)
                );
                //check if lastBlock commits to the latestStateSnapshot
                if (lastBlock.stateSnapshotHash != dispute.latestStateSnapshotHash) return false;
            }
        } else {
            //check if signedBlocks are linked, signed and build on lastBlock from the milestones
            if (!_areSignedBlocksLinkedAndVerified(dispute.stateProof.signedBlocks, keccak256(lastBlockEncoded))) {
                return false;
            }

            //check if lastBlock commits to the latestStateSnapshot
            if (dispute.stateProof.signedBlocks.length != 0) {
                lastBlockEncoded =
                    dispute.stateProof.signedBlocks[dispute.stateProof.signedBlocks.length - 1].encodedBlock;
            }
            Block memory lastBlock = abi.decode(lastBlockEncoded, (Block));
            //check if lastBlock commits to the latestStateSnapshot
            if (lastBlock.stateSnapshotHash != dispute.latestStateSnapshotHash) {
                return false;
            }
        }
        //check commitment to latestStateSnapshot
        if (dispute.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot))) {
            return false;
        }
        //check commitment to latestStateStateMachineState
        if (
            disputeAuditingData.latestStateSnapshot.snapshotData.stateMachineStateHash
                != keccak256(disputeAuditingData.latestStateStateMachineState)
        ) return false;
        return true;
    }

    function _isMilestoneFinal(
        MilestoneProof memory milestone,
        address[] memory expectedParticipants,
        bytes32 genesisSnapshotHash
    ) internal pure returns (bool isFinal, bytes32 finalizedSnapshotHash) {
        address[] memory thresholdSet = new address[](expectedParticipants.length);
        uint256 thresholdCount = 0;
        bytes memory previousEncodedBlock;
        BlockConfirmation memory currentBlockConfirmation;
        Block memory currentBlock;
        address adr;
        if (milestone.blockConfirmations.length == 0) {
            return (false, bytes32(0));
        }
        for (uint256 i = 0; i < milestone.blockConfirmations.length; i++) {
            currentBlockConfirmation = milestone.blockConfirmations[i];
            currentBlock = abi.decode(currentBlockConfirmation.signedBlock.encodedBlock, (Block));
            //check linked
            if (i != 0) {
                if (currentBlock.previousBlockHash != keccak256(previousEncodedBlock)) {
                    return (false, bytes32(0));
                }
            } else {
                finalizedSnapshotHash = currentBlock.stateSnapshotHash;
            }
            // Collect signatures
            adr = StateChannelUtilLibrary.retriveSignerAddress(
                currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signedBlock.signature
            );
            if (adr != currentBlock.transaction.header.participant) {
                return (false, bytes32(0));
            }
            thresholdCount = StateChannelUtilLibrary.tryInsertAddressInThresholdSet(
                adr, thresholdSet, thresholdCount, expectedParticipants
            );
            for (uint256 j = 0; j < currentBlockConfirmation.signatures.length; j++) {
                adr = StateChannelUtilLibrary.retriveSignerAddress(
                    currentBlockConfirmation.signedBlock.encodedBlock, currentBlockConfirmation.signatures[j]
                );
                thresholdCount = StateChannelUtilLibrary.tryInsertAddressInThresholdSet(
                    adr, thresholdSet, thresholdCount, expectedParticipants
                );
            }
            previousEncodedBlock = currentBlockConfirmation.signedBlock.encodedBlock;
        }

        return (thresholdCount == expectedParticipants.length, finalizedSnapshotHash);
    }

    /// @dev Verfies ForkMilestoneBlock along with BlockConfirmations and taking into account Virtual Voting
    function verifyMilestones(
        MilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory genesisSnapshot
    ) public returns (bool isValid, bytes memory lastBlockEncoded) {
        address[] memory participants = genesisSnapshot.snapshotData.participants;
        StateSnapshot memory snapshot = genesisSnapshot;
        lastBlockEncoded = "";

        // For K milestones, K-1 snapshots are needed to prove the last milestone is final, but for cleaner code we include the K-th snapshot too, even though it doesn't have to be used
        if (milestoneProofs.length != milestoneSnapshots.length) {
            return (false, "");
        }

        for (uint256 i = 0; i < milestoneProofs.length; i++) {
            MilestoneProof memory milestone = milestoneProofs[i];
            (bool isFinal, bytes32 finalizedSnapshotHash) =
                _isMilestoneFinal(milestone, participants, snapshot.snapshotData.stateMachineStateHash);
            if (!isFinal) {
                return (false, "");
            }
            if (keccak256(abi.encode(milestoneSnapshots[i])) != finalizedSnapshotHash) {
                return (false, "");
            }
            snapshot = milestoneSnapshots[i];
            participants = milestoneSnapshots[i].snapshotData.participants;

            if (i == milestoneProofs.length - 1 && milestone.blockConfirmations.length > 0) {
                lastBlockEncoded =
                    milestone.blockConfirmations[milestone.blockConfirmations.length - 1].signedBlock.encodedBlock;
            }
        }
        return (true, lastBlockEncoded);
    }

    function _getLatestBlock(StateProof memory stateProof) internal pure returns (Block memory) {
        return stateProof.signedBlocks.length > 0
            ? abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block))
            : abi.decode(
                stateProof.milestones[stateProof.milestones.length - 1].blockConfirmations[stateProof.milestones[stateProof
                    .milestones
                    .length - 1].blockConfirmations.length - 1].signedBlock.encodedBlock,
                (Block)
            );
    }

    function _isCorrectGenesis(Dispute memory dispute) internal view returns (bool) {
        Block memory latestBlock = _getLatestBlock(dispute.stateProof);
        return latestBlock.transaction.header.forkId == dispute.genesisSnapshotDataHash;
    }

    function _verifyJoinChannelBlocks(
        bytes32 previousJoinChannelBlockHash,
        bytes32 latestJoinChannelBlockHash,
        JoinChannelBlock[] memory joinChannelBlocks
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < joinChannelBlocks.length; i++) {
            if (previousJoinChannelBlockHash != joinChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousJoinChannelBlockHash = keccak256(abi.encode(joinChannelBlocks[i]));
        }
        return previousJoinChannelBlockHash == latestJoinChannelBlockHash;
    }

    function _verifyExitChannelBlocks(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        pure
        returns (bool)
    {
        //check joinChannelBlocks (linked to latestSateSnapshot, chained internally and outputStateSnapshot commits to the head)
        bytes32 previousExitChannelBlockHash =
            disputeAuditingData.genesisStateSnapshot.snapshotData.latestExitChannelBlockHash;
        for (uint256 i = 0; i < dispute.exitChannelBlocks.length; i++) {
            if (previousExitChannelBlockHash != dispute.exitChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousExitChannelBlockHash = keccak256(abi.encode(dispute.exitChannelBlocks[i]));
        }
        return previousExitChannelBlockHash
            == disputeAuditingData.latestStateSnapshot.snapshotData.latestExitChannelBlockHash;
    }

    function _verifyBalanceInvariantCheck(
        bytes32 channelId,
        Balance memory totalDeposits,
        Balance memory totalWithdrawals
    ) internal view returns (bool) {
        Balance memory onChainDeposits = totalOnChainProcessedDeposits[channelId];
        Balance memory onChainWithdrawals = totalOnChainProcessedWithdrawals[channelId];
        //on-chain deposits have to match outputState deposits since deposits only happen on-chain
        if (!stateMachineImplementation.areBalancesEqual(totalDeposits, onChainDeposits)) return false;
        //total withdrawals can not be less than on-chain withdrawals since on-chain withdrawals are already processed
        if (stateMachineImplementation.isBalanceLesserThan(totalWithdrawals, onChainWithdrawals)) return false;
        Balance memory stateMachineBalance = stateMachineImplementation.getTotalStateBalance(); // The state is already set
        // totalDeposits == totalWithdrawals + stateMachineBalance
        if (
            !stateMachineImplementation.areBalancesEqual(
                totalDeposits, stateMachineImplementation.addBalance(totalWithdrawals, stateMachineBalance)
            )
        ) return false;
        return true;
    }

    function _canParticipateInDisputes(bytes32 channelId, address participant) internal view returns (bool) {
        StateSnapshot storage stateSnapshot = stateSnapshots[channelId];
        bool isParticipant = false;
        //Check if normal participant
        for (uint256 i = 0; i < stateSnapshot.snapshotData.participants.length; i++) {
            if (stateSnapshot.snapshotData.participants[i] == participant) {
                isParticipant = true;
                break;
            }
        }
        if (!isParticipant) {
            //check pending participants
            DisputeData storage _disputeData = disputeData[channelId];
            for (uint256 i = 0; i < _disputeData.pendingParticipants.length; i++) {
                if (_disputeData.pendingParticipants[i] == participant) {
                    isParticipant = true;
                    break;
                }
            }
            if (!isParticipant) return false;
        }

        address[] memory onChainSlashedParticipants = getOnChainSlashedParticipants(channelId);
        //check if slashed on-chain -> slashed participants can't participate in disputes
        for (uint256 i = 0; i < onChainSlashedParticipants.length; i++) {
            if (onChainSlashedParticipants[i] == participant) {
                return false; //is slashed -> can't participate
            }
        }
        return true; //is participant and not slashed -> can participate
    }

    function _disputeRaceConditionCheck(Dispute memory dispute) internal view {
        StateSnapshot storage stateSnapshot = stateSnapshots[dispute.channelId];
        DisputeData storage _disputeData = disputeData[dispute.channelId];

        // *********** 1. Timeout *************
        if (dispute.timeout.participant != address(0) && !dispute.timeout.isForced) {
            //check if participant posted calldata commitment
            (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(
                dispute.channelId, dispute.timeout.forkId, dispute.timeout.blockHeight, dispute.timeout.participant
            );
            if (found) {
                revert ErrorDisputeTimeoutCalldataPosted();
            }

            //check if previous block producer posted blockCalldata and if the expectation matches
            if (dispute.timeout.previousBlockProducer != address(0)) {
                (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(
                    dispute.channelId,
                    dispute.timeout.forkId,
                    dispute.timeout.blockHeight - 1,
                    dispute.timeout.previousBlockProducer
                );
                if (found != dispute.timeout.previousBlockProducerPostedCalldata) {
                    revert ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch();
                }
            }
            if (block.timestamp > dispute.timeout.minTimeStamp) {
                revert ErrorDisputeTimeoutNotMinTimestamp();
            }
        }

        // *********** 2. onChainLatestJoinChannelBlockHash should match *************
        require(
            dispute.onChainLatestJoinChannelBlockHash == _disputeData.latestJoinChannelBlockHash,
            ErrorDisputeOnChainLatestJoinChannelBlockHashMismatch()
        );
    }

    function _isDisputeThresholdFinal(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isFinal)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        DisputeData storage disputeData = disputeData[dispute.channelId];
        SnapshotData storage snapshotData = stateSnapshots[dispute.channelId].snapshotData;
        uint256 thresholdCount = snapshotData.participants.length + disputeData.pendingParticipants.length
            - disputeData.onChainSlashes.length;
        if (
            disputeConfirmation.signatures.length + 1
                < snapshotData.participants.length + disputeData.pendingParticipants.length
                    - disputeData.onChainSlashes.length
        ) return false;
        address[] memory thresholdSet = getOnChainThresholdSet(dispute.channelId);
        bytes[] memory signatures = StateChannelUtilLibrary.insertBytesInByteArray(
            disputeConfirmation.signedDispute.signature, disputeConfirmation.signatures
        );
        (bool isThresholdFinal,) = StateChannelUtilLibrary.verifyThresholdSigned(
            thresholdSet, disputeConfirmation.signedDispute.encodedDispute, signatures
        );
        return isThresholdFinal;
    }

    function _isAuditingRequired(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isRequired)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        DisputeData storage disputeData = disputeData[dispute.channelId];
        SnapshotData storage snapshotData = stateSnapshots[dispute.channelId].snapshotData;
        uint256 thresholdCount = disputeData.pendingParticipants.length;
        if (disputeConfirmation.signatures.length < disputeData.pendingParticipants.length) return true;

        (bool isThresholdFinal,) = StateChannelUtilLibrary.verifyThresholdSigned(
            disputeData.pendingParticipants,
            disputeConfirmation.signedDispute.encodedDispute,
            disputeConfirmation.signatures
        );
        return !isThresholdFinal;
    }

    function _calculateRemovals(Dispute memory dispute) internal view returns (address[] memory removals) {
        uint256 removalCount = 0;
        address[] memory _removals = new address[](2);
        if (dispute.selfRemoval) {
            _removals[removalCount++] = dispute.disputer;
        }
        if (
            dispute.fraudProofs.length == 0 && dispute.onChainSlashes.length == 0
                && dispute.timeout.participant != address(0)
        ) {
            _removals[removalCount++] = dispute.timeout.participant;
        }

        removals = new address[](removalCount);
        for (uint256 i = 0; i < removalCount; i++) {
            removals[i] = _removals[i];
        }
        return removals;
    }

    function _isCorrectAuditingData(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        view
        returns (bool)
    {
        //check dispute commits to disputeData
        if (dispute.disputeAuditingDataHash != keccak256(abi.encode(disputeAuditingData))) {
            return false;
        }
        //check dispute commits to genesisStateSnapshot
        if (
            dispute.genesisSnapshotDataHash
                != keccak256(abi.encode(disputeAuditingData.genesisStateSnapshot.snapshotData))
        ) {
            return false;
        }
        //check latestStateSnapshot
        if (dispute.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot))) {
            return false;
        }
        //check outputStateSnapshot
        if (
            dispute.outputSnapshotDataHash
                != keccak256(abi.encode(disputeAuditingData.outputStateSnapshot.snapshotData))
        ) {
            return false;
        }

        //check latestStateStateMachineState
        if (
            disputeAuditingData.latestStateSnapshot.snapshotData.stateMachineStateHash
                != keccak256(disputeAuditingData.latestStateStateMachineState)
        ) {
            return false;
        }

        //check joinChannelBlocks (linked to latestSateSnapshot, chained internally and outputStateSnapshot commits to the head)
        bytes32 previousJoinChannelBlockHash =
            disputeAuditingData.latestStateSnapshot.snapshotData.latestJoinChannelBlockHash;
        for (uint256 i = 0; i < disputeAuditingData.joinChannelBlocks.length; i++) {
            if (previousJoinChannelBlockHash != disputeAuditingData.joinChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousJoinChannelBlockHash = keccak256(abi.encode(disputeAuditingData.joinChannelBlocks[i]));
        }
        return previousJoinChannelBlockHash
            == disputeAuditingData.outputStateSnapshot.snapshotData.latestExitChannelBlockHash;
    }

    function _commitToDisputeReducedResult(
        DisputeWindow storage disputeWindow,
        bytes32 reducedForkId,
        uint256 reductionTimestamp
    ) internal {
        require(_isKillPeriodExpired(disputeWindow), ErrorDisputeKillPeriodNotExpired());
        require(disputeWindow.reducedResult.reducedForkId == bytes32(0), ErrorDisputeAlreadyReduced());
        disputeWindow.reducedResult.reducedForkId = reducedForkId;
        disputeWindow.reducedResult.reductionTimestamp = reductionTimestamp;
        disputeWindow.reducedResult.reducer = msg.sender; //calling function should check that msg.sender is part of channel 'can participate'
    }

    function _isEvedincePeriodExpired(DisputeWindow storage disputeWindow) internal view returns (bool) {
        return block.timestamp > disputeWindow.evidence.creationTimestamp + getChallengeTime();
    }

    function _isKillPeriodExpired(DisputeWindow storage disputeWindow) internal view returns (bool) {
        return block.timestamp > disputeWindow.evidence.creationTimestamp + 2 * getChallengeTime();
    }

    function areDisputesCommitted(
        DisputeWindow storage disputeWindow,
        Dispute[] memory disputes,
        uint256[] memory disputeCreationTimestamps
    ) internal view returns (bool) {
        if (disputes.length != disputeWindow.evidence.disputeCommitments.length) {
            return false;
        }
        for (uint256 i = 0; i < disputes.length; i++) {
            bytes32 commitment = keccak256(abi.encode(disputes[i], disputeCreationTimestamps[i]));
            // off-chain client puts the disputes in correct order - save on gas
            if (disputeWindow.evidence.disputeCommitments[i] != commitment) {
                return false;
            }
        }
        return true;
    }
}
