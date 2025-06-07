pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./AStateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";

contract DisputeManagerFacet is StateChannelCommon {
    function createDispute(DisputeConfirmation memory disputeConfirmation) public {
        Dispute memory dispute = abi.decode(disputeConfirmation.encodedDispute, (Dispute));
        require(msg.sender == dispute.disputer, ErrorDisputerNotMsgSender());
        require(_canParticipateInDisputes(dispute.channelId, msg.sender), ErrorCantParticipateInDispute());

        // race condition checks
        _disputeRaceConditionCheck(dispute);

        DisputeData storage disputeData = disputeData[dispute.channelId];
        DisputeData storage disputeWindowMap = disputeData.disputeWindowMap;
        bytes32 forkId = dispute.genesisSnapshotDataHash;
        DisputeWindow storage disputeWindow = disputeWindowMap[forkId];
        bool isThresholdFinal = _isDisputeThresholdFinal(disputeConfirmation);
        bool isAuditingRequired;
        if (!isThresholdFinal) {
            require(!_isAuditingRequired(disputeConfirmation), ErrorDisputeAuditingRequired());
        }

        //check if dispute window is created/opened for the disputed fork, otherwise create/open it
        if (disputeWindow.createdTimestamp == 0) {
            //create the dispute window
            disputeWindow.forkId = forkId;
            disputeWindow.createdTimestamp = block.timestamp; //challenge period started
        } else {
            require(
                block.timestamp <= disputeWindow.createdTimestamp + getChallengeTime(),
                ErrorDisputeChallengePeriodExpired()
            );
            require(!disputeWindow.hasPosted(dispute.disputer), ErrorDisputeAlreadyPosted());
        }

        if (isThresholdFinal) {
            disputeWindow.createdTimestamp = block.timestamp - getChallengeTime() - 1;
            delete disputeWindow.disputeCommitments; //delete all previous commitments
        }
        disputeWindow.disputeCommitments.push(keccak256(abi.encode(dispute)));
        disputeWindow.hasPosted(dispute.disputer) = true; //disputer has posted the dispute
        emit DisputeCommited(dispute.channelId, dispute, isThresholdFinal, disputeWindow.createdTimestamp);
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
            Block memory disputeLatestBlock = stateProof.signedBlocks.length > 0
                ? abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block))
                : abi.decode(
                    stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1]
                        .blockConfirmations[stateProof.forkProof.forkMilestoneProofs[stateProof
                        .forkProof
                        .forkMilestoneProofs
                        .length - 1].blockConfirmations.length - 1].signedBlock.encodedBlock,
                    (Block)
                );

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

    function auditDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        external
        onlySelf
        returns (address[] memory slashParticipants)
    {
        require(_isCorrectDisputeCommitment(dispute, disputeAuditingData.timestamp), ErrorDisputeWrongCommitment());
        require(_isCorrectAuditingData(dispute, disputeAuditingData), ErrorDisputeWrongAuditingData());
        require(!_isExpired(disputeAuditingData.timestamp), ErrorDisputeExpired());
        require(_isCorrectGenesis(dispute, disputeAuditingData), ErrorDisputeGenesisInvalid());
        require(_verifyStateProof(dispute, disputeAuditingData), ErrorDisputeStateProofInvalid());
        require(_verifyJoinChannelBlocks(dispute, disputeAuditingData), ErrorDisputeJoinChannelBlocksInvalid());
        require(_verifyExitChannelBlocks(dispute, disputeAuditingData), ErrorDisputeExitChannelBlocksInvalid());

        FraudProofVerificationContext memory poofContext = FraudProofVerificationContext({channelId: dispute.channelId});
        (
            bytes memory encodedModifiedState,
            ExitChannelBlock memory exitBlock,
            Balance memory totalDeposits,
            Balance memory totalWithdrawals,
            address[] memory slashes
        ) = generateDisputeOutputState(
            disputeAuditingData.latestStateStateMachineState,
            dispute.fraudProofs,
            poofContext,
            dispute.onChainSlashes,
            dispute.selfRemoval ? dispute.disputer : address(0),
            dispute.timeout.participant,
            disputeAuditingData.joinChannelBlocks,
            disputeAuditingData.latestStateSnapshot
        );
        require(
            _verifyBalanceInvariantCheck(dispute.channelId, totalDeposits, totalWithdrawals),
            ErrorDisputeBalanceInvariantInvalid()
        );

        // ***************** Generate output snapshot ***************
        StateSnapshot memory outputStateSnapshot = StateSnapshot({
            stateMachineStateHash: keccak256(encodedModifiedState),
            participants: getStatemachineParticipants(encodedModifiedState),
            latestJoinChannelBlockHash: disputeAuditingData.outputStateSnapshot.latestExitChannelBlockHash, // This has been verified in _verifyJoinChannelBlocks
            latestExitChannelBlockHash: keccak256(abi.encode(exitBlock)),
            totalDeposits: totalDeposits,
            totalWithdrawals: totalWithdrawals,
            forkId: disputeData[dispute.channelId].disputeCommitments.length
        });

        //verify outputStateSnapshot commitment
        if (keccak256(abi.encode(outputStateSnapshot)) != dispute.outputStateSnapshotHash) {
            revert ErrorDisputeOutputStateSnapshotInvalid();
        }

        // Emit event for verified output state snapshot
        bytes32 disputeCommitment = keccak256(abi.encode(dispute, disputeAuditingData.timestamp));
        emit OutputStateSnapshotVerified(dispute.channelId, outputStateSnapshot, disputeCommitment);

        return slashes;
    }

    // 1. Run audit on-chain
    // 2. If audit fails:
    //    - Slash disputer
    //    - Create new dispute with updated slashes

    // 3. If audit succeeds:
    //    - Slash challenger
    //    - New dispute is ignored
    function challengeDispute(
        Dispute memory dispute,
        Dispute memory newDispute,
        DisputeAuditingData memory disputeAuditingData
    ) public {
        uint256 gasLimit = getGasLimit();
        bytes memory data = abi.encodeCall(DisputeManagerFacet.auditDispute, (dispute, disputeAuditingData));
        (bool success, bytes memory returnData) = address(this).call{gas: gasLimit}(data);
        if (!success) {
            // slash the disputer
            address[] memory slashParticipants = new address[](1);
            slashParticipants[0] = dispute.disputer;
            addOnChainSlashedParticipants(dispute.channelId, slashParticipants);
            address[] memory returnedSlashParticipants = getOnChainSlashedParticipants(dispute.channelId);
            createDispute(newDispute);
            emit DisputeChallengeResult(dispute.channelId, success, returnedSlashParticipants);
        } else {
            // slash the challenger
            address[] memory slashParticipants = abi.decode(returnData, (address[]));
            addOnChainSlashedParticipants(dispute.channelId, slashParticipants);
            uint256 disputeLength = getDisputeLength(dispute.channelId);
            DisputePair memory disputePair = DisputePair(dispute.disputeIndex, disputeLength - 1);
            disputeData[dispute.channelId].disputePairs.push(disputePair);
            address[] memory returnedSlashParticipants = getOnChainSlashedParticipants(dispute.channelId);
            emit DisputeChallengeResultWithDisputePair(
                dispute.channelId, disputePair, success, returnedSlashParticipants
            );
        }
    }

    // =============================== State Proofs Verification  ===============================
    function _verifyStateProof(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        returns (bool isValid)
    {
        //This runs after verifying auditingData and genesisStateSnapshot => we can skip those checks here

        // Milestone checking
        (bool isValid, bytes memory lastBlockEncoded) = verifyForkProof(
            dispute.stateProof.forkProof.forkMilestoneProofs,
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
            disputeAuditingData.latestStateSnapshot.stateMachineStateHash
                != keccak256(disputeAuditingData.latestStateStateMachineState)
        ) return false;
        return true;
    }

    function _isMilestoneFinal(
        ForkMilestoneProof memory milestone,
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
    function verifyForkProof(
        ForkMilestoneProof[] memory milestoneProofs,
        StateSnapshot[] memory milestoneSnapshots,
        StateSnapshot memory genesisSnapshot
    ) public returns (bool isValid, bytes memory lastBlockEncoded) {
        address[] memory participants = genesisSnapshot.participants;
        StateSnapshot memory snapshot = genesisSnapshot;
        lastBlockEncoded = "";
        // Every milestone (the final block) commits to a snapshot, that's needed to prove the next milestone => for K milestones K-1 snapshots are needed
        if (milestoneProofs.length != milestoneSnapshots.length + 1) {
            return (false, "");
        }

        for (uint256 i = 0; i < milestoneProofs.length; i++) {
            ForkMilestoneProof memory milestone = milestoneProofs[i];
            (bool isFinal, bytes32 finalizedSnapshotHash) =
                _isMilestoneFinal(milestone, participants, snapshot.stateMachineStateHash);
            if (!isFinal) {
                return (false, "");
            }
            if (keccak256(abi.encode(milestoneSnapshots[i])) != finalizedSnapshotHash) {
                return (false, "");
            }
            snapshot = milestoneSnapshots[i];
            participants = milestoneSnapshots[i].participants;

            if (i == milestoneProofs.length - 1 && milestone.blockConfirmations.length > 0) {
                lastBlockEncoded =
                    milestone.blockConfirmations[milestone.blockConfirmations.length - 1].signedBlock.encodedBlock;
            }
        }
        return (true, lastBlockEncoded);
    }

    /**
     *
     * Executes all composable operations on the global state (depositing funds, interacting with other contracts)
     * Should NOT modify the state channel state!
     * returns true on success, otherwise should revert or return false
     */
    function addParticipantComposable(JoinChannel memory joinChannel) internal returns (bool) {
        return AStateChannelManagerProxy(address(this)).addParticipantComposable(joinChannel);
    }

    /**
     *
     * Executes all composable operations on the global state (depositing funds, interacting with other contracts)
     * Should NOT modify the state channel state!
     * returns true on success, otherwise should revert or return false
     */
    function removeParticipantComposable(bytes32 channelId, ExitChannel memory exitChannel) internal returns (bool) {
        return AStateChannelManagerProxy(address(this)).removeParticipantComposable(channelId, exitChannel);
    }

    // function getNext
    //stateless

    //stateless

    function _executeStateTransitionOnState(bytes32 channelId, bytes memory encodedState, Transaction memory _tx)
        internal
        returns (bool, bytes memory)
    {
        return AStateChannelManagerProxy(address(this)).executeStateTransitionOnState(channelId, encodedState, _tx);
    }

    function isTimeoutSetWithOptional(Timeout memory timeout, bool checkOptional)
        internal
        pure
        returns (bool isSet, bool optionalSet)
    {
        if (checkOptional) {
            return (timeout.participant != address(0), timeout.previousBlockProducer != address(0));
        }
        return (timeout.participant != address(0), false);
    }

    function _getLatestHeight(StateProof memory stateProof) internal pure returns (uint256) {
        if (stateProof.signedBlocks.length == 0) {
            uint256 lastMilestoneBlockConfirmationIndex = stateProof.forkProof.forkMilestoneProofs[stateProof
                .forkProof
                .forkMilestoneProofs
                .length - 1].blockConfirmations.length - 1;
            Block memory lastMilestoneBlockConfirmation = abi.decode(
                stateProof.forkProof.forkMilestoneProofs[stateProof.forkProof.forkMilestoneProofs.length - 1]
                    .blockConfirmations[lastMilestoneBlockConfirmationIndex].signedBlock.encodedBlock,
                (Block)
            );
            return lastMilestoneBlockConfirmation.transaction.header.transactionCnt;
        }
        Block memory lastSignedBlock =
            abi.decode(stateProof.signedBlocks[stateProof.signedBlocks.length - 1].encodedBlock, (Block));
        return lastSignedBlock.transaction.header.transactionCnt;
    }

    function _isCorrectGenesis(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        view
        returns (bool)
    {
        StateSnapshot storage stateSnapshot = stateSnapshots[dispute.channelId];
        //check genesis commitment - this should always be true
        if (dispute.genesisSnapshotDataHash != keccak256(abi.encode(disputeAuditingData.genesisStateSnapshot))) {
            return false;
        }
        // Some dispute is geneisis => disputeAuditingData.previousDispute should be set correclty
        if (
            !_isCorrectDisputeCommitment(
                disputeAuditingData.previousDispute, disputeAuditingData.previousDisputeTimestamp
            )
        ) {
            return false;
        }
        //if disputing latest fork (not recursive) -> disputeAuditingData.previousDispute should be previous (this -1) dispute && previous outputSnapshot should be genesisSnapshot
        if (dispute.previousRecursiveDisputeIndex == type(uint256).max) {
            if ((dispute.disputeIndex - 1) != disputeAuditingData.previousDispute.disputeIndex) return false;
            if (disputeAuditingData.previousDispute.outputStateSnapshotHash != dispute.genesisSnapshotDataHash) {
                return false;
            }
        } else {
            //disputing recursive dispute - disputeAuditingData.previousDispute should be linked && previous genesisSnapshot should be genesisSnapshot && previous should not be expired
            if (dispute.previousRecursiveDisputeIndex != disputeAuditingData.previousDispute.disputeIndex) return false;
            if (disputeAuditingData.previousDispute.genesisSnapshotDataHash != dispute.genesisSnapshotDataHash) {
                return false;
            }
            if (_isExpired(disputeAuditingData.previousDisputeTimestamp)) {
                return false;
            }
        }

        return true;
    }

    function _verifyJoinChannelBlocks(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        pure
        returns (bool)
    {
        //check joinChannelBlocks (linked to latestSateSnapshot, chained internally and outputStateSnapshot commits to the head)
        bytes32 previousJoinChannelBlockHash = disputeAuditingData.latestStateSnapshot.latestJoinChannelBlockHash;
        for (uint256 i = 0; i < disputeAuditingData.joinChannelBlocks.length; i++) {
            if (previousJoinChannelBlockHash != disputeAuditingData.joinChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousJoinChannelBlockHash = keccak256(abi.encode(disputeAuditingData.joinChannelBlocks[i]));
        }
        return previousJoinChannelBlockHash == disputeAuditingData.outputStateSnapshot.latestJoinChannelBlockHash;
    }

    function _verifyExitChannelBlocks(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        pure
        returns (bool)
    {
        //check joinChannelBlocks (linked to latestSateSnapshot, chained internally and outputStateSnapshot commits to the head)
        bytes32 previousExitChannelBlockHash = disputeAuditingData.genesisStateSnapshot.latestExitChannelBlockHash;
        for (uint256 i = 0; i < dispute.exitChannelBlocks.length; i++) {
            if (previousExitChannelBlockHash != dispute.exitChannelBlocks[i].previousBlockHash) {
                return false;
            }
            previousExitChannelBlockHash = keccak256(abi.encode(dispute.exitChannelBlocks[i]));
        }
        return previousExitChannelBlockHash == disputeAuditingData.latestStateSnapshot.latestExitChannelBlockHash;
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
        for (uint256 i = 0; i < stateSnapshot.participants.length; i++) {
            if (stateSnapshot.participants[i] == participant) {
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

    function _isExpired(uint256 timestamp) internal view returns (bool) {
        if (block.timestamp + getChallengeTime() > timestamp) {
            return true;
        }
        return false;
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
                    revert ErrorDisputeTimeoutPreviousBlockProducerPostedCalldataMissmatch();
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
        Dispute memory dispute = abi.decode(disputeConfirmation.encodedDispute, (Dispute));
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
        (bool isThresholdFinal,) =
            StateChannelUtilLibrary.verifyThresholdSigned(thresholdSet, disputeConfirmation.encodedDispute, signatures);
        return isThresholdFinal;
    }

    function _isAuditingRequired(DisputeConfirmation memory disputeConfirmation)
        internal
        view
        returns (bool isRequired)
    {
        Dispute memory dispute = abi.decode(disputeConfirmation.encodedDispute, (Dispute));
        DisputeData storage disputeData = disputeData[dispute.channelId];
        SnapshotData storage snapshotData = stateSnapshots[dispute.channelId].snapshotData;
        uint256 thresholdCount = disputeData.pendingParticipants.length;
        if (disputeConfirmation.signatures.length < disputeData.pendingParticipants.length) return true;

        (bool isThresholdFinal,) = StateChannelUtilLibrary.verifyThresholdSigned(
            disputeData.pendingParticipants, disputeConfirmation.encodedDispute, disputeConfirmation.signatures
        );
        return !isThresholdFinal;
    }
}
