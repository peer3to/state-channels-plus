pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";

contract DisputeManagerFacet is StateChannelCommon {
    function uploadDispute(DisputeConfirmation memory disputeConfirmation) public {
        _uploadDispute(disputeConfirmation, false);
    }

    function uploadDisputeWithCalldata(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        bytes32 disputeAuditingDataHash = keccak256(abi.encode(disputeAuditingData));
        require(dispute.disputeAuditingDataHash == disputeAuditingDataHash, ErrorAuditingDataHashMismatch());
        _uploadDispute(disputeConfirmation, true);
        emit DisputeAuditingDataPosted(
            dispute.channelId, keccak256(disputeConfirmation.signedDispute.encodedDispute), disputeAuditingData
        );
    }

    function uploadDisputeAndAudit(
        DisputeConfirmation memory disputeConfirmation,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        //first audit -> update on-chain slashes -> reduced threshold
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        address[] memory slashes = AStateChannelManagerProxy(address(this)).auditDispute(dispute, disputeAuditingData);
        for (uint256 i = 0; i < slashes.length; i++) {
            addOnChainSlashedParticipant(dispute.channelId, slashes[i]);
        }
        _uploadDispute(disputeConfirmation, true);
        emit DisputeAuditingDataPosted(
            dispute.channelId, keccak256(disputeConfirmation.signedDispute.encodedDispute), disputeAuditingData
        );
    }

    function reduce(Dispute[] memory disputes, uint256 disputeWindowCreationTimestamp)
        public
        view
        returns (ReduceOutput memory reducedOutput)
    {
        uint256 maxSlashCount;
        uint256 slashCount;
        uint256 selfRemovalCount;
        address[] memory slashParticipants;
        address[] memory selfRemovalParticipants = new address[](disputes.length);
        reducedOutput.forkGenesisTimestamp = disputeWindowCreationTimestamp + getEvidenceTime(); //expiration of evidence time
        uint256 disputeWindowExpirationTimestamp = disputeWindowCreationTimestamp + getKillTime();
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
                        //if on-chain slash happened after evidnece period expired (during the kill period), take that timestamp as genesis
                        if (disputeData.onChainSlashes[j].timestamp > reducedOutput.forkGenesisTimestamp) {
                            reducedOutput.forkGenesisTimestamp = disputeData.onChainSlashes[j].timestamp;
                        }
                    }
                }
                // ***** reducedOutput.latestJoinChannelBlockHash *****
                ChannelBalance storage cb = channelBalances[dispute.channelId];
                bytes32 jcbHash = cb.latestJoinChannelBlockHash;
                while (cb.onChainJoinChannelMap[jcbHash].timestamp > disputeWindowExpirationTimestamp) {
                    jcbHash = cb.onChainJoinChannelMap[jcbHash].previousJoinChannelBlockHash;
                }
                reducedOutput.latestJoinChannelBlockHash = jcbHash;
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
                FraudProof memory fraudProof = dispute.fraudProofs[j];
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

        FraudProofVerificationContext memory proofContext =
            FraudProofVerificationContext({channelId: dispute.channelId});
        address[] memory slashes = _verifyFraudProofs(dispute.fraudProofs, proofContext);
        slashes = StateChannelUtilLibrary.concatAddressArraysNoDuplicates(slashes, dispute.onChainSlashes);
        address[] memory removals = _calculateRemovals(dispute);

        DisputeOutputState memory disputeOutputState = generateDisputeOutputState(
            disputeAuditingData.latestStateStateMachineState,
            slashes,
            removals,
            disputeAuditingData.joinChannelBlocks,
            disputeAuditingData.latestStateSnapshot
        );
        SnapshotData memory latestSnapshotData = disputeAuditingData.latestStateSnapshot.snapshotData;
        require(
            _verifyBalanceInvariantCheck(
                dispute.channelId,
                latestSnapshotData.totalDeposits,
                latestSnapshotData.totalWithdrawals,
                latestSnapshotData.latestJoinChannelBlockHash
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

    function challengeDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) public {
        uint256 gasLimit = getGasLimit();
        bytes memory data = abi.encodeCall(DisputeManagerFacet.auditDispute, (dispute, disputeAuditingData));
        (bool success, bytes memory returnData) = address(this).call{gas: gasLimit}(data);
        if (success) {
            // auditing passed - dispute is correct, slash the challenger
            if (_canParticipateInDisputes(dispute.channelId, msg.sender)) {
                addOnChainSlashedParticipant(dispute.channelId, msg.sender);
            }
        } else {
            // auditing failed - dispute is invalid, kill it
            _killDispute(dispute);
        }
    }

    function commitToReducedResult(
        bytes32 channelId,
        bytes32 disputedForkId,
        bytes32 reducedForkId,
        uint256 reducedForkGenesisTimestamps
    ) public {
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputedForkId];
        require(_canParticipateInDisputes(channelId, msg.sender), ErrorCantParticipateInDispute());
        _commitToDisputeReducedResult(disputeWindow, reducedForkId, block.timestamp, reducedForkGenesisTimestamps);
        //TODO - emit event
    }

    /**
     * @notice Challenges a dispute reduction by providing disputes and verification data
     * @dev IMPORTANT: The disputes array must be provided in the same order as they were committed
     *      to the dispute window. The off-chain client is responsible for ensuring disputes are
     *      ordered correctly to save on gas during verification.
     */
    function challengeDisputeReduction(
        Dispute[] memory disputes,
        uint256 disputeWindowCreationTimestamp,
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

        require(areDisputesCommitted(disputeWindow, disputes), ErrorDisputeCommitmentNotAvailable());
        //require reduce challenge period is not expired - this also assures it's commited
        require(!_isReduceChallengePeriodExpired(disputeWindow), ErrorDisputeChallengePeriodExpired());

        ReduceOutput memory reducedOutput = reduce(disputes, disputeWindowCreationTimestamp);

        SnapshotData memory snapshotData =
            reduceOutputToSnapshotData(reducedOutput, stateSnapshot, encodedStateMachineState, joinChannelBlocks);

        bytes32 winingForkId = keccak256(abi.encode(snapshotData));

        if (
            winingForkId != disputeWindow.reducedResult.forkId
                || reducedOutput.forkGenesisTimestamp != disputeWindow.reducedResult.forkGenesisTimestamp
        ) {
            addOnChainSlashedParticipant(channelId, disputeWindow.reducedResult.reducer);
            disputeWindow.reducedResult.forkId = bytes32(0); // unset
            _commitToDisputeReducedResult(
                disputeWindow, winingForkId, block.timestamp - getEvidenceTime() - 1, reducedOutput.forkGenesisTimestamp
            );
        } else {
            addOnChainSlashedParticipant(channelId, msg.sender);
        }
    }

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public {
        Dispute[] memory maliciousDisputes = _verifyDisputeFraudProofs(proofs);
        for (uint256 i = 0; i < maliciousDisputes.length; i++) {
            _killDispute(maliciousDisputes[i]);
        }
    }

    function reduceOutputToSnapshotData(
        ReduceOutput memory reducedOutput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public returns (SnapshotData memory outputSnapshotData) {
        //verify snapshot linked to reducedOutput.latestBlock
        Block memory latestBlock = reducedOutput.latestBlock;
        require(
            latestBlock.stateSnapshotHash == keccak256(abi.encode(latestStateSnapshot)), ErrorInvalidStateSnapshot()
        );
        //verify encodedStateMachineState linked to snapshot
        require(
            latestStateSnapshot.snapshotData.stateMachineStateHash == keccak256(encodedStateMachineState),
            ErrorInvalidLatestState()
        );
        //verify JoinChannelBlocks
        require(
            _verifyJoinChannelBlocks(
                latestStateSnapshot.snapshotData.latestJoinChannelBlockHash,
                reducedOutput.latestJoinChannelBlockHash,
                joinChannelBlocks
            ),
            ErrorDisputeJoinChannelBlocksInvalid()
        );

        address[] memory removals = reducedOutput.selfRemovals;
        if (reducedOutput.timeout.participant != address(0) && reducedOutput.slashedParticipants.length == 0) {
            removals =
                StateChannelUtilLibrary.insertIntoAddressArrayNoDuplicates(removals, reducedOutput.timeout.participant);
        }

        DisputeOutputState memory outputState = generateDisputeOutputState(
            encodedStateMachineState,
            reducedOutput.slashedParticipants,
            removals,
            joinChannelBlocks,
            latestStateSnapshot
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

    // ********************** Internal/private functions

    function _uploadDispute(DisputeConfirmation memory disputeConfirmation, bool isAuditingCalldataProvided) internal {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        require(msg.sender == dispute.disputer, ErrorDisputerNotMsgSender());
        require(_canParticipateInDisputes(dispute.channelId, msg.sender), ErrorCantParticipateInDispute());

        // race condition checks
        _disputeRaceConditionCheck(dispute);

        DisputeData storage disputeData = disputeData[dispute.channelId];
        mapping(bytes32 forkId => DisputeWindow) storage disputeWindowMap = disputeData.disputeWindowMap;
        bytes32 forkId = _getDisputeFork(dispute);
        DisputeWindow storage disputeWindow = disputeWindowMap[forkId];
        bool isThresholdFinal = _isDisputeThresholdFinal(disputeConfirmation);
        if (!isAuditingCalldataProvided && !isThresholdFinal) {
            require(!_isAuditingCalldataRequired(disputeConfirmation), ErrorDisputeAuditingRequired());
        }

        //check if dispute window is created/opened for the disputed fork, otherwise create/open it
        if (disputeWindow.evidence.creationTimestamp == 0) {
            //create the dispute window
            disputeWindow.forkId = forkId;
            disputeWindow.evidence.creationTimestamp = block.timestamp; //challenge period started
        } else {
            require(
                block.timestamp <= disputeWindow.evidence.creationTimestamp + getEvidenceTime(),
                ErrorDisputeChallengePeriodExpired()
            );
            require(!disputeWindow.evidence.hasPosted[dispute.disputer], ErrorDisputeAlreadyPosted());
        }

        if (isThresholdFinal) {
            //finalize the dispute windown by making the kill period expired
            disputeWindow.evidence.creationTimestamp = block.timestamp - getKillTime() - 1;
            //delete all previous commitments - free up storage (gas refund)
            delete disputeWindow.evidence.disputeCommitments;
            //The reduced result is this dispute output. Finalize it by making it expired.
            _commitToDisputeReducedResult(
                disputeWindow, dispute.outputSnapshotDataHash, block.timestamp - getEvidenceTime() - 1, block.timestamp
            );
        }
        disputeWindow.evidence.disputeCommitments.push(keccak256(abi.encode(dispute)));
        disputeWindow.evidence.hasPosted[dispute.disputer] = true; //disputer has posted the dispute
        emit DisputeCommited(
            dispute.channelId, dispute, block.timestamp, isThresholdFinal, disputeWindow.evidence.creationTimestamp
        );
    }

    function _killDispute(Dispute memory dispute) internal {
        DisputeData storage disputeData = disputeData[dispute.channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[_getDisputeFork(dispute)];

        // require that the dispute window exists and is not expired
        require(
            disputeWindow.evidence.creationTimestamp != 0
                && block.timestamp < disputeWindow.evidence.creationTimestamp + getEvidenceTime(),
            ErrorDisputeExpired()
        );

        bytes32 commitment = keccak256(abi.encode(dispute));
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
        addOnChainSlashedParticipant(dispute.channelId, dispute.disputer);

        // remove the dispute commitment
        disputeWindow.evidence.disputeCommitments[foundIndex] =
            disputeWindow.evidence.disputeCommitments[disputeWindow.evidence.disputeCommitments.length - 1];
        disputeWindow.evidence.disputeCommitments.pop();

        //if dispute window is empty, delete it
        if (disputeWindow.evidence.disputeCommitments.length == 0) {
            delete disputeData.disputeWindowMap[_getDisputeFork(dispute)];

            for (uint256 i = 0; i < disputeData.disputedForks.length; i++) {
                if (disputeData.disputedForks[i] == _getDisputeFork(dispute)) {
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

        bytes32 latestSnapshotDataHash = keccak256(abi.encode(disputeAuditingData.latestStateSnapshot.snapshotData));
        bytes32 latestSnanpshotHash = keccak256(abi.encode(disputeAuditingData.latestStateSnapshot));

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
                if (
                    dispute.genesisSnapshotDataHash != latestSnapshotDataHash
                        || dispute.latestStateSnapshotHash != latestSnanpshotHash
                ) return false;
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

    function _isMilestoneFinal(StateSnapshot memory genesisSnapshot, MilestoneProof memory milestone)
        internal
        pure
        returns (bool isFinal, bytes32 finalizedSnapshotHash)
    {
        bytes32 genesisForkId = genesisSnapshot.forkId;
        address[] memory expectedParticipants = genesisSnapshot.snapshotData.participants;
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
            if (currentBlock.transaction.header.forkId != genesisForkId) return (false, bytes32(0));
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
        StateSnapshot memory snapshot = genesisSnapshot;
        lastBlockEncoded = "";

        // For K milestones, K-1 snapshots are needed to prove the last milestone is final, but for cleaner code we include the K-th snapshot too, even though it doesn't have to be used
        if (milestoneProofs.length != milestoneSnapshots.length) {
            return (false, "");
        }

        for (uint256 i = 0; i < milestoneProofs.length; i++) {
            MilestoneProof memory milestone = milestoneProofs[i];
            (bool isFinal, bytes32 finalizedSnapshotHash) = _isMilestoneFinal(snapshot, milestone);
            if (!isFinal) {
                return (false, "");
            }
            if (keccak256(abi.encode(milestoneSnapshots[i])) != finalizedSnapshotHash) {
                return (false, "");
            }
            snapshot = milestoneSnapshots[i];
            if (i == milestoneProofs.length - 1 && milestone.blockConfirmations.length > 0) {
                lastBlockEncoded =
                    milestone.blockConfirmations[milestone.blockConfirmations.length - 1].signedBlock.encodedBlock;
            }
        }
        return (true, lastBlockEncoded);
    }

    function _isCorrectGenesis(Dispute memory dispute) internal view returns (bool) {
        return _areDisputeAndBlockSameFork(dispute, _getLatestBlock(dispute.stateProof));
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
        for (uint256 i = 0; i < disputeAuditingData.exitChannelBlocks.length; i++) {
            if (previousExitChannelBlockHash != disputeAuditingData.exitChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousExitChannelBlockHash = keccak256(abi.encode(disputeAuditingData.exitChannelBlocks[i]));
        }
        return previousExitChannelBlockHash
            == disputeAuditingData.latestStateSnapshot.snapshotData.latestExitChannelBlockHash;
    }

    /// @dev Verify latestState balance invariant - output state is calculated with correct state transition that's audited -> if input is ok -> output is ok
    function _verifyBalanceInvariantCheck(
        bytes32 channelId,
        Balance memory totalDeposits,
        Balance memory totalWithdrawals,
        bytes32 latestJoinChannelBlockHash
    ) internal view returns (bool) {
        ChannelBalance storage channelBalance = channelBalances[channelId];
        Balance memory onChainDeposits = channelBalance.onChainJoinChannelMap[latestJoinChannelBlockHash].totalDeposits;
        Balance memory onChainWithdrawals = channelBalance.totalOnChainWithdrawals;
        //on-chain deposits have to match latestState deposits since deposits only happen on-chain
        if (!stateMachineImplementation.areBalancesEqual(totalDeposits, onChainDeposits)) return false;
        //total withdrawals >= on-chain withdrawals since on-chain withdrawals are already processed
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
        // *********** 1. Timeout *************
        if (dispute.timeout.participant != address(0) && !dispute.timeout.isForced) {
            //check if participant posted calldata commitment
            (bool found, bytes32 blockCalldataCommitment) = getBlockCallDataCommitment(
                dispute.channelId, _getDisputeFork(dispute), dispute.timeout.blockHeight, dispute.timeout.participant
            );
            if (found) {
                revert ErrorDisputeTimeoutCalldataPosted();
            }

            //check if previous block producer posted blockCalldata and if the expectation matches
            if (dispute.timeout.previousBlockProducer != address(0)) {
                (found, blockCalldataCommitment) = getBlockCallDataCommitment(
                    dispute.channelId,
                    _getDisputeFork(dispute),
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

    function _isAuditingCalldataRequired(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isRequired)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.signedDispute.encodedDispute, (Dispute));
        DisputeData storage disputeData = disputeData[dispute.channelId];
        if (disputeConfirmation.signatures.length < disputeData.pendingParticipants.length) return true;

        (bool isThresholdFinal,) = StateChannelUtilLibrary.verifyThresholdSigned(
            disputeData.pendingParticipants,
            disputeConfirmation.signedDispute.encodedDispute,
            disputeConfirmation.signatures
        );
        return !isThresholdFinal;
    }

    function _calculateRemovals(Dispute memory dispute) internal view returns (address[] memory removals) {
        //Try and combine timeout and selfRemoval -> max 2 removals per dispute
        uint256 removalCount = 0;
        address[] memory _removals = new address[](2);
        // Always apply selfRemoval if set
        if (dispute.selfRemoval) {
            _removals[removalCount++] = dispute.disputer;
        }
        // Ignore timeout if unset or if there are slashes
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
        uint256 reductionTimestamp,
        uint256 forkGenesisTimestamp
    ) internal {
        require(_isKillPeriodExpired(disputeWindow), ErrorDisputeKillPeriodNotExpired());
        require(disputeWindow.reducedResult.forkId == bytes32(0), ErrorDisputeAlreadyReduced());
        disputeWindow.reducedResult.forkId = reducedForkId;
        disputeWindow.reducedResult.forkGenesisTimestamp = forkGenesisTimestamp;
        disputeWindow.reducedResult.timestamp = reductionTimestamp;
        disputeWindow.reducedResult.reducer = msg.sender; //calling function should check that msg.sender is part of channel 'can participate'
    }

    function _isEvedincePeriodExpired(DisputeWindow storage disputeWindow) internal view returns (bool) {
        return block.timestamp > disputeWindow.evidence.creationTimestamp + getEvidenceTime();
    }

    function _isKillPeriodExpired(DisputeWindow storage disputeWindow) internal view returns (bool) {
        return block.timestamp > disputeWindow.evidence.creationTimestamp + getKillTime();
    }

    function areDisputesCommitted(DisputeWindow storage disputeWindow, Dispute[] memory disputes)
        internal
        view
        returns (bool)
    {
        if (disputes.length != disputeWindow.evidence.disputeCommitments.length) {
            return false;
        }
        for (uint256 i = 0; i < disputes.length; i++) {
            bytes32 commitment = keccak256(abi.encode(disputes[i]));
            // off-chain client puts the disputes in correct order - save on gas
            if (disputeWindow.evidence.disputeCommitments[i] != commitment) {
                return false;
            }
        }
        return true;
    }
}
