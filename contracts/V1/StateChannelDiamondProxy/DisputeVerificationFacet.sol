pragma solidity ^0.8.8;

import "./StateChannelCommon.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";
import "./UtilityFacet.sol";
import "hardhat/console.sol";

contract DisputeVerificationFacet is StateChannelCommon {
    function computeDisputeOutputSnapshotData(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (SnapshotData memory) {
        DisputeOutputState memory disputeOutputState = _generateDisputeOutputState(
            latestStateMachineState,
            disputeInput.onChainSlashes,
            _selfRemovals(disputeInput),
            disputeInput.timeout.participant,
            inboundMessageBlocks,
            latestStateSnapshot
        );

        bytes32 stateMachineStateHash = keccak256(disputeOutputState.encodedModifiedState);
        // _generateDisputeOutputState leaves the output state loaded
        address[] memory participants = stateMachineImplementation.getParticipants();
        Balance memory totalDeposits = disputeOutputState.totalDeposits;
        Balance memory totalWithdrawals = disputeOutputState.totalWithdrawals;
        bytes32 latestOutboundBlockHash = latestStateSnapshot.snapshotData.latestOutboundMessageBlockHash;
        uint256 outboundHeight = disputeOutputState.outboundMessageBlock.blockHeight;
        if (disputeOutputState.outboundMessageBlock.messages.length > 0) {
            latestOutboundBlockHash = keccak256(abi.encode(disputeOutputState.outboundMessageBlock));
        }

        // ***************** Generate output snapshot ***************
        SnapshotData memory outputSnapshotData = SnapshotData({
            originForkId: latestStateSnapshot.forkId,
            stateMachineStateHash: stateMachineStateHash,
            participants: participants,
            latestInboundMessageBlockHash: disputeInput.latestInboundMessageBlockHash,
            latestInboundMessageBlockHeight: disputeInput.lastInboundMessageBlockHeight,
            latestOutboundMessageBlockHash: latestOutboundBlockHash,
            latestOutboundMessageBlockHeight: outboundHeight,
            totalDeposits: totalDeposits,
            totalWithdrawals: totalWithdrawals
        });
        return outputSnapshotData;
    }

    function computeDisputeOutputState(
        DisputeInput memory disputeInput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (DisputeOutputState memory outputState) {
        return _generateDisputeOutputState(
            latestStateMachineState,
            disputeInput.onChainSlashes,
            _selfRemovals(disputeInput),
            disputeInput.timeout.participant,
            inboundMessageBlocks,
            latestStateSnapshot
        );
    }

    /// Folds the committed disputes of one fork. `slashedParticipants` holds the slash candidates: the on-chain
    /// slashes up to the dispute window end and the disputes' listed slashes, deduplicated. The fold reads no
    /// participant set, so early, late, local and on-chain reducers fold the same candidates; only candidates that
    /// are participants of the reduced latest state take effect (_generateDisputeOutputState).
    function reduce(Dispute[] memory disputes) public view returns (ReduceOutput memory reducedOutput) {
        require(disputes.length > 0, ErrorNoDisputesProvided());
        bytes32 channelId = disputes[0].input.channelId;
        DisputeWindow storage disputeWindow = disputeData[channelId].disputeWindowMap[disputes[0].input.forkId];
        uint256 disputeWindowExpirationTimestamp =
            disputeWindow.evidence.lastEvidenceSubmissionTimestamp + _getEvidenceTime();

        // ***** on-chain slash candidates (recorded in time order, unique) *****
        address[] memory onChainSlashes =
            _getOnChainSlashedParticipantsUpToTimestamp(channelId, disputeWindowExpirationTimestamp);
        uint256 slashCount = onChainSlashes.length;
        for (uint256 i = 0; i < disputes.length; i++) {
            slashCount += disputes[i].input.onChainSlashes.length;
        }
        address[] memory slashParticipants = new address[](slashCount);
        for (slashCount = 0; slashCount < onChainSlashes.length; slashCount++) {
            slashParticipants[slashCount] = onChainSlashes[slashCount];
        }

        // ***** reducedOutput.latestInboundMessageBlockHash *****
        bytes32 inboundHash = channelBalances[channelId].latestInboundMessageBlockHash;
        MessageBlock storage inboundBlock = inboundMessageBlockMap[channelId][inboundHash];
        while (inboundHash != bytes32(0) && inboundBlock.timestamp > disputeWindowExpirationTimestamp) {
            inboundHash = inboundBlock.previousBlockHash;
            inboundBlock = inboundMessageBlockMap[channelId][inboundHash];
        }
        reducedOutput.latestInboundMessageBlockHash = inboundHash;
        reducedOutput.latestInboundMessageBlockHeight = inboundBlock.blockHeight;

        uint256 selfRemovalCount;
        bool latestBlockInitialized;
        address[] memory selfRemovalParticipants = new address[](disputes.length);
        for (uint256 i = 0; i < disputes.length; i++) {
            Dispute memory dispute = disputes[i];

            // ***** reducedOutput.latestBlock *****
            // Extract the latest block from the state proof - it's either the last signed block or the last one in milestones
            StateProof memory stateProof = dispute.input.stateProof;
            (bool hasBlock, Block memory disputeLatestBlock) = _getLatestBlock(stateProof);

            // Take the latest block possible
            if (hasBlock) {
                uint256 candidateTxCount = disputeLatestBlock.transaction.header.transactionCnt;
                if (!latestBlockInitialized) {
                    reducedOutput.latestBlock = disputeLatestBlock;
                    latestBlockInitialized = true;
                } else {
                    uint256 currentTxCount = reducedOutput.latestBlock.transaction.header.transactionCnt;
                    if (candidateTxCount > currentTxCount) {
                        reducedOutput.latestBlock = disputeLatestBlock;
                    } else if (
                        candidateTxCount == currentTxCount
                            && _getBlockHash(disputeLatestBlock) < _getBlockHash(reducedOutput.latestBlock)
                    ) {
                        reducedOutput.latestBlock = disputeLatestBlock;
                    }
                }
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
        reducedOutput.slashedParticipants = _shrinkAddressArray(slashParticipants, slashCount);
        reducedOutput.selfRemovals = _shrinkAddressArray(selfRemovalParticipants, selfRemovalCount);
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
        MessageBlock[] memory inboundMessageBlocks
    ) public {
        require(disputes.length > 0, ErrorNoDisputesProvided());
        bytes32 channelId = disputes[0].input.channelId;
        bytes32 forkId = disputes[0].input.forkId;
        require(
            _canParticipateInDisputesNow(channelId, msg.sender), ErrorCantParticipateInDispute(channelId, msg.sender)
        );
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[disputes[0].input.forkId];
        //require all disputes are part of commitment
        // `if (!...) revert` because the committed list is a storage read
        // `areDisputesCommitted` makes internally and the submitted hashes are
        // only worth computing once the comparison has already failed (P4).
        if (!areDisputesCommitted(disputeWindow, disputes)) {
            revert ErrorDisputeCommitmentNotAvailable(
                channelId, forkId, disputeWindow.evidence.disputeCommitments, _disputeCommitmentHashes(disputes)
            );
        }
        //require reduce challenge period is not expired - this also assures it's committed
        (bool challengePeriodExpired, uint256 challengePeriodEnd) =
            _isReduceChallengePeriodExpired(disputeWindow, _getEvidenceTime());
        require(!challengePeriodExpired, ErrorDisputeChallengePeriodExpired(challengePeriodEnd, block.timestamp));

        ReduceOutput memory reducedOutput = reduce(disputes);

        (SnapshotData memory snapshotData,,) = reduceOutputToSnapshotData(
            forkId, reducedOutput, latestStateSnapshot, encodedStateMachineState, inboundMessageBlocks
        );

        bytes32 winningForkId = keccak256(abi.encode(snapshotData));
        if (winningForkId != disputeWindow.reducedResult.forkId) {
            addOnChainSlashedParticipant(channelId, disputeWindow.reducedResult.reducer);
            disputeWindow.reducedResult.forkId = bytes32(0); // unset
            _commitToDisputeReducedResult(channelId, disputeWindow, winningForkId, block.timestamp - _getEvidenceTime());
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
        MessageBlock[] memory inboundMessageBlocks,
        bytes32 expectedReducedForkId
    ) public {
        require(disputes.length > 0, ErrorNoDisputesProvided());
        bytes32 channelId = disputes[0].input.channelId;
        bytes32 forkId = disputes[0].input.forkId;

        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[disputes[0].input.forkId];

        // no dispute window exists for this fork -> nothing to reduce
        if (!_isDisputeWidnowCreated(disputeWindow)) {
            return;
        }

        // already reduced: expectation must match
        if (disputeWindow.reducedResult.forkId != bytes32(0)) {
            require(
                disputeWindow.reducedResult.forkId == expectedReducedForkId,
                RaceConditionReductionExpectationDoesntMatch(expectedReducedForkId, disputeWindow.reducedResult.forkId)
            );
            return;
        }

        // require that provided disputes correspond to committed set
        // `if (!...) revert` because the committed list is a storage read
        // `areDisputesCommitted` makes internally and the submitted hashes are
        // only worth computing once the comparison has already failed (P4).
        if (!areDisputesCommitted(disputeWindow, disputes)) {
            revert ErrorDisputeCommitmentNotAvailable(
                channelId, forkId, disputeWindow.evidence.disputeCommitments, _disputeCommitmentHashes(disputes)
            );
        }

        // compute reduced output and derive snapshot data
        ReduceOutput memory reducedOutput = reduce(disputes);
        (SnapshotData memory snapshotData,,) = reduceOutputToSnapshotData(
            forkId, reducedOutput, stateSnapshot, encodedStateMachineState, inboundMessageBlocks
        );

        // compute the new forkId
        bytes32 winningForkId = keccak256(abi.encode(snapshotData));

        require(
            winningForkId == expectedReducedForkId,
            RaceConditionReductionExpectationDoesntMatch(expectedReducedForkId, winningForkId)
        );

        // commit reduced result (enforces kill period expiration inside)
        _commitToDisputeReducedResult(channelId, disputeWindow, winningForkId, block.timestamp - _getEvidenceTime());
    }

    function killDispute(Dispute memory dispute) public {
        _killDispute(dispute);
    }

    function reduceOutputToSnapshotData(
        bytes32 forkId,
        ReduceOutput memory reducedOutput,
        StateSnapshot memory latestStateSnapshot,
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (SnapshotData memory outputSnapshotData, bytes memory, MessageBlock memory) {
        //verify snapshot linked to reducedOutput.latestBlock
        Block memory latestBlock = reducedOutput.latestBlock;
        if (latestBlock.transaction.header.forkId == bytes32(0)) {
            //no blocks in reducedOutput - must be genesis
            // TODO - think - this ensures that snapshotData is correct, not the snapshot, which means someone can lie about the time, but it shouldn't matter here - we just care to perform the correct State Transition
            bytes32 actualForkId = keccak256(abi.encode(latestStateSnapshot.snapshotData));
            require(actualForkId == forkId, ErrorSnapshotDataForkMismatch(forkId, actualForkId));
        } else {
            // reducedOutput.latestBlock is a defined block - verify it links to the snapshot
            bytes32 actualStateSnapshotHash = keccak256(abi.encode(latestStateSnapshot));
            require(
                latestBlock.stateSnapshotHash == actualStateSnapshotHash,
                ErrorInvalidStateSnapshotHash(latestBlock.stateSnapshotHash, actualStateSnapshotHash)
            );
        }
        //verify encodedStateMachineState linked to snapshot
        bytes32 actualStateMachineStateHash = keccak256(encodedStateMachineState);
        require(
            latestStateSnapshot.snapshotData.stateMachineStateHash == actualStateMachineStateHash,
            ErrorInvalidLatestState(latestStateSnapshot.snapshotData.stateMachineStateHash, actualStateMachineStateHash)
        );
        //verify inbound message blocks
        (bool inboundMessageBlocksValid, bytes32 runningInboundHash, uint256 breakIndex, uint8 failureReason) =
        _verifyInboundMessageBlocks(
            latestStateSnapshot.snapshotData.latestInboundMessageBlockHash,
            reducedOutput.latestInboundMessageBlockHash,
            inboundMessageBlocks
        );
        require(
            inboundMessageBlocksValid,
            ErrorDisputeInboundMessageBlocksInvalid(
                latestStateSnapshot.snapshotData.latestInboundMessageBlockHash,
                reducedOutput.latestInboundMessageBlockHash,
                runningInboundHash,
                breakIndex,
                inboundMessageBlocks.length,
                failureReason
            )
        );

        DisputeOutputState memory outputState = _generateDisputeOutputState(
            encodedStateMachineState,
            reducedOutput.slashedParticipants,
            reducedOutput.selfRemovals,
            reducedOutput.timeout.participant,
            inboundMessageBlocks,
            latestStateSnapshot
        );

        bytes32 nextOutboundMessageBlockHash = latestStateSnapshot.snapshotData.latestOutboundMessageBlockHash;
        uint256 outboundHeight = outputState.outboundMessageBlock.blockHeight;
        if (outputState.outboundMessageBlock.messages.length > 0) {
            nextOutboundMessageBlockHash = keccak256(abi.encode(outputState.outboundMessageBlock));
        }

        return (
            SnapshotData({
                originForkId: forkId,
                stateMachineStateHash: keccak256(outputState.encodedModifiedState),
                // _generateDisputeOutputState leaves the output state loaded
                participants: stateMachineImplementation.getParticipants(),
                latestInboundMessageBlockHash: reducedOutput.latestInboundMessageBlockHash, // Verified in _verifyInboundMessageBlocks
                latestInboundMessageBlockHeight: reducedOutput.latestInboundMessageBlockHeight,
                latestOutboundMessageBlockHash: nextOutboundMessageBlockHash,
                latestOutboundMessageBlockHeight: outboundHeight,
                totalDeposits: outputState.totalDeposits,
                totalWithdrawals: outputState.totalWithdrawals
            }),
            outputState.encodedModifiedState,
            outputState.outboundMessageBlock
        );
    }

    // Doesn't do any checks and just applies all slashes, removals and joins to a specific stateMachineState and generates the outputStateMachineState - similar logic to playTransaction in the typescript code - this is done to help the backer generate a correct output state while forging the dispute.
    // The state is loaded into the state machine once and read back once; the output state stays loaded for the caller.
    // A slash takes effect only for a participant of the loaded state after its joins: the fork's participant state.
    // The state machine refuses any other slash, e.g. of a participant an ancestor fork already removed. A timeout
    // (address(0) for none) removes its participant only when no slash took effect (slashes take precedence).
    function _generateDisputeOutputState(
        bytes memory encodedStateMachineState,
        address[] memory slashParticipants,
        address[] memory removeParticipants,
        address timeoutParticipant,
        MessageBlock[] memory inboundMessageBlocks,
        StateSnapshot memory latestStateSnapshot
    ) internal returns (DisputeOutputState memory outputState) {
        outputState.totalDeposits = latestStateSnapshot.snapshotData.totalDeposits;
        outputState.totalWithdrawals = latestStateSnapshot.snapshotData.totalWithdrawals;

        stateMachineImplementation.setState(encodedStateMachineState);

        // Apply joins
        outputState.totalDeposits =
            _applyInboundMessages(encodedStateMachineState, inboundMessageBlocks, outputState.totalDeposits);

        // Apply slashes
        ExitChannel[] memory slashExitChannels = _applySlashesToStateMachine(slashParticipants);
        if (timeoutParticipant != address(0) && slashExitChannels.length == 0) {
            removeParticipants = UtilityFacet(utilityFacetAddress).insertIntoAddressArrayNoDuplicates(
                removeParticipants, timeoutParticipant
            );
        }

        // Apply removals
        ExitChannel[] memory removalExitChannels = _removeParticipantsFromStateMachine(removeParticipants);

        outputState.encodedModifiedState = stateMachineImplementation.getState();

        // Combine exit channels and calculate totals
        ExitChannel[] memory allExitChannels =
            UtilityFacet(utilityFacetAddress).concatExitChannelArrays(slashExitChannels, removalExitChannels);
        outputState.totalWithdrawals = _calculateTotalWithdrawals(outputState.totalWithdrawals, allExitChannels);

        Message[] memory outboundMessages = new Message[](allExitChannels.length);
        for (uint256 i = 0; i < allExitChannels.length; i++) {
            outboundMessages[i] = Message({
                messageType: MESSAGE_TYPE_EXIT,
                participant: allExitChannels[i].participant,
                balance: allExitChannels[i].balance,
                data: abi.encode(allExitChannels[i])
            });
        }
        MessageBlock memory outboundMessageBlock;
        outboundMessageBlock.previousBlockHash = latestStateSnapshot.snapshotData.latestOutboundMessageBlockHash;
        uint256 outboundHeight = latestStateSnapshot.snapshotData.latestOutboundMessageBlockHeight;
        if (outboundMessages.length > 0) {
            outboundMessageBlock.blockHeight = outboundHeight + 1;
        } else {
            outboundMessageBlock.blockHeight = outboundHeight;
        }
        outboundMessageBlock.messages = outboundMessages;
        outboundMessageBlock.totalBalance = outputState.totalWithdrawals;
        outboundMessageBlock.timestamp = 0; // timestamp is not relevant, but more importantly this needs to be deterministic
        outputState.outboundMessageBlock = outboundMessageBlock;

        return outputState;
    }

    function _calculateTotalWithdrawals(Balance memory totalWithdrawals, ExitChannel[] memory exitChannels)
        internal
        view
        returns (Balance memory)
    {
        for (uint256 i = 0; i < exitChannels.length; i++) {
            totalWithdrawals = stateMachineImplementation.addBalance(totalWithdrawals, exitChannels[i].balance);
        }
        return totalWithdrawals;
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
     * Exits and Joins happen over their respective blockchain data structures (Outbound MessageBlocks & inbound MessageBlocks) which are also not checked here.
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
        console.log("BALANCE 1");
        Balance memory onChainDeposits = _resolveTotalDeposits(channelId, snapshotData.latestInboundMessageBlockHash);
        Balance memory onChainWithdrawals = channelBalance.totalWithdrawals;
        if (snapshotData.stateMachineStateHash != keccak256(encodedStateMachineState)) return false;
        console.log("BALANCE 2");
        //on-chain deposits have to match latestState deposits since deposits only happen on-chain
        if (!stateMachineImplementation.areBalancesEqual(snapshotData.totalDeposits, onChainDeposits)) return false;
        console.log("BALANCE 3");
        //total withdrawals >= on-chain withdrawals since on-chain withdrawals are already processed
        if (stateMachineImplementation.isBalanceLesserThan(snapshotData.totalWithdrawals, onChainWithdrawals)) {
            return false;
        }
        console.log("BALANCE 4");
        stateMachineImplementation.setState(encodedStateMachineState);
        Balance memory stateMachineBalance = stateMachineImplementation.getTotalStateBalance(); // The state is already set
        // totalDeposits == totalWithdrawals + stateMachineBalance
        console.log("BALANCE 4.1 - snapshotData.totalDeposits:", snapshotData.totalDeposits.amount);
        console.log("BALANCE 4.2 - stateMachineBalance:", stateMachineBalance.amount);
        console.log("BALANCE 4.3 - snapshotData.totalWithdrawals:", snapshotData.totalWithdrawals.amount);
        if (
            !stateMachineImplementation.areBalancesEqual(
                snapshotData.totalDeposits,
                stateMachineImplementation.addBalance(snapshotData.totalWithdrawals, stateMachineBalance)
            )
        ) return false;
        console.log("BALANCE 5");
        return true;
    }

    function _killDispute(Dispute memory dispute) internal {
        DisputeData storage disputeData = disputeData[dispute.input.channelId];
        bytes32 forkId = _getDisputeFork(dispute);
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[forkId];

        // require that the dispute window exists and is not expired
        (bool isExpired, uint256 killPeriodEnd) = _isKillPeriodExpired(disputeWindow, _getEvidenceTime());
        require(!isExpired, RaceConditionDisputeKillPeriodExpired(killPeriodEnd, block.timestamp));
        bytes32 commitment = _disputeCommitmentHash(dispute);
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
        require(isFound, ErrorDisputeCommitmentNotFound(dispute.input.channelId, forkId, commitment));

        // add the disputer to on-chain slashes
        addOnChainSlashedParticipant(dispute.input.channelId, dispute.input.disputer);

        // remove the dispute commitment
        disputeWindow.evidence.disputeCommitments[foundIndex] =
            disputeWindow.evidence.disputeCommitments[disputeWindow.evidence.disputeCommitments.length - 1];
        disputeWindow.evidence.disputeCommitments.pop();

        emit DisputeKilled(dispute.input.channelId, forkId, dispute.input.disputer, commitment);
    }

    /// The dispute's self-removal: its disputer when `selfRemoval` is set.
    function _selfRemovals(DisputeInput memory disputeInput) internal pure returns (address[] memory removals) {
        removals = new address[](disputeInput.selfRemoval ? 1 : 0);
        if (disputeInput.selfRemoval) removals[0] = disputeInput.disputer;
    }

    function checkDisputeAuditingDataCommitment(Dispute memory dispute, DisputeAuditingData memory disputeAuditingData)
        public
        pure
        returns (bool)
    {
        return dispute.input.disputeAuditingDataHash == keccak256(abi.encode(disputeAuditingData));
    }

    function isDisputeOutputCorrect(
        Dispute memory dispute,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) public returns (bool) {
        // It's annoying that this function can not be view/pure since the way we modify encodedState is semantically 'stateful' even though logically it's stateless

        // Ensure the provided input context is actually linked to the dispute input
        if (!_isDataLinkedToDisputeInput(dispute, latestStateSnapshot, latestStateMachineState, inboundMessageBlocks)) {
            return false;
        }

        // ***************** Generate output snapshot ***************
        SnapshotData memory outputSnapshotData = computeDisputeOutputSnapshotData(
            dispute.input, latestStateSnapshot, latestStateMachineState, inboundMessageBlocks
        );

        //verify outputStateSnapshot commitment
        return (keccak256(abi.encode(outputSnapshotData)) == dispute.outputSnapshotDataHash);
    }

    /// Slashes the participants in the loaded state machine state.
    function _applySlashesToStateMachine(address[] memory slashedParticipants)
        internal
        returns (ExitChannel[] memory exitChannels)
    {
        ExitChannel[] memory _exitChannels = new ExitChannel[](slashedParticipants.length);
        uint256 slashCount = 0;
        for (uint256 i = 0; i < slashedParticipants.length; i++) {
            bool success;
            ExitChannel memory exitChannel;
            (success, exitChannel) = stateMachineImplementation.slashParticipant(slashedParticipants[i]);
            if (success) {
                _exitChannels[slashCount++] = exitChannel;
            }
        }

        exitChannels = _shrinkExitChannelArray(_exitChannels, slashCount);
    }

    /// Removes the participants from the loaded state machine state.
    function _removeParticipantsFromStateMachine(address[] memory participants)
        internal
        returns (ExitChannel[] memory)
    {
        ExitChannel[] memory _exitChannels = new ExitChannel[](participants.length);
        uint256 removalCount = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            bool success;
            ExitChannel memory exitChannel;
            (success, exitChannel) = stateMachineImplementation.removeParticipant(participants[i]);
            if (success) {
                _exitChannels[removalCount++] = exitChannel;
            }
        }

        return _shrinkExitChannelArray(_exitChannels, removalCount);
    }
}
