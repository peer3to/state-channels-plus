pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./StateChannelUtilLibrary.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";

contract DisputeVerificationFacet is StateChannelCommon {
    function auditDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        external
        onlySelf
        returns (address[] memory slashParticipants)
    {
        require(isCorrectAuditingData(dispute, disputeAuditingData), ErrorDisputeWrongAuditingData());
        require(_isCorrectGenesis(dispute), ErrorDisputeGenesisInvalid());
        require(verifyStateProof(dispute, disputeAuditingData, true), ErrorDisputeStateProofInvalid());
        require(_verifyDisputeExitChannelBlocks(dispute, disputeAuditingData), ErrorDisputeExitChannelBlocksInvalid());

        // ***************** Generate output snapshot ***************
        (SnapshotData memory outputSnapshotData, address[] memory slashes) = computeDisputeOutputSnapshotData(
            dispute.input,
            disputeAuditingData.latestStateSnapshot,
            disputeAuditingData.latestStateStateMachineState,
            disputeAuditingData.genesisStateSnapshotData.latestJoinChannelBlockHash
        );

        //verify outputStateSnapshot commitment
        if (keccak256(abi.encode(outputSnapshotData)) != dispute.outputSnapshotDataHash) {
            revert ErrorDisputeOutputStateSnapshotInvalid();
        }

        return slashes;
    }

    function computeDisputeOutputSnapshotData(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        bytes32 latestJoinChannelBlockHash
    ) public returns (SnapshotData memory outputSnapshotData, address[] memory slashes) {
        address[] memory removals = _calculateRemovals(disputeInput);
        // Disputes don't apply joins directly, just reduce
        JoinChannelBlock[] memory emptyJoinChannelBlocks = new JoinChannelBlock[](0);
        DisputeOutputState memory disputeOutputState = generateDisputeOutputState(
            latestStateMachineState, disputeInput.onChainSlashes, removals, emptyJoinChannelBlocks, latestStateSnapshot
        );
        SnapshotData memory latestSnapshotData = latestStateSnapshot.snapshotData;

        // ***************** Generate output snapshot ***************
        outputSnapshotData = SnapshotData({
            originForkId: latestStateSnapshot.forkId,
            stateMachineStateHash: keccak256(disputeOutputState.encodedModifiedState),
            participants: getStatemachineParticipants(disputeOutputState.encodedModifiedState),
            latestJoinChannelBlockHash: latestJoinChannelBlockHash, // Joins are not applied in disputes, but in reduce -> same hash as in the genesis snapshot
            latestExitChannelBlockHash: keccak256(abi.encode(disputeOutputState.exitBlock)),
            totalDeposits: disputeOutputState.totalDeposits,
            totalWithdrawals: disputeOutputState.totalWithdrawals
        });
    }

    function challengeDispute(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData) public {
        uint256 gasLimit = getGasLimit();
        bytes memory data = abi.encodeCall(DisputeVerificationFacet.auditDispute, (dispute, disputeAuditingData));
        (bool success, bytes memory returnData) = address(this).call{gas: gasLimit}(data);
        if (success) {
            // auditing passed - dispute is correct, slash the challenger
            if (_canParticipateInDisputes(dispute.input.channelId, msg.sender)) {
                addOnChainSlashedParticipant(dispute.input.channelId, msg.sender);
            }
        } else {
            // auditing failed - dispute is invalid, kill it
            _killDispute(dispute);
        }
    }

    function reduce(Dispute[] memory disputes) public view returns (ReduceOutput memory reducedOutput) {
        uint256 maxSlashCount;
        uint256 slashCount;
        uint256 selfRemovalCount;
        address[] memory slashParticipants;
        address[] memory selfRemovalParticipants = new address[](disputes.length);
        require(disputes.length > 0, ErrorNoDisputesProvided());
        DisputeData storage disputeData = disputeData[disputes[0].input.channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputes[0].input.genesisSnapshotDataHash];
        uint256 disputeWindowExpirationTimestamp =
            disputeWindow.evidence.lastEvidenceSubmissionTimestamp + getEvidenceTime();
        SnapshotData storage snapshotData = stateSnapshots[disputes[0].input.channelId].snapshotData;
        for (uint256 i = 0; i < disputes.length; i++) {
            Dispute memory dispute = disputes[i];

            // ***** setup / first run *****
            if (maxSlashCount == 0) {
                maxSlashCount = snapshotData.participants.length + disputeData.pendingParticipants.length;
                slashParticipants = new address[](maxSlashCount);

                //populate initially with on-chain slashes up to the dispute window expiration timestamp
                for (uint256 j = 0; j < disputeData.onChainSlashes.length; j++) {
                    if (disputeData.onChainSlashes[j].timestamp <= disputeWindowExpirationTimestamp) {
                        slashParticipants[slashCount++] = disputeData.onChainSlashes[j].participant;
                    }
                }
                // ***** reducedOutput.latestJoinChannelBlockHash *****
                ChannelBalance storage cb = channelBalances[dispute.input.channelId];
                bytes32 jcbHash = cb.latestJoinChannelBlockHash;
                while (cb.onChainJoinChannelMap[jcbHash].timestamp > disputeWindowExpirationTimestamp) {
                    jcbHash = cb.onChainJoinChannelMap[jcbHash].previousJoinChannelBlockHash;
                }
                reducedOutput.latestJoinChannelBlockHash = jcbHash;
            }

            // ***** reducedOutput.latestBlock *****
            // Extract the latest block from the state proof - it's either the last signed block or the last one in milestones
            StateProof memory stateProof = dispute.input.stateProof;
            (bool hasBlock, Block memory disputeLatestBlock) = _getLatestBlock(stateProof);

            // Take the latest block possible
            if (
                hasBlock
                    && disputeLatestBlock.transaction.header.transactionCnt
                        >= reducedOutput.latestBlock.transaction.header.transactionCnt
            ) {
                reducedOutput.latestBlock = disputeLatestBlock;
            }

            // ***** reducedOutput.slashedParticipants *****
            for (uint256 j = 0; j < dispute.input.onChainSlashes.length; j++) {
                bool isAlreadySlashed = false;
                for (uint256 k = 0; k < slashCount; k++) {
                    if (slashParticipants[k] == dispute.input.onChainSlashes[j]) {
                        isAlreadySlashed = true;
                        break;
                    }
                }
                if (!isAlreadySlashed) {
                    slashParticipants[slashCount++] = dispute.input.onChainSlashes[j];
                }
            }

            // ***** reducedOutput.timeout *****
            if (
                reducedOutput.timeout.participant == address(0)
                    || dispute.input.timeout.blockHeight < reducedOutput.timeout.blockHeight
            ) {
                reducedOutput.timeout = dispute.input.timeout;
            }

            // ***** reducedOutput.selfRemovals *****
            if (dispute.input.selfRemoval) {
                selfRemovalParticipants[selfRemovalCount++] = dispute.input.disputer;
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

    /**
     * @notice Challenges a dispute reduction by providing disputes and verification data
     * @dev IMPORTANT: The disputes array must be provided in the same order as they were committed
     *      to the dispute window. The off-chain client is responsible for ensuring disputes are
     *      ordered correctly to save on gas during verification.
     */
    function challengeDisputeReduction(
        Dispute[] memory disputes,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public {
        require(disputes.length > 0, ErrorNoDisputesProvided());
        bytes32 channelId = disputes[0].input.channelId;
        bytes32 forkId = disputes[0].input.genesisSnapshotDataHash;
        require(_canParticipateInDisputes(channelId, msg.sender), ErrorCantParticipateInDispute());
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputes[0].input.genesisSnapshotDataHash];
        //rquire all disputes are part of commitment
        require(areDisputesCommitted(disputeWindow, disputes), ErrorDisputeCommitmentNotAvailable());
        //require reduce challenge period is not expired - this also assures it's commited
        require(
            !_isReduceChallengePeriodExpired(disputeWindow, getEvidenceTime()), ErrorDisputeChallengePeriodExpired()
        );

        ReduceOutput memory reducedOutput = reduce(disputes);

        SnapshotData memory snapshotData = reduceOutputToSnapshotData(
            forkId, reducedOutput, latestStateSnapshot, encodedStateMachineState, joinChannelBlocks
        );

        bytes32 winningForkId = keccak256(abi.encode(snapshotData));
        if (winningForkId != disputeWindow.reducedResult.forkId) {
            addOnChainSlashedParticipant(channelId, disputeWindow.reducedResult.reducer);
            disputeWindow.reducedResult.forkId = bytes32(0); // unset
            _commitToDisputeReducedResult(channelId, disputeWindow, winningForkId, block.timestamp - getEvidenceTime());
        } else {
            addOnChainSlashedParticipant(channelId, msg.sender);
        }
    }

    /**
     * @notice Reduces disputes and finalizes by committing the reduced result to the dispute window
     * @dev This performs reduction and commitment. It requires that the caller an participate in
     *      disputes. The actual commit enforces that the kill period has expired
     *      via _commitToDisputeReducedResult.
     */
    function reduceAndFinalize(
        Dispute[] memory disputes,
        StateSnapshot memory stateSnapshot,
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public {
        require(disputes.length > 0, ErrorNoDisputesProvided());
        bytes32 channelId = disputes[0].input.channelId;
        bytes32 forkId = disputes[0].input.genesisSnapshotDataHash;
        require(_canParticipateInDisputes(channelId, msg.sender), ErrorCantParticipateInDispute());

        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[disputes[0].input.genesisSnapshotDataHash];
        // require that provided disputes correspond to committed set
        require(areDisputesCommitted(disputeWindow, disputes), ErrorDisputeCommitmentNotAvailable());

        // compute reduced output and derive snapshot data
        ReduceOutput memory reducedOutput = reduce(disputes);
        SnapshotData memory snapshotData = reduceOutputToSnapshotData(
            forkId, reducedOutput, stateSnapshot, encodedStateMachineState, joinChannelBlocks
        );

        // compute the new forkId
        bytes32 winningForkId = keccak256(abi.encode(snapshotData));

        // commit reduced result (enforces kill period expiration inside)
        _commitToDisputeReducedResult(channelId, disputeWindow, winningForkId, block.timestamp - getEvidenceTime());
    }

    function applyDisputeFraudProofs(DisputeFraudProof[] memory proofs) public {
        bytes memory result = StateChannelManagerProxy(address(this)).verifyDisputeFraudProofs(proofs);
        Dispute[] memory maliciousDisputes = abi.decode(result, (Dispute[]));
        for (uint256 i = 0; i < maliciousDisputes.length; i++) {
            _killDispute(maliciousDisputes[i]);
        }
    }

    function reduceOutputToSnapshotData(
        bytes32 forkId,
        ReduceOutput memory reducedOutput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        JoinChannelBlock[] memory joinChannelBlocks
    ) public returns (SnapshotData memory outputSnapshotData) {
        //verify snapshot linked to reducedOutput.latestBlock
        Block memory latestBlock = reducedOutput.latestBlock;
        if (latestBlock.transaction.header.forkId == bytes32(0)) {
            //no blocks in reducedOutput - must be genesis
            // TODO - think - this ensures that snapshotData is correct, not the snapshot, which means someone can lie about the time, but it shouldn't matter here - we just care to perform the correct State Transition
            require(keccak256(abi.encode(latestStateSnapshot.snapshotData)) == forkId, ErrorInvalidStateSnapshot());
        } else {
            // reducedOutput.latestBlock is a defined block - verify it links to the snapshot
            require(
                latestBlock.stateSnapshotHash == keccak256(abi.encode(latestStateSnapshot)), ErrorInvalidStateSnapshot()
            );
        }
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
            originForkId: forkId,
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
        (outputState.encodedModifiedState, outputState.totalDeposits) =
            _applyJoins(encodedStateMachineState, joinChannelBlocks, outputState.totalDeposits);

        // Apply slashes
        ExitChannel[] memory slashExitChannels;
        (outputState.encodedModifiedState, slashExitChannels) = StateChannelManagerProxy(address(this))
            .applySlashesToStateMachine(outputState.encodedModifiedState, slashParticipants);

        // Apply removals
        ExitChannel[] memory removalExitChannels;
        (outputState.encodedModifiedState, removalExitChannels) = StateChannelManagerProxy(address(this))
            .removeParticipantsFromStateMachine(outputState.encodedModifiedState, removeParticipants);

        // Combine exit channels and calculate totals
        ExitChannel[] memory allExitChannels =
            StateChannelUtilLibrary.concatExitChannelArrays(slashExitChannels, removalExitChannels);
        outputState.totalWithdrawals = _calculateTotalWithdrawals(outputState.totalWithdrawals, allExitChannels);

        outputState.exitBlock =
            _formExitChannelBlock(latestStateSnapshot.snapshotData.latestExitChannelBlockHash, allExitChannels);

        return outputState;
    }

    // =============================== State Proofs Verification  ===============================

    function verifyStateProof(
        Dispute memory dispute,
        DisputeAuditingData memory disputeAuditingData,
        bool auditingDataIntegrityVerified
    ) public pure returns (bool) {
        if (auditingDataIntegrityVerified) {
            if (
                dispute.input.genesisSnapshotDataHash
                    != keccak256(abi.encode(disputeAuditingData.genesisStateSnapshotData))
            ) return false;
        } else {
            require(
                dispute.input.genesisSnapshotDataHash
                    == keccak256(abi.encode(disputeAuditingData.genesisStateSnapshotData)),
                ErrorDisputeGenesisInvalid()
            );
        }

        bytes32 latestSnapshotDataHash = keccak256(abi.encode(disputeAuditingData.latestStateSnapshot.snapshotData));
        bytes32 latestSnanpshotHash = keccak256(abi.encode(disputeAuditingData.latestStateSnapshot));

        if (dispute.input.stateProof.milestones.length != 0 && dispute.input.stateProof.signedBlocks.length != 0) {
            return false;
        }

        // Milestone checking
        (bool isValid, bytes memory lastBlockEncoded) = verifyMilestones(
            dispute.input.stateProof.milestones,
            disputeAuditingData.milestoneSnapshots,
            disputeAuditingData.genesisStateSnapshotData
        );
        if (!isValid) {
            return false;
        }
        // If no blocks in milestones
        if (lastBlockEncoded.length == 0) {
            if (dispute.input.stateProof.signedBlocks.length == 0) {
                // no blocks at all => genesis == latest
                if (auditingDataIntegrityVerified) {
                    if (
                        dispute.input.genesisSnapshotDataHash != latestSnapshotDataHash
                            || dispute.input.latestStateSnapshotHash != latestSnanpshotHash
                    ) return false;
                } else {
                    require(
                        dispute.input.genesisSnapshotDataHash == latestSnapshotDataHash
                            && dispute.input.latestStateSnapshotHash == latestSnanpshotHash,
                        ErrorIncorrectSnapshotProvided()
                    );
                }
            } else {
                //check if signedBlocks are linked, signed and build on genesis
                if (
                    !_areSignedBlocksLinkedAndVerified(
                        dispute.input.stateProof.signedBlocks, dispute.input.genesisSnapshotDataHash
                    )
                ) return false;

                Block memory lastBlock = abi.decode(
                    dispute.input.stateProof.signedBlocks[dispute.input.stateProof.signedBlocks.length - 1].encodedBlock,
                    (Block)
                );
                //check if lastBlock commits to the latestStateSnapshot
                if (lastBlock.stateSnapshotHash != dispute.input.latestStateSnapshotHash) return false;
            }
        } else {
            // - At least one milestone with at least one block -
            // Think this will never trigger, since we only build signedBlocks if there is not finality (linked to genesis), otherwise the latest state is included in a milestone
            // TODO - think could this be exploited

            // This check is redundant since we already have this check at the beginning of the function, but have it here for clarity
            if (dispute.input.stateProof.signedBlocks.length != 0) return false;

            Block memory lastBlock = abi.decode(lastBlockEncoded, (Block));
            //check if lastBlock commits to the latestStateSnapshot
            if (lastBlock.stateSnapshotHash != dispute.input.latestStateSnapshotHash) {
                return false;
            }
        }
        if (auditingDataIntegrityVerified) {
            //check commitment to latestStateSnapshot
            if (dispute.input.latestStateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot)))
            {
                return false;
            }
        }
        return true;
    }

    function _isMilestoneFinal(SnapshotData memory genesisSnapshotData, MilestoneProof memory milestone)
        internal
        pure
        returns (bool isFinal, bytes32 finalizedSnapshotHash)
    {
        bytes32 genesisForkId = keccak256(abi.encode(genesisSnapshotData));
        address[] memory expectedParticipants = genesisSnapshotData.participants;
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
        SnapshotData memory genesisSnapshotData
    ) public pure returns (bool isValid, bytes memory lastBlockEncoded) {
        SnapshotData memory snapshotData = genesisSnapshotData;
        lastBlockEncoded = "";

        // For K milestones, K-1 snapshots are needed to prove the last milestone is final, but for cleaner code we include the K-th snapshot too, even though it doesn't have to be used
        if (milestoneProofs.length != milestoneSnapshots.length) {
            return (false, lastBlockEncoded);
        }

        for (uint256 i = 0; i < milestoneProofs.length; i++) {
            MilestoneProof memory milestone = milestoneProofs[i];
            (bool isFinal, bytes32 finalizedSnapshotHash) = _isMilestoneFinal(snapshotData, milestone);
            if (!isFinal) {
                return (false, lastBlockEncoded);
            }
            // isFinal - since this runs in isolation now (not atomically with auditing where everthing is checked), revert the transaction if the disputer didn't provide the correct snapshot
            // Since it's final, the disputer for sure has the correct snapshot, so we can just revert if it's not provided
            require(
                keccak256(abi.encode(milestoneSnapshots[i])) == finalizedSnapshotHash, ErrorIncorrectSnapshotProvided()
            );

            snapshotData = milestoneSnapshots[i].snapshotData;
            if (i == milestoneProofs.length - 1 && milestone.blockConfirmations.length > 0) {
                lastBlockEncoded =
                    milestone.blockConfirmations[milestone.blockConfirmations.length - 1].signedBlock.encodedBlock;
            }
        }
        return (true, lastBlockEncoded);
    }

    function _isCorrectGenesis(Dispute memory dispute) internal view returns (bool) {
        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        if (!hasBlock) {
            //no blocks in state proof - must be genesis
            return true; // TODO This will be a dispute fraud proof, since the dispute struct doesn't have enough information to deduct this
        }
        return _areDisputeAndBlockSameFork(dispute, latestBlock);
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

    function _verifyDisputeExitChannelBlocks(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        internal
        view
        returns (bool)
    {
        return _verifyExitChannelBlocks(
            disputeAuditingData.exitChannelBlocks,
            disputeAuditingData.genesisStateSnapshotData,
            disputeAuditingData.latestStateSnapshot.snapshotData
        );
    }
    /**
     *
     * Usefull to spactating/joining participants to prove that the channel has the right amount of funds regardless of the internal agreement of peers within it.
     * Prevents poisoned states that could happen though N/N collusion. (e.g. colluding peers caliming they have more funds than the on-chain available balance to try and steal new deposits of joining peers)
     *
     * This function and in general checking balance invariants isn't usuefull to existing participants that verify every state transition - if a balance was infalted, an honest peer would detect an incorrect state transition and raise a dispute.
     *
     * Each snapshot commits to an aggregated sum (totalDeposits/totalWithdrawals) that represent all the funds that have entered/existed the channel up to that point in time.
     * The snapshot also commits to some state (encodedState) that accounts for the current in-channel balance (totalDeposits-totalWithdrawals);
     * The check verifies that all the math adds up - what the Snapshot is claming is the balance, is actually the balance that's verified against the on-chain balance.
     *
     * What this function does NOT do, is verify that the state is correct it just cares that the balance invariant is satisifed.
     * (e.g. It doesn't care if Bob has 4 tokens and Alice 6 or Bob has 8 and Alice 2 - it only cares that the total is the same e.g. 10)
     *
     * Exits and Joins happen over their respective blockchain data strucutres (ExitChannelBlocks & JoinChannelBlocks) which are also not checked here.
     * Snapshot commits to the head of both of these blockchains and this function assumes that the caller verified those blockchains and that the totalDeposits & totalWithdrawals that the snapshot commits to are correct
     *
     * Updating the snapshot on-chain will always apply the above check, so the onChainSnapshot can always be used as an objective single source of truth from which you start veryfing everything else.
     *
     * Esentially we don't have to impose any of these checks when updating the snapshot and let it be 'poisonous' since spectating peers can easily check is it correct
     * onChainDeposits == onChainSnapshot.totalDeposits
     * onChainWithdrawals == onChainSnapshot.totalWithdrawals
     * but since this check is so trivial we'll add as the last check onSnapshotUpdate
     *
     * The spectating peer can also request the state at the onChainSnapshot, but it's not needed - only the latestState balance is relevant and only that needs to be checked
     *
     */

    function verifyBalanceInvariantCheckSnapshot(
        bytes32 channelId,
        SnapshotData memory snapshotData,
        bytes memory encodedStateMachineState
    ) public returns (bool) {
        ChannelBalance storage channelBalance = channelBalances[channelId];
        Balance memory onChainDeposits =
            channelBalance.onChainJoinChannelMap[snapshotData.latestJoinChannelBlockHash].totalDeposits;
        Balance memory onChainWithdrawals = channelBalance.totalOnChainWithdrawals;
        if (snapshotData.stateMachineStateHash != keccak256(encodedStateMachineState)) return false;
        //on-chain deposits have to match latestState deposits since deposits only happen on-chain
        if (!stateMachineImplementation.areBalancesEqual(snapshotData.totalDeposits, onChainDeposits)) return false;
        //total withdrawals >= on-chain withdrawals since on-chain withdrawals are already processed
        if (stateMachineImplementation.isBalanceLesserThan(snapshotData.totalWithdrawals, onChainWithdrawals)) {
            return false;
        }
        stateMachineImplementation.setState(encodedStateMachineState);
        Balance memory stateMachineBalance = stateMachineImplementation.getTotalStateBalance(); // The state is already set
        // totalDeposits == totalWithdrawals + stateMachineBalance
        if (
            !stateMachineImplementation.areBalancesEqual(
                snapshotData.totalDeposits,
                stateMachineImplementation.addBalance(snapshotData.totalWithdrawals, stateMachineBalance)
            )
        ) return false;
        return true;
    }

    function _killDispute(Dispute memory dispute) internal {
        DisputeData storage disputeData = disputeData[dispute.input.channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[_getDisputeFork(dispute)];

        // require that the dispute window exists and is not expired
        require(
            disputeWindow.evidence.creationTimestamp != 0 && !_isKillPeriodExpired(disputeWindow, getEvidenceTime()),
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
        addOnChainSlashedParticipant(dispute.input.channelId, dispute.input.disputer);

        // remove the dispute commitment
        disputeWindow.evidence.disputeCommitments[foundIndex] =
            disputeWindow.evidence.disputeCommitments[disputeWindow.evidence.disputeCommitments.length - 1];
        disputeWindow.evidence.disputeCommitments.pop();

        //if dispute window is empty, delete it
        if (disputeWindow.evidence.disputeCommitments.length == 0) {
            bytes32 forkId = _getDisputeFork(dispute);
            delete disputeData.disputeWindowMap[forkId];

            for (uint256 i = 0; i < disputeData.disputedForks.length; i++) {
                if (disputeData.disputedForks[i] == forkId) {
                    //remove disputed fork from the list
                    disputeData.disputedForks[i] = disputeData.disputedForks[disputeData.disputedForks.length - 1];
                    disputeData.disputedForks.pop();
                    break;
                }
            }
            emit DisputeKilled(dispute.input.channelId, forkId, dispute.input.disputer);
        }
    }

    function _calculateRemovals(DisputeInput memory disputeInput) internal view returns (address[] memory removals) {
        //Try and combine timeout and selfRemoval -> max 2 removals per dispute
        uint256 removalCount = 0;
        address[] memory _removals = new address[](2);
        // Always apply selfRemoval if set
        if (disputeInput.selfRemoval) {
            _removals[removalCount++] = disputeInput.disputer;
        }
        // Ignore timeout if unset or if there are slashes
        if (disputeInput.onChainSlashes.length == 0 && disputeInput.timeout.participant != address(0)) {
            _removals[removalCount++] = disputeInput.timeout.participant;
        }

        removals = new address[](removalCount);
        for (uint256 i = 0; i < removalCount; i++) {
            removals[i] = _removals[i];
        }
        return removals;
    }

    function checkDisputeAuditingDataCommitment(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        pure
        returns (bool)
    {
        return dispute.input.disputeAuditingDataHash == keccak256(abi.encode(disputeAuditingData));
    }

    function isCorrectAuditingData(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        view
        returns (bool)
    {
        // Doesn't check data integrity (disputeAuditingDataHash == hash(disputeAuditingData))

        // Check dispute commits to genesisStateSnapshot
        if (
            dispute.input.genesisSnapshotDataHash != keccak256(abi.encode(disputeAuditingData.genesisStateSnapshotData))
        ) return false;

        // Check latestStateSnapshot
        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        if (
            hasBlock
                && (
                    latestBlock.stateSnapshotHash != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot))
                        || latestBlock.stateSnapshotHash != dispute.input.latestStateSnapshotHash
                )
        ) {
            return false;
        }
        if (
            !hasBlock
                && dispute.input.genesisSnapshotDataHash
                    != keccak256(abi.encode(disputeAuditingData.latestStateSnapshot.snapshotData))
        ) {
            return false;
        }

        // Check milestones
        Block[] memory milestoneBlocks = _getMilestoneBlocks(dispute.input.stateProof);
        if (milestoneBlocks.length != disputeAuditingData.milestoneSnapshots.length) return false;
        for (uint256 i = 0; i < milestoneBlocks.length; i++) {
            if (
                milestoneBlocks[i].stateSnapshotHash != keccak256(abi.encode(disputeAuditingData.milestoneSnapshots[i]))
            ) {
                return false;
            }
        }

        // Check latest stateMachineState
        if (
            disputeAuditingData.latestStateSnapshot.snapshotData.stateMachineStateHash
                != keccak256(disputeAuditingData.latestStateStateMachineState)
        ) return false;

        // Check exitChannelBlocks
        if (!_verifyDisputeExitChannelBlocks(dispute, disputeAuditingData)) return false;

        return true;
    }

    function isDisputeOutputCorrect(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        returns (bool)
    {
        // It's anoying that this function can not be view/pure since the way we modify encoedState is semanticaly 'stateful' even though logicaly it's stateless

        // ***************** Generate output snapshot ***************
        (SnapshotData memory outputSnapshotData, address[] memory slashes) = computeDisputeOutputSnapshotData(
            dispute.input,
            disputeAuditingData.latestStateSnapshot,
            disputeAuditingData.latestStateStateMachineState,
            disputeAuditingData.genesisStateSnapshotData.latestJoinChannelBlockHash
        );

        //verify outputStateSnapshot commitment
        return (keccak256(abi.encode(outputSnapshotData)) == dispute.outputSnapshotDataHash);
    }
}
