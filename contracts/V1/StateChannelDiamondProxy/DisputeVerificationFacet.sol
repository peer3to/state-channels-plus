pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./StateChannelManagerProxy.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";
import "./UtilityFacet.sol";

contract DisputeVerificationFacet is StateChannelCommon {
    function computeDisputeOutputSnapshotData(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        bytes32 latestJoinChannelBlockHash
    ) public returns (SnapshotData memory) {
        address[] memory removals = _calculateRemovals(disputeInput);
        // Disputes don't apply joins directly, just reduce
        JoinChannelBlock[] memory emptyJoinChannelBlocks = new JoinChannelBlock[](0);
        DisputeOutputState memory disputeOutputState = generateDisputeOutputState(
            latestStateMachineState, disputeInput.onChainSlashes, removals, emptyJoinChannelBlocks, latestStateSnapshot
        );

        bytes32 stateMachineStateHash = keccak256(disputeOutputState.encodedModifiedState);
        // getStateMachineParticipants fails
        address[] memory participants = getStateMachineParticipants(disputeOutputState.encodedModifiedState);
        bytes32 latestJoinChannelBlockHash = latestJoinChannelBlockHash;
        bytes32 latestExitChannelBlockHash = keccak256(abi.encode(disputeOutputState.exitBlock));
        Balance memory totalDeposits = disputeOutputState.totalDeposits;
        Balance memory totalWithdrawals = disputeOutputState.totalWithdrawals;

        // ***************** Generate output snapshot ***************
        SnapshotData memory outputSnapshotData = SnapshotData({
            originForkId: latestStateSnapshot.forkId,
            stateMachineStateHash: stateMachineStateHash,
            participants: participants,
            latestJoinChannelBlockHash: latestJoinChannelBlockHash, // Joins are not applied in disputes, but in reduce -> same hash as in the genesis snapshot
            latestExitChannelBlockHash: latestExitChannelBlockHash,
            totalDeposits: totalDeposits,
            totalWithdrawals: totalWithdrawals
        });
        return outputSnapshotData;
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
            // Note: If no disputes have blocks (genesis case), latestBlock remains uninitialized.
            // This is handled properly in reduceOutputToSnapshotData() and getReduceData() functions.

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
        //require all disputes are part of commitment
        require(areDisputesCommitted(disputeWindow, disputes), ErrorDisputeCommitmentNotAvailable());
        //require reduce challenge period is not expired - this also assures it's committed
        require(
            !_isReduceChallengePeriodExpired(disputeWindow, getEvidenceTime()), ErrorDisputeChallengePeriodExpired()
        );

        ReduceOutput memory reducedOutput = reduce(disputes);

        (SnapshotData memory snapshotData,,) = reduceOutputToSnapshotData(
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
        (SnapshotData memory snapshotData,,) = reduceOutputToSnapshotData(
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
    ) public returns (SnapshotData memory outputSnapshotData, bytes memory, ExitChannelBlock memory) {
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
            removals = UtilityFacet(utilityFacetAddress).insertIntoAddressArrayNoDuplicates(
                removals, reducedOutput.timeout.participant
            );
        }

        DisputeOutputState memory outputState = generateDisputeOutputState(
            encodedStateMachineState,
            reducedOutput.slashedParticipants,
            removals,
            joinChannelBlocks,
            latestStateSnapshot
        );

        return (
            SnapshotData({
                originForkId: forkId,
                stateMachineStateHash: keccak256(outputState.encodedModifiedState),
                participants: getStateMachineParticipants(outputState.encodedModifiedState),
                latestJoinChannelBlockHash: reducedOutput.latestJoinChannelBlockHash, // This has been verified in _verifyJoinChannelBlocks
                latestExitChannelBlockHash: keccak256(abi.encode(outputState.exitBlock)),
                totalDeposits: outputState.totalDeposits,
                totalWithdrawals: outputState.totalWithdrawals
            }),
            outputState.encodedModifiedState,
            outputState.exitBlock
        );
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
        // fails
        ExitChannel[] memory slashExitChannels;
        (outputState.encodedModifiedState, slashExitChannels) =
            _applySlashesToStateMachine(outputState.encodedModifiedState, slashParticipants);

        // Apply removals
        ExitChannel[] memory removalExitChannels;
        (outputState.encodedModifiedState, removalExitChannels) =
            _removeParticipantsFromStateMachine(outputState.encodedModifiedState, removeParticipants);

        // Combine exit channels and calculate totals
        ExitChannel[] memory allExitChannels =
            UtilityFacet(utilityFacetAddress).concatExitChannelArrays(slashExitChannels, removalExitChannels);
        outputState.totalWithdrawals = _calculateTotalWithdrawals(outputState.totalWithdrawals, allExitChannels);

        outputState.exitBlock =
            _formExitChannelBlock(latestStateSnapshot.snapshotData.latestExitChannelBlockHash, allExitChannels);

        return outputState;
    }

    // =============================== State Proofs Verification  ===============================

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
     * Useful to spectating/joining participants to prove that the channel has the right amount of funds regardless of the internal agreement of peers within it.
     * Prevents poisoned states that could happen though N/N collusion. (e.g. colluding peers claiming they have more funds than the on-chain available balance to try and steal new deposits of joining peers)
     *
     * This function and in general checking balance invariants isn't useful to existing participants that verify every state transition - if a balance was inflated, an honest peer would detect an incorrect state transition and raise a dispute.
     *
     * Each snapshot commits to an aggregated sum (totalDeposits/totalWithdrawals) that represent all the funds that have entered/existed the channel up to that point in time.
     * The snapshot also commits to some state (encodedState) that accounts for the current in-channel balance (totalDeposits-totalWithdrawals);
     * The check verifies that all the math adds up - what the Snapshot is claiming is the balance, is actually the balance that's verified against the on-chain balance.
     *
     * What this function does NOT do, is verify that the state is correct it just cares that the balance invariant is satisfied.
     * (e.g. It doesn't care if Bob has 4 tokens and Alice 6 or Bob has 8 and Alice 2 - it only cares that the total is the same e.g. 10)
     *
     * Exits and Joins happen over their respective blockchain data structures (ExitChannelBlocks & JoinChannelBlocks) which are also not checked here.
     * Snapshot commits to the head of both of these blockchains and this function assumes that the caller verified those blockchains and that the totalDeposits & totalWithdrawals that the snapshot commits to are correct
     *
     * Updating the snapshot on-chain will always apply the above check, so the onChainSnapshot can always be used as an objective single source of truth from which you start verifying everything else.
     *
     * Essentially we don't have to impose any of these checks when updating the snapshot and let it be 'poisonous' since spectating peers can easily check is it correct
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
        (bool isExpired,) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
        require(!isExpired, ErrorDisputeExpired());
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
        // require that the dispute commitment exists
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

    function _calculateRemovals(DisputeInput memory disputeInput) internal pure returns (address[] memory removals) {
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
        // It's annoying that this function can not be view/pure since the way we modify encodedState is semantically 'stateful' even though logically it's stateless

        // ***************** Generate output snapshot ***************
        SnapshotData memory outputSnapshotData = computeDisputeOutputSnapshotData(
            dispute.input,
            disputeAuditingData.latestStateSnapshot,
            disputeAuditingData.latestStateStateMachineState,
            disputeAuditingData.genesisStateSnapshotData.latestJoinChannelBlockHash
        );

        //verify outputStateSnapshot commitment
        return (keccak256(abi.encode(outputSnapshotData)) == dispute.outputSnapshotDataHash);
    }

    function _applySlashesToStateMachine(bytes memory encodedState, address[] memory slashedParticipants)
        internal
        returns (bytes memory encodedModifiedState, ExitChannel[] memory exitChannels)
    {
        exitChannels = new ExitChannel[](slashedParticipants.length);
        stateMachineImplementation.setState(encodedState);
        for (uint256 i = 0; i < slashedParticipants.length; i++) {
            bool success;
            (success, exitChannels[i]) = stateMachineImplementation.slashParticipant(slashedParticipants[i]);
            require(success, ErrorDisputeStateMachineSlashingFailed());
        }
        return (stateMachineImplementation.getState(), exitChannels);
    }

    function _removeParticipantsFromStateMachine(bytes memory encodedState, address[] memory participants)
        internal
        returns (bytes memory encodedModifiedState, ExitChannel[] memory)
    {
        ExitChannel[] memory exitChannels = new ExitChannel[](participants.length);
        stateMachineImplementation.setState(encodedState);
        for (uint256 i = 0; i < participants.length; i++) {
            bool success;
            (success, exitChannels[i]) = stateMachineImplementation.removeParticipant(participants[i]);
            // require(success, "Remove failed");
            require(success, ErrorDisputeStateMachineRemovingFailed());
        }
        return (stateMachineImplementation.getState(), exitChannels);
    }
}
