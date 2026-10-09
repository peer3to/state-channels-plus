pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";
import "../StateChannelManagerInterface.sol";
import "../types/MessageTypeHashes.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";
import "./UtilityFacetInterface.sol";

contract StateChannelCommon is StateChannelManagerStorage, StateChannelManagerEvents {
    /// The walk state before a milestone.
    struct WalkCursor {
        /// the walk starts from the same-fork non-genesis anchor `start`, else from the fork genesis `start`
        bool useOnChainSnapshot;
        StateSnapshot start;
        bool hasKeptMilestone;
        /// the first height of the last kept milestone
        uint256 previousFirstHeight;
    }

    /// The distinct `expected` participants among a run's signers.
    struct ThresholdTally {
        address[] expected;
        address[] set;
        uint256 count;
    }

    function _getOnChainSlashedParticipantsUpToTimestamp(bytes32 channelId, uint256 timestamp)
        internal
        view
        virtual
        returns (address[] memory)
    {
        address[] memory slashedParticipants = new address[](disputeData[channelId].onChainSlashes.length);
        uint256 actualCount = 0;
        for (
            uint256 i = 0;
            i < disputeData[channelId].onChainSlashes.length
                && disputeData[channelId].onChainSlashes[i].timestamp <= timestamp;
            i++
        ) {
            slashedParticipants[actualCount++] = disputeData[channelId].onChainSlashes[i].participant;
        }
        return _shrinkAddressArray(slashedParticipants, actualCount);
    }

    function _getOnChainSlashedParticipants(bytes32 channelId) internal view virtual returns (address[] memory) {
        address[] memory slashedParticipants = new address[](disputeData[channelId].onChainSlashes.length);
        for (uint256 i = 0; i < disputeData[channelId].onChainSlashes.length; i++) {
            slashedParticipants[i] = disputeData[channelId].onChainSlashes[i].participant;
        }
        return slashedParticipants;
    }

    function _isParticipantSlashedOnChain(bytes32 channelId, address participant) internal view virtual returns (bool) {
        address[] memory slashedParticipants = _getOnChainSlashedParticipants(channelId);
        for (uint256 i = 0; i < slashedParticipants.length; i++) {
            if (slashedParticipants[i] == participant) {
                return true;
            }
        }
        return false;
    }

    function addOnChainSlashedParticipant(bytes32 channelId, address slashedParticipant) internal virtual {
        if (_isParticipantSlashedOnChain(channelId, slashedParticipant)) {
            return; //already slashed
        }
        disputeData[channelId].onChainSlashes.push(OnChainSlash(slashedParticipant, block.timestamp));
        emit ChainSlashed(channelId, slashedParticipant, block.timestamp);
    }

    function _getOnChainThresholdSet(bytes32 channelId) internal view virtual returns (address[] memory) {
        return UtilityFacetInterface(utilityFacetAddress)
            .subtractAddressArrays(
                UtilityFacetInterface(utilityFacetAddress)
                    .concatAddressArraysNoDuplicates(
                        _getSnapshotParticipants(channelId), _getPendingParticipants(channelId)
                    ),
                _getOnChainSlashedParticipants(channelId)
            );
    }

    function _getGenesisTimestamp(bytes32 channelId, bytes32 originForkId, bytes32 forkId)
        internal
        view
        virtual
        returns (bool isAvailable, uint256 timestamp)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[originForkId];
        if (disputeWindow.evidence.creationTimestamp == 0) {
            StateSnapshot memory currentOnChainSnapshot = stateSnapshots[channelId];
            if (
                currentOnChainSnapshot.forkId == forkId
                    && StateChannelManagerInterface(address(this))
                        .isGenesisSnapshotWithoutTimeCheck(currentOnChainSnapshot)
            ) {
                return (true, currentOnChainSnapshot.timestamp);
            }
            return (false, 0);
        }
        (bool isExpired, uint256 killPeriodEnd) = _isKillPeriodExpired(disputeWindow, _getEvidenceTime());
        uint256 genesisTimestap = killPeriodEnd;
        if (!isExpired) {
            return (false, genesisTimestap);
        }
        if (killPeriodEnd == 0) {
            // Dispute window doesn't exist
            StateSnapshot memory currentOnChainSnapshot = stateSnapshots[channelId];
            // check if current on-chain snapshot.fork == forkId
            if (
                currentOnChainSnapshot.forkId == forkId
                    && UtilityFacetInterface(utilityFacetAddress)
                        .isGenesisSnapshotWithoutTimeCheck(currentOnChainSnapshot)
            ) {
                return (true, currentOnChainSnapshot.timestamp);
            }
            return (false, 0);
        }
        return (true, genesisTimestap);
    }

    function _getSnapshotParticipants(bytes32 channelId) internal view virtual returns (address[] memory) {
        return stateSnapshots[channelId].snapshotData.participants;
    }

    /// Joiners whose JOIN the current snapshot has not consumed yet: the walk
    /// from the channel's inbound head stops at the snapshot's own inbound
    /// hash. An unbounded walk counted every JOIN ever recorded, including
    /// the original participants' open joins, so a leaver stayed "pending"
    /// forever and a slashed joiner stayed eligible.
    function _getPendingParticipants(bytes32 channelId) internal view virtual returns (address[] memory) {
        address[] memory pendingParticipants = _derivePendingParticipantsFromInboundHash(
            channelId,
            channelBalances[channelId].latestInboundMessageBlockHash,
            stateSnapshots[channelId].snapshotData.latestInboundMessageBlockHash
        );
        return pendingParticipants;
    }

    function _derivePendingParticipantsFromInboundHash(
        bytes32 channelId,
        bytes32 upperInboundHash,
        bytes32 lowerInboundHash
    ) internal view returns (address[] memory pendingParticipants) {
        pendingParticipants = new address[](0);
        bytes32 inboundHash = upperInboundHash;

        while (inboundHash != bytes32(0) && inboundHash != lowerInboundHash) {
            MessageBlock storage inboundBlock = inboundMessageBlockMap[channelId][inboundHash];
            if (inboundBlock.timestamp == 0 && inboundBlock.messages.length == 0) {
                inboundHash = inboundBlock.previousBlockHash;
                continue;
            }

            for (uint256 i = 0; i < inboundBlock.messages.length; i++) {
                if (inboundBlock.messages[i].messageType == MESSAGE_TYPE_JOIN) {
                    JoinChannel memory joinChannel = abi.decode(inboundBlock.messages[i].data, (JoinChannel));
                    pendingParticipants = UtilityFacetInterface(utilityFacetAddress)
                        .insertIntoAddressArrayNoDuplicates(pendingParticipants, joinChannel.participant);
                }
            }

            inboundHash = inboundBlock.previousBlockHash;
        }

        return pendingParticipants;
    }

    function _deriveEligibleParticipantsFromInboundHashAndSnapshotParticipants(
        bytes32 channelId,
        bytes32 latestInboundMessageBlockHash,
        address[] memory snapshotParticipants,
        bytes32 lowerInboundHash
    ) internal view returns (address[] memory eligibleParticipants) {
        address[] memory pendingParticipants = _derivePendingParticipantsFromInboundHash(
            channelId, latestInboundMessageBlockHash, lowerInboundHash
        );

        address[] memory participants = UtilityFacetInterface(utilityFacetAddress)
            .concatAddressArraysNoDuplicates(snapshotParticipants, pendingParticipants);
        eligibleParticipants = UtilityFacetInterface(utilityFacetAddress)
            .subtractAddressArrays(participants, _getOnChainSlashedParticipants(channelId));
        return eligibleParticipants;
    }

    function _getStateSnapshot(bytes32 channelId) internal view virtual returns (StateSnapshot memory) {
        return stateSnapshots[channelId];
    }

    function _appendOpenChannel(bytes32 channelId) internal {
        if (openChannelIndexPlusOne[channelId] != 0) return;
        openChannelIds.push(channelId);
        openChannelIndexPlusOne[channelId] = openChannelIds.length;
    }

    function _removeOpenChannel(bytes32 channelId) internal {
        uint256 indexPlusOne = openChannelIndexPlusOne[channelId];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = openChannelIds.length - 1;
        if (index != lastIndex) {
            bytes32 lastChannelId = openChannelIds[lastIndex];
            openChannelIds[index] = lastChannelId;
            openChannelIndexPlusOne[lastChannelId] = index + 1;
        }

        openChannelIds.pop();
        delete openChannelIndexPlusOne[channelId];
    }

    function _getChannelBalance(bytes32 channelId) internal view virtual returns (ChannelBalance memory) {
        return channelBalances[channelId];
    }

    function _isChannelOpen(bytes32 channelId) internal view virtual returns (bool, StateSnapshot memory) {
        StateSnapshot memory snapshot = stateSnapshots[channelId];
        bool isOpen = snapshot.snapshotData.participants.length > 0;
        return (isOpen, snapshot);
    }

    function _isForkDisputed(bytes32 channelId, bytes32 forkId) internal view virtual returns (bool) {
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[forkId];
        return disputeWindow.evidence.creationTimestamp != 0;
    }

    function _getStateMachineParticipants(bytes memory encodedState) internal virtual returns (address[] memory) {
        // setState fails
        stateMachineImplementation.setState(encodedState);
        return stateMachineImplementation.getParticipants();
    }

    function _getP2pTime() internal view virtual returns (uint256) {
        return p2pTime;
    }

    function _getAgreementTime() internal view virtual returns (uint256) {
        return agreementTime;
    }

    function _getChainFallbackTime() internal view virtual returns (uint256) {
        return chainFallbackTime;
    }

    function _getEvidenceTime() internal view virtual returns (uint256) {
        return evidenceTime;
    }

    function _getMaxChannelParticipants() internal view virtual returns (uint256) {
        return maxChannelParticipants;
    }

    function _getGasLimit() internal view virtual returns (uint256) {
        return gasLimit;
    }

    function _getAllTimes() internal view virtual returns (uint256, uint256, uint256, uint256) {
        return (p2pTime, agreementTime, chainFallbackTime, evidenceTime);
    }

    function _persistInboundMessageBlock(bytes32 channelId, bytes32 blockHash, MessageBlock memory messageBlock)
        internal
    {
        MessageBlock storage storedBlock = inboundMessageBlockMap[channelId][blockHash];
        if (storedBlock.timestamp != 0 || storedBlock.messages.length != 0) {
            revert ErrorInboundMessageBlockAlreadyPersisted(channelId, blockHash);
        }
        storedBlock.previousBlockHash = messageBlock.previousBlockHash;
        storedBlock.blockHeight = messageBlock.blockHeight;
        storedBlock.totalBalance = messageBlock.totalBalance;
        storedBlock.timestamp = messageBlock.timestamp;

        for (uint256 i = 0; i < messageBlock.messages.length; i++) {
            storedBlock.messages.push(messageBlock.messages[i]);
        }
    }

    function _appendInboundMessages(bytes32 channelId, Message[] memory messages)
        internal
        returns (MessageBlock memory messageBlock, Balance memory newTotalDeposits)
    {
        if (messages.length == 0) revert ErrorNoInboundMessagesProvided();

        ChannelBalance storage channelBalance = channelBalances[channelId];
        messageBlock.previousBlockHash = channelBalance.latestInboundMessageBlockHash;
        uint256 nextBlockHeight = channelBalance.latestInboundMessageBlockHeight + 1;
        messageBlock.blockHeight = nextBlockHeight;
        messageBlock.messages = messages;

        newTotalDeposits = channelBalance.totalDeposits;
        for (uint256 i = 0; i < messages.length; i++) {
            newTotalDeposits = stateMachineImplementation.addBalance(newTotalDeposits, messages[i].balance);
        }

        messageBlock.totalBalance = newTotalDeposits;
        messageBlock.timestamp = block.timestamp;

        bytes32 blockHash = keccak256(abi.encode(messageBlock));

        _persistInboundMessageBlock(channelId, blockHash, messageBlock);
        channelBalance.latestInboundMessageBlockHash = blockHash;
        channelBalance.latestInboundMessageBlockHeight = nextBlockHeight;
        channelBalance.totalDeposits = newTotalDeposits;
        emit InboundMessagesProcessed(channelId, messageBlock);
    }

    function _resolveTotalDeposits(bytes32 channelId, bytes32 blockHash) internal view returns (Balance memory) {
        Balance memory zeroBalance = stateMachineImplementation.getZeroBalance();
        if (blockHash == bytes32(0)) {
            return zeroBalance;
        }
        MessageBlock storage inboundBlock = inboundMessageBlockMap[channelId][blockHash];
        if (inboundBlock.timestamp == 0 && inboundBlock.messages.length == 0) {
            StateSnapshot storage snapshot = stateSnapshots[channelId];
            if (snapshot.snapshotData.latestInboundMessageBlockHash == blockHash) {
                return snapshot.snapshotData.totalDeposits;
            }
            return zeroBalance;
        }
        return inboundBlock.totalBalance;
    }

    function _hasInboundMessageBlock(bytes32 channelId, bytes32 messageBlockHash) internal view virtual returns (bool) {
        MessageBlock storage storedBlock = inboundMessageBlockMap[channelId][messageBlockHash];
        return storedBlock.timestamp != 0 || storedBlock.messages.length != 0;
    }

    function _getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        internal
        view
        virtual
        returns (bool found, bytes32 blockCalldataCommitment)
    {
        // fetch the blockCallDataCommitment from storage
        bytes32 commitment = blockCalldataCommitments[channelId][participant][forkId][blockHeight];
        if (commitment == bytes32(0)) {
            return (false, bytes32(0));
        }
        return (true, commitment);
    }

    function _isBlockAuthentic(SignedBlock memory _block) internal view virtual returns (bool) {
        (bool decoded, Block memory decodedBlock) =
            UtilityFacetInterface(utilityFacetAddress).tryDecodeBlock(_block.encodedBlock);
        if (!decoded) return false;
        (address signer, bool isValid) =
            UtilityFacetInterface(utilityFacetAddress).retrieveSignerAddress(_block.encodedBlock, _block.signature);
        if (signer != decodedBlock.transaction.header.participant || !isValid) {
            return false;
        }
        return true;
    }

    function _pruneOutboundMessageBlocks(MessageBlock[] memory outboundMessageBlocks, bytes32 lowerHash)
        internal
        pure
        returns (MessageBlock[] memory)
    {
        if (lowerHash == bytes32(0)) {
            return outboundMessageBlocks;
        }

        uint256 n = outboundMessageBlocks.length;
        uint256 startIndex = n;
        for (uint256 i = 0; i < n; i++) {
            if (outboundMessageBlocks[i].previousBlockHash == lowerHash) {
                startIndex = i;
                break;
            }
        }

        if (startIndex == 0) return outboundMessageBlocks;
        if (startIndex == n) return new MessageBlock[](0);

        MessageBlock[] memory pruned = new MessageBlock[](n - startIndex);
        for (uint256 j = 0; j < pruned.length; j++) {
            pruned[j] = outboundMessageBlocks[startIndex + j];
        }
        return pruned;
    }

    function _verifyOutboundMessageBlocks(
        MessageBlock[] memory outboundMessageBlocks,
        SnapshotData memory lowerSnapshot,
        SnapshotData memory upperSnapshot
    ) internal view virtual returns (bool) {
        bytes32 previousBlockHash = lowerSnapshot.latestOutboundMessageBlockHash;
        Balance memory totalOutbound = lowerSnapshot.totalWithdrawals;
        uint256 expectedHeight = lowerSnapshot.latestOutboundMessageBlockHeight;

        for (uint256 i = 0; i < outboundMessageBlocks.length; i++) {
            if (previousBlockHash != outboundMessageBlocks[i].previousBlockHash) {
                return false;
            }
            expectedHeight += 1;
            if (outboundMessageBlocks[i].blockHeight != expectedHeight) {
                return false;
            }
            for (uint256 j = 0; j < outboundMessageBlocks[i].messages.length; j++) {
                totalOutbound =
                    stateMachineImplementation.addBalance(totalOutbound, outboundMessageBlocks[i].messages[j].balance);
            }
            previousBlockHash = keccak256(abi.encode(outboundMessageBlocks[i]));
        }
        if (keccak256(abi.encode(totalOutbound)) != keccak256(abi.encode(upperSnapshot.totalWithdrawals))) {
            return false;
        }
        if (expectedHeight != upperSnapshot.latestOutboundMessageBlockHeight) {
            return false;
        }

        return previousBlockHash == upperSnapshot.latestOutboundMessageBlockHash;
    }

    function _isSnapshotLinkedToBlock(Block memory blockData, StateSnapshot memory stateSnapshot)
        internal
        pure
        returns (bool)
    {
        return blockData.stateSnapshotHash == keccak256(abi.encode(stateSnapshot));
    }

    function _isGenesisSnapshotDataLinkedToFork(bytes32 forkId, SnapshotData memory genesisStateSnapshotData)
        internal
        pure
        returns (bool)
    {
        return forkId == keccak256(abi.encode(genesisStateSnapshotData));
    }

    function _isLatestStateLinkedToLatestBlock(
        Dispute memory dispute,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState
    ) internal pure returns (bool) {
        bytes32 snapshotHash = keccak256(abi.encode(latestStateSnapshot));
        if (snapshotHash != dispute.input.latestStateSnapshotHash) return false;

        if (latestStateSnapshot.snapshotData.stateMachineStateHash != keccak256(latestStateMachineState)) {
            return false;
        }

        return _isSnapshotLinkedToLatestBlock(dispute, latestStateSnapshot);
    }

    /// The on-chain anchor of `forkId`: the on-chain snapshot, and whether a state proof can start from it.
    function _getAnchorSnapshot(bytes32 channelId, bytes32 forkId)
        internal
        view
        returns (bool canUseOnChainSnapshot, StateSnapshot memory onChainSnapshot)
    {
        onChainSnapshot = stateSnapshots[channelId];
        canUseOnChainSnapshot = _canStartFromOnChainSnapshot(onChainSnapshot, forkId);
    }

    /// `snapshot` is on `forkId` and a block commits to it. The genesis (its data hashes to the fork ID, at height 0)
    /// is excluded: no block commits to it, block 0 only links back to it through `previousBlockHash`. Block zero's
    /// resulting snapshot also has height 0, but its data does not hash to the fork ID.
    function _canStartFromOnChainSnapshot(StateSnapshot memory snapshot, bytes32 forkId) internal pure returns (bool) {
        return snapshot.forkId == forkId
            && (snapshot.blockHeight != 0 || keccak256(abi.encode(snapshot.snapshotData)) != forkId);
    }

    function _isDataLinkedToDisputeInput(
        Dispute memory dispute,
        StateSnapshot memory latestStateSnapshot,
        bytes memory latestStateMachineState,
        MessageBlock[] memory inboundMessageBlocks
    ) internal pure returns (bool) {
        if (!_isLatestStateLinkedToLatestBlock(dispute, latestStateSnapshot, latestStateMachineState)) {
            return false;
        }

        (bool isValid,,,) = _verifyInboundMessageBlocks(
            latestStateSnapshot.snapshotData.latestInboundMessageBlockHash,
            dispute.input.latestInboundMessageBlockHash,
            inboundMessageBlocks
        );
        return isValid;
    }

    /// Walks the inbound chain and reports where and why it stopped, so a
    /// caller that reverts can say what was compared instead of only that it
    /// failed. `runningInboundMessageBlockHash` is the head the walk had
    /// reached; `breakIndex` is the block that failed, or
    /// `inboundMessageBlocks.length` for a final-target mismatch;
    /// `failureReason` is one of the INBOUND_FAILURE_* constants and is only
    /// meaningful when `isValid` is false.
    function _verifyInboundMessageBlocks(
        bytes32 previousInboundMessageBlockHash,
        bytes32 latestInboundMessageBlockHash,
        MessageBlock[] memory inboundMessageBlocks
    )
        internal
        pure
        returns (bool isValid, bytes32 runningInboundMessageBlockHash, uint256 breakIndex, uint8 failureReason)
    {
        uint256 lastHeight;
        bool hasLastHeight;
        for (uint256 i = 0; i < inboundMessageBlocks.length; i++) {
            if (previousInboundMessageBlockHash != inboundMessageBlocks[i].previousBlockHash) {
                return (false, previousInboundMessageBlockHash, i, INBOUND_FAILURE_HASH_LINK);
            }
            if (hasLastHeight && inboundMessageBlocks[i].blockHeight != lastHeight + 1) {
                return (false, previousInboundMessageBlockHash, i, INBOUND_FAILURE_HEIGHT_SEQUENCE);
            }
            previousInboundMessageBlockHash = keccak256(abi.encode(inboundMessageBlocks[i]));
            lastHeight = inboundMessageBlocks[i].blockHeight;
            hasLastHeight = true;
        }
        return (
            previousInboundMessageBlockHash == latestInboundMessageBlockHash,
            previousInboundMessageBlockHash,
            inboundMessageBlocks.length,
            INBOUND_FAILURE_FINAL_TARGET
        );
    }

    function _applyInboundMessages(
        bytes memory encodedStateMachineState,
        MessageBlock[] memory inboundMessageBlocks,
        Balance memory currentInboundTotalDeposits
    ) internal returns (bytes memory encodedModifiedState, Balance memory newTotalDeposits) {
        newTotalDeposits = currentInboundTotalDeposits;
        stateMachineImplementation.setState(encodedStateMachineState);
        for (uint256 i = 0; i < inboundMessageBlocks.length; i++) {
            for (uint256 j = 0; j < inboundMessageBlocks[i].messages.length; j++) {
                bool success = stateMachineImplementation.processInboundMessage(inboundMessageBlocks[i].messages[j]);
                // `if (!success) revert` so the seed-state hash is only hashed
                // on the failure path - `require` would compute it every message.
                if (!success) {
                    revert ErrorDisputeStateMachineInboundProcessingFailed(
                        i,
                        j,
                        inboundMessageBlocks[i].messages[j].participant,
                        inboundMessageBlocks[i].messages[j].messageType,
                        keccak256(encodedStateMachineState)
                    );
                }
                newTotalDeposits = stateMachineImplementation.addBalance(
                    newTotalDeposits, inboundMessageBlocks[i].messages[j].balance
                );
            }
        }
        encodedModifiedState = stateMachineImplementation.getState();
    }

    function _processOutboundMessage(Message memory message) internal virtual returns (bool) {
        if (message.messageType == MESSAGE_TYPE_EXIT) {
            ExitChannel memory exitChannel = abi.decode(message.data, (ExitChannel));
            require(
                stateMachineImplementation.areBalancesEqual(message.balance, exitChannel.balance),
                ErrorOutboundMessageBalanceMismatch(
                    message.participant, exitChannel.balance.amount, message.balance.amount
                )
            );
            bool success = StateChannelManagerInterface(address(this)).withdrawAssetsComposable(exitChannel);
            return success;
        }
        return _processCustomOutboundMessage(message);
    }

    function _processCustomOutboundMessage(Message memory message) internal virtual returns (bool) {
        revert ErrorOutboundMessageTypeUnsupported(message.messageType);
    }

    function isDisputeCommitted(Dispute memory dispute) internal view returns (bool) {
        bytes32 channelId = dispute.input.channelId;
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[_getDisputeFork(dispute)];
        bytes32 commitment = _disputeCommitmentHash(dispute);

        for (uint256 i = 0; i < disputeWindow.evidence.disputeCommitments.length; i++) {
            if (disputeWindow.evidence.disputeCommitments[i] == commitment) {
                return true;
            }
        }
        return false;
    }

    function _canParticipateInDisputesNow(bytes32 channelId, address participant) internal view virtual returns (bool) {
        address[] memory eligibleParticipants = _deriveEligibleParticipantsFromInboundHashAndSnapshotParticipants(
            channelId,
            channelBalances[channelId].latestInboundMessageBlockHash,
            _getSnapshotParticipants(channelId),
            stateSnapshots[channelId].snapshotData.latestInboundMessageBlockHash
        );
        return UtilityFacetInterface(utilityFacetAddress).isAddressInArray(eligibleParticipants, participant);
    }

    function _isDisputeInboundHashValid(Dispute memory dispute) internal view returns (bool) {
        bytes32 disputeInboundHash = dispute.input.latestInboundMessageBlockHash;
        uint256 disputeInboundHeight = dispute.input.lastInboundMessageBlockHeight;

        if (disputeInboundHash == bytes32(0)) {
            return disputeInboundHeight == 0;
        }

        bytes32 channelId = dispute.input.channelId;
        ChannelBalance memory channelBalance = channelBalances[channelId];
        bytes32 walkHash = channelBalance.latestInboundMessageBlockHash;

        // Follow inbound blocks from latest toward genesis until we find the dispute's hash.
        while (walkHash != bytes32(0)) {
            if (walkHash == disputeInboundHash) {
                uint256 onChainHeight;
                if (walkHash == channelBalance.latestInboundMessageBlockHash) {
                    onChainHeight = channelBalance.latestInboundMessageBlockHeight;
                } else {
                    onChainHeight = inboundMessageBlockMap[channelId][walkHash].blockHeight;
                }
                return disputeInboundHeight == onChainHeight;
            }
            walkHash = inboundMessageBlockMap[channelId][walkHash].previousBlockHash;
        }

        return false;
    }

    function _commitToDisputeReducedResult(
        bytes32 channelId,
        DisputeWindow storage disputeWindow,
        bytes32 reducedForkId,
        uint256 reductionTimestamp
    ) internal {
        // A window that was never created has a zero kill-period deadline; report the
        // missing window rather than a deadline that reads as long past.
        // `if (!...) revert` because `disputeWindow.forkId` is a storage read the
        // condition itself does not perform (P4).
        if (!_isDisputeWidnowCreated(disputeWindow)) {
            revert RaceConditionDisputeWindowNotOpen(channelId, disputeWindow.forkId);
        }
        (bool isExpired, uint256 killPeriodEnd) = _isKillPeriodExpired(disputeWindow, _getEvidenceTime());
        require(isExpired, RaceConditionDisputeKillPeriodNotExpired(killPeriodEnd, block.timestamp));
        require(
            disputeWindow.reducedResult.forkId == bytes32(0),
            RaceConditionDisputeAlreadyReduced(disputeWindow.forkId, disputeWindow.reducedResult.forkId, reducedForkId)
        );
        disputeWindow.reducedResult.forkId = reducedForkId;
        disputeWindow.reducedResult.timestamp = reductionTimestamp;
        disputeWindow.reducedResult.reducer = msg.sender; //calling function should check that msg.sender is part of channel 'can participate'

        emit DisputeReducedResultCommitted(
            channelId, disputeWindow.forkId, reducedForkId, reductionTimestamp, msg.sender
        );
    }

    /**
     * The one state-proof walk from `start`: the same-fork non-genesis anchor, else the fork genesis. Milestones
     * wholly below the anchor are dropped. The run holding the anchor commits it at the anchor height and needs no
     * threshold. Every other kept milestone proves its first block by the union threshold of the last final point
     * and its resulting snapshot; only a genesis block 0 of a single-milestone proof may stay unfinalized (then the
     * whole run is the unfinalized tail). Every kept block decodes, stays on the channel and fork, links by hash and
     * height + 1 and carries its author's signature. Supplied evidence that does not fit the proof (a snapshot count
     * other than one per milestone, or a snapshot its block does not commit to) is reported as `snapshotMismatch`.
     * Each milestone is one step (`_walkMilestone`); a failed walk names the failing step.
     */
    function _walkStateProof(ProofWalkInput memory input, StateSnapshot memory start)
        internal
        view
        returns (ProofWalkResult memory result)
    {
        MilestoneProof[] memory milestones = input.stateProof.milestones;
        if (milestones.length != input.milestoneSnapshots.length) {
            result.snapshotMismatch = true;
            return result;
        }
        WalkCursor memory cursor;
        if (!_openWalk(input, start, cursor)) return result;
        result.usedNonGenesisStart = cursor.useOnChainSnapshot;
        result.startSnapshot = cursor.start;
        result.finalizedSnapshot = cursor.start;
        for (uint256 i = 0; i < milestones.length; i++) {
            result.failedMilestoneIndex = i;
            if (!_walkMilestone(input, i, input.milestoneSnapshots[i], cursor, result)) return result;
        }
        result.failedMilestoneIndex = 0;
        result.valid = true;
    }

    /**
     * One step of the walk alone: milestone `milestoneIndex` from the state the walk reaches before it, with the
     * walk's rules. The step starts from the anchor or the genesis when no earlier milestone is kept, the anchor
     * after the run holding it, else `previousSnapshot`, which must be the one milestone i-1's first block commits to
     * (else this is not the failing step). `resultingSnapshot` is milestone i's, read when it proves a threshold hop.
     * With `hasBlockIndex` only block `blockIndex` and its predecessor are judged by the per-block rules (decoding,
     * fork and channel, link, signatures). A step can fail only when the full walk fails.
     */
    function _isStateProofStepFault(
        ProofWalkInput memory input,
        StateSnapshot memory start,
        uint256 milestoneIndex,
        bool hasBlockIndex,
        uint256 blockIndex,
        StateSnapshot memory previousSnapshot,
        StateSnapshot memory resultingSnapshot
    ) internal view returns (bool isFault, bool snapshotMismatch) {
        if (milestoneIndex >= input.stateProof.milestones.length) {
            return (false, false);
        }
        WalkCursor memory cursor;
        ProofWalkResult memory result;
        // the walk's start belongs to its first step
        if (!_openWalk(input, start, cursor)) return (milestoneIndex == 0, false);
        result.finalizedSnapshot = cursor.start;
        if (milestoneIndex != 0 && !_resumeWalk(input, milestoneIndex, previousSnapshot, cursor, result)) {
            return (false, false);
        }
        if (hasBlockIndex) return (_isPointedBlockFault(input, milestoneIndex, blockIndex, cursor), false);
        bool isStepValid = _walkMilestone(input, milestoneIndex, resultingSnapshot, cursor, result);
        return (!isStepValid && !result.snapshotMismatch, result.snapshotMismatch);
    }

    /// The walk's start: the same-fork non-genesis anchor `start`, else the fork genesis. An empty proof is the fork
    /// genesis.
    function _openWalk(ProofWalkInput memory input, StateSnapshot memory start, WalkCursor memory cursor)
        internal
        view
        returns (bool)
    {
        uint256 milestoneCount = input.stateProof.milestones.length;
        cursor.useOnChainSnapshot = milestoneCount != 0 && _canStartFromOnChainSnapshot(start, input.forkId);
        cursor.start = start;
        if (cursor.useOnChainSnapshot) return true;
        (bool isGenesisLinked, bool hasGenesisTimestamp, StateSnapshot memory genesis) =
            _getGenesisSnapshot(input, start);
        if (!isGenesisLinked) return false;
        // block zero links to the dated genesis; only an empty proof does not need the date
        if (!hasGenesisTimestamp && milestoneCount != 0) return false;
        cursor.start = genesis;
        return true;
    }

    /// The walk state before milestone `milestoneIndex`, from milestone i-1 alone. False when milestone i-1 cannot
    /// lead to it: its step fails there, or `previousSnapshot` is not the one its first block commits to.
    function _resumeWalk(
        ProofWalkInput memory input,
        uint256 milestoneIndex,
        StateSnapshot memory previousSnapshot,
        WalkCursor memory cursor,
        ProofWalkResult memory result
    ) internal view returns (bool) {
        MilestoneProof memory previous = input.stateProof.milestones[milestoneIndex - 1];
        if (previous.blockConfirmations.length == 0) return false;
        // only a prefix lies below the anchor: a skipped predecessor keeps the walk at its start
        if (cursor.useOnChainSnapshot && _isMilestoneBelow(previous, cursor.start.blockHeight)) return true;
        cursor.hasKeptMilestone = true;
        (bool decoded, Block memory previousFirstBlock) = UtilityFacetInterface(utilityFacetAddress)
            .tryDecodeBlock(previous.blockConfirmations[0].signedBlock.encodedBlock);
        if (!decoded) return false;
        cursor.previousFirstHeight = previousFirstBlock.transaction.header.transactionCnt;
        // the run holding the anchor keeps the walk at the anchor
        if (cursor.useOnChainSnapshot && cursor.previousFirstHeight <= cursor.start.blockHeight) return true;
        if (keccak256(abi.encode(previousSnapshot)) != previousFirstBlock.stateSnapshotHash) return false;
        result.finalizedSnapshot = previousSnapshot;
        return true;
    }

    /// One step of the walk: milestone `milestoneIndex` from `cursor`, with `resultingSnapshot` as its hop evidence.
    function _walkMilestone(
        ProofWalkInput memory input,
        uint256 milestoneIndex,
        StateSnapshot memory resultingSnapshot,
        WalkCursor memory cursor,
        ProofWalkResult memory result
    ) internal view returns (bool) {
        MilestoneProof memory milestone = input.stateProof.milestones[milestoneIndex];
        uint256 length = milestone.blockConfirmations.length;
        if (length == 0) return false;
        result.replayBlockIndex = length;
        // wholly below the anchor: history before the anchor is not checked, malformed or not. Only a prefix
        // of the proof can lie below it: the last milestone is the proof's latest state.
        if (cursor.useOnChainSnapshot && _isMilestoneBelow(milestone, cursor.start.blockHeight)) {
            return !cursor.hasKeptMilestone;
        }
        cursor.hasKeptMilestone = true;
        // only its height is read here: a block before the anchor block is history below the anchor
        (bool firstDecoded, Block memory firstBlock) = UtilityFacetInterface(utilityFacetAddress)
            .tryDecodeBlock(milestone.blockConfirmations[0].signedBlock.encodedBlock);
        if (!firstDecoded) return _blockFault(result, 0);

        uint256 firstHeight = firstBlock.transaction.header.transactionCnt;
        if (firstHeight < cursor.previousFirstHeight) return false;
        cursor.previousFirstHeight = firstHeight;

        if (cursor.useOnChainSnapshot && firstHeight <= cursor.start.blockHeight) {
            return _walkAnchorRun(input, milestone, firstHeight, cursor.start, result);
        }
        // a threshold hop is checked from its first block: it must be on the channel and fork
        (bool isOnFork,) = _tryDecodeRequiredBlock(input, milestone, 0);
        if (!isOnFork) return _blockFault(result, 0);
        // block zero links back to the genesis through previousBlockHash; that alone does not finalize it
        bool isGenesisZero = !cursor.useOnChainSnapshot && firstHeight == 0;
        if (isGenesisZero && firstBlock.previousBlockHash != keccak256(abi.encode(cursor.start))) return false;
        // the supplied snapshot is judged first: forged evidence never reads as an invalid proof
        if (keccak256(abi.encode(resultingSnapshot)) != firstBlock.stateSnapshotHash) {
            result.snapshotMismatch = true;
            return false;
        }
        (bool isLinked, bool isThresholdReached) = _walkThresholdHop(input, milestone, resultingSnapshot, result);
        if (!isLinked) return false;
        return _settleThresholdHop(
            resultingSnapshot, isThresholdReached, isGenesisZero && input.stateProof.milestones.length == 1, result
        );
    }

    /// Block `blockIndex` of milestone `milestoneIndex` breaks a per-block rule of the walk from `cursor`. A block
    /// the walk does not check (a skipped milestone, history before the anchor block) is no fault.
    function _isPointedBlockFault(
        ProofWalkInput memory input,
        uint256 milestoneIndex,
        uint256 blockIndex,
        WalkCursor memory cursor
    ) internal view returns (bool) {
        MilestoneProof memory milestone = input.stateProof.milestones[milestoneIndex];
        if (blockIndex >= milestone.blockConfirmations.length) return false;
        (bool isKept, bool hasHeight, uint256 fromIndex) = _checkedRunStart(milestone, cursor);
        if (!isKept) return false;
        // the walk reads the first block's height before any other block
        if (!hasHeight) return blockIndex == 0;
        if (blockIndex < fromIndex) return false;
        BlockConfirmation memory confirmation = milestone.blockConfirmations[blockIndex];
        (bool decoded, Block memory current) =
            UtilityFacetInterface(utilityFacetAddress).tryDecodeBlock(confirmation.signedBlock.encodedBlock);
        Block memory previousBlock;
        bytes memory previousEncodedBlock;
        if (blockIndex != fromIndex) {
            previousEncodedBlock = milestone.blockConfirmations[blockIndex - 1].signedBlock.encodedBlock;
            bool previousDecoded;
            (previousDecoded, previousBlock) =
                UtilityFacetInterface(utilityFacetAddress).tryDecodeBlock(previousEncodedBlock);
            // an undecodable predecessor is its own step's fault
            if (!previousDecoded) return false;
        }
        ThresholdTally memory noTally;
        return !_walkBlock(
            input.channelId,
            input.forkId,
            confirmation,
            decoded,
            current,
            blockIndex != fromIndex,
            previousEncodedBlock,
            previousBlock,
            noTally
        );
    }

    /// Where the walk from `cursor` checks `milestone`'s blocks: none when it lies wholly below the anchor
    /// (`isKept` false); from the anchor block in the run holding the anchor, else from its first block. Without
    /// `hasHeight` the first block does not decode, so only it is judged.
    function _checkedRunStart(MilestoneProof memory milestone, WalkCursor memory cursor)
        internal
        view
        returns (bool isKept, bool hasHeight, uint256 fromIndex)
    {
        if (cursor.useOnChainSnapshot && _isMilestoneBelow(milestone, cursor.start.blockHeight)) {
            return (false, false, 0);
        }
        (bool firstDecoded, Block memory firstBlock) = UtilityFacetInterface(utilityFacetAddress)
            .tryDecodeBlock(milestone.blockConfirmations[0].signedBlock.encodedBlock);
        if (!firstDecoded) return (true, false, 0);
        uint256 firstHeight = firstBlock.transaction.header.transactionCnt;
        if (cursor.useOnChainSnapshot && firstHeight <= cursor.start.blockHeight) {
            fromIndex = cursor.start.blockHeight - firstHeight;
        }
        return (true, true, fromIndex);
    }

    function _blockFault(ProofWalkResult memory result, uint256 blockIndex) internal pure returns (bool) {
        result.isBlockFault = true;
        result.failedBlockIndex = blockIndex;
        return false;
    }

    /// The run holding the anchor: its block at the anchor height, `anchor.blockHeight - firstHeight` positions into
    /// the run (the same offset block-specific eligibility uses), commits the anchor, and the blocks from there link.
    /// Blocks before it are history below the anchor and are not checked.
    function _walkAnchorRun(
        ProofWalkInput memory input,
        MilestoneProof memory milestone,
        uint256 firstHeight,
        StateSnapshot memory anchor,
        ProofWalkResult memory result
    ) internal view returns (bool) {
        uint256 offset = anchor.blockHeight - firstHeight;
        if (offset >= milestone.blockConfirmations.length) return false;
        (bool decoded, Block memory anchorBlock) = _tryDecodeRequiredBlock(input, milestone, offset);
        if (!decoded) return _blockFault(result, offset);
        if (
            anchorBlock.transaction.header.transactionCnt != anchor.blockHeight
                || anchorBlock.stateSnapshotHash != keccak256(abi.encode(anchor))
        ) return false;
        (bool isLinked,,, uint256 failedIndex) =
            _walkMilestoneBlocks(input.channelId, input.forkId, milestone, offset, new address[](0));
        if (!isLinked) return _blockFault(result, failedIndex);
        result.replayBlockIndex = offset + 1;
        return true;
    }

    /// A milestone proving its first block by the union threshold of the last final point and `resultingSnapshot`,
    /// which matches its first block. False `isLinked` when the hop cannot be proven.
    function _walkThresholdHop(
        ProofWalkInput memory input,
        MilestoneProof memory milestone,
        StateSnapshot memory resultingSnapshot,
        ProofWalkResult memory result
    ) internal view returns (bool isLinked, bool isThresholdReached) {
        // a hop's consumed joiners are read from stored inbound blocks: a run this storage does not hold (a lagging
        // mirror) cannot prove the hop, so the caller's next tier decides
        if (!_isInboundRunStored(
                input.channelId,
                resultingSnapshot.snapshotData.latestInboundMessageBlockHash,
                result.finalizedSnapshot.snapshotData.latestInboundMessageBlockHash
            )) return (false, false);
        address[] memory expectedParticipants = _deriveMilestoneUnionParticipants(
            input.channelId, result.finalizedSnapshot.snapshotData, resultingSnapshot.snapshotData
        );
        uint256 thresholdCount;
        uint256 failedIndex;
        (isLinked, thresholdCount,, failedIndex) =
            _walkMilestoneBlocks(input.channelId, input.forkId, milestone, 0, expectedParticipants);
        if (!isLinked) return (_blockFault(result, failedIndex), false);
        return (true, thresholdCount == expectedParticipants.length);
    }

    function _settleThresholdHop(
        StateSnapshot memory resultingSnapshot,
        bool isThresholdReached,
        bool allowUnfinalized,
        ProofWalkResult memory result
    ) internal pure returns (bool) {
        if (isThresholdReached) {
            result.finalizedSnapshot = resultingSnapshot;
            result.replayBlockIndex = 1;
            return true;
        }
        if (allowUnfinalized) {
            // an unfinalized genesis block zero: the only run is the unfinalized tail
            result.replayBlockIndex = 0;
            return true;
        }
        return false;
    }

    /// The milestone's last block decodes to a height below `height`.
    function _isMilestoneBelow(MilestoneProof memory milestone, uint256 height) internal view returns (bool) {
        (bool decoded, Block memory lastBlock) = UtilityFacetInterface(utilityFacetAddress)
            .tryDecodeBlock(
                milestone.blockConfirmations[milestone.blockConfirmations.length - 1].signedBlock.encodedBlock
            );
        return decoded && lastBlock.transaction.header.transactionCnt < height;
    }

    /// Decodes the block at `blockIndex` and checks its channel and fork.
    function _tryDecodeRequiredBlock(ProofWalkInput memory input, MilestoneProof memory milestone, uint256 blockIndex)
        internal
        view
        returns (bool, Block memory decodedBlock)
    {
        bool decoded;
        (decoded, decodedBlock) = UtilityFacetInterface(utilityFacetAddress)
            .tryDecodeBlock(milestone.blockConfirmations[blockIndex].signedBlock.encodedBlock);
        return (
            decoded && decodedBlock.transaction.header.channelId == input.channelId
                && decodedBlock.transaction.header.forkId == input.forkId,
            decodedBlock
        );
    }

    /// The fork genesis as a snapshot: the start snapshot itself when it is this fork's genesis, else the input genesis
    /// data (it must hash to the fork ID), dated through its origin fork (also for a reduced fork not adopted on chain).
    function _getGenesisSnapshot(ProofWalkInput memory input, StateSnapshot memory startSnapshot)
        internal
        view
        returns (bool isLinked, bool hasTimestamp, StateSnapshot memory genesisSnapshot)
    {
        if (startSnapshot.forkId == input.forkId && !_canStartFromOnChainSnapshot(startSnapshot, input.forkId)) {
            return (true, true, startSnapshot);
        }
        if (!_isGenesisSnapshotDataLinkedToFork(input.forkId, input.genesisStateSnapshotData)) {
            return (false, false, genesisSnapshot);
        }
        genesisSnapshot.snapshotData = input.genesisStateSnapshotData;
        genesisSnapshot.forkId = input.forkId;
        (hasTimestamp, genesisSnapshot.timestamp) =
            _getGenesisTimestamp(input.channelId, input.genesisStateSnapshotData.originForkId, input.forkId);
        return (true, hasTimestamp, genesisSnapshot);
    }

    /// The required signers of a hop: the previous and resulting participants, plus every joiner whose JOIN the hop
    /// consumes (on-chain inbound blocks between the two snapshots' inbound hashes).
    function _deriveMilestoneUnionParticipants(
        bytes32 channelId,
        SnapshotData memory previousSnapshotData,
        SnapshotData memory resultingSnapshotData
    ) internal view returns (address[] memory expectedParticipants) {
        expectedParticipants = UtilityFacetInterface(utilityFacetAddress)
            .concatAddressArraysNoDuplicates(previousSnapshotData.participants, resultingSnapshotData.participants);
        address[] memory pendingParticipants = _derivePendingParticipantsFromInboundHash(
            channelId,
            resultingSnapshotData.latestInboundMessageBlockHash,
            previousSnapshotData.latestInboundMessageBlockHash
        );
        return UtilityFacetInterface(utilityFacetAddress)
            .concatAddressArraysNoDuplicates(expectedParticipants, pendingParticipants);
    }

    /**
     * Walks `milestone` from `fromIndex`: every block decodes, stays on `forkId` and the run's channel, links to its
     * predecessor by hash and height + 1, and carries its author's signature. Counts the distinct
     * `expectedParticipants` among the authors and confirmation signers. `failedIndex` is the first block that
     * breaks a rule.
     */
    function _walkMilestoneBlocks(
        bytes32 channelId,
        bytes32 forkId,
        MilestoneProof memory milestone,
        uint256 fromIndex,
        address[] memory expectedParticipants
    )
        internal
        view
        returns (bool isLinked, uint256 thresholdCount, bytes32 fromBlockSnapshotHash, uint256 failedIndex)
    {
        // TODO - need a gas limit on verifyMilestone and on the state-proof walk, so large proofs that can't be verified won't be spammed
        if (fromIndex >= milestone.blockConfirmations.length) {
            return (false, 0, bytes32(0), fromIndex);
        }
        ThresholdTally memory tally =
            ThresholdTally(expectedParticipants, new address[](expectedParticipants.length), 0);
        bytes memory previousEncodedBlock;
        Block memory previousBlock;
        for (uint256 i = fromIndex; i < milestone.blockConfirmations.length; i++) {
            BlockConfirmation memory currentBlockConfirmation = milestone.blockConfirmations[i];
            (bool decoded, Block memory currentBlock) = UtilityFacetInterface(utilityFacetAddress)
                .tryDecodeBlock(currentBlockConfirmation.signedBlock.encodedBlock);
            if (!_walkBlock(
                    channelId,
                    forkId,
                    currentBlockConfirmation,
                    decoded,
                    currentBlock,
                    i != fromIndex,
                    previousEncodedBlock,
                    previousBlock,
                    tally
                )) return (false, 0, bytes32(0), i);
            if (i == fromIndex) fromBlockSnapshotHash = currentBlock.stateSnapshotHash;
            previousEncodedBlock = currentBlockConfirmation.signedBlock.encodedBlock;
            previousBlock = currentBlock;
        }
        return (true, tally.count, fromBlockSnapshotHash, 0);
    }

    /**
     * The per-block rules of a walked run, for one block: it decoded and is on `forkId`; the run's first checked
     * block names `channelId`, a later one links to `previousBlock` by channel, hash and height + 1; it carries its
     * author's signature and every confirmation signature recovers. Counts its signers into `tally`.
     */
    function _walkBlock(
        bytes32 channelId,
        bytes32 forkId,
        BlockConfirmation memory confirmation,
        bool decoded,
        Block memory currentBlock,
        bool hasPrevious,
        bytes memory previousEncodedBlock,
        Block memory previousBlock,
        ThresholdTally memory tally
    ) internal view returns (bool) {
        if (!decoded || currentBlock.transaction.header.forkId != forkId) return false;
        if (hasPrevious) {
            if (
                currentBlock.transaction.header.channelId != previousBlock.transaction.header.channelId
                    || currentBlock.previousBlockHash != keccak256(previousEncodedBlock)
                    || !_isNextHeight(previousBlock, currentBlock)
            ) return false;
        } else if (channelId != bytes32(0) && currentBlock.transaction.header.channelId != channelId) {
            return false;
        }
        bytes memory encodedBlock = confirmation.signedBlock.encodedBlock;
        (address adr, bool isValid) = UtilityFacetInterface(utilityFacetAddress)
            .retrieveSignerAddress(encodedBlock, confirmation.signedBlock.signature);
        if (!isValid || adr != currentBlock.transaction.header.participant) return false;
        // This doesn't check if the signer is a participant -> if it's a dishonest block it will fail on the STF and the dispute will be slashed
        _tally(tally, adr);
        for (uint256 j = 0; j < confirmation.signatures.length; j++) {
            (adr, isValid) = UtilityFacetInterface(utilityFacetAddress)
                .retrieveSignerAddress(encodedBlock, confirmation.signatures[j]);
            if (!isValid) return false;
            _tally(tally, adr);
        }
        return true;
    }

    function _tally(ThresholdTally memory tally, address adr) internal pure {
        tally.count = _tryInsertAddressInThresholdSet(adr, tally.set, tally.count, tally.expected);
    }

    /// Every inbound block from `upperInboundHash` down to `lowerInboundHash` is stored.
    function _isInboundRunStored(bytes32 channelId, bytes32 upperInboundHash, bytes32 lowerInboundHash)
        internal
        view
        returns (bool)
    {
        bytes32 inboundHash = upperInboundHash;
        while (inboundHash != lowerInboundHash) {
            if (inboundHash == bytes32(0) || !_hasInboundMessageBlock(channelId, inboundHash)) return false;
            inboundHash = inboundMessageBlockMap[channelId][inboundHash].previousBlockHash;
        }
        return true;
    }

    /// `current` is the height right after `previous`, without overflowing at the maximum height.
    function _isNextHeight(Block memory previous, Block memory current) internal pure returns (bool) {
        uint256 currentHeight = current.transaction.header.transactionCnt;
        return currentHeight != 0 && currentHeight - 1 == previous.transaction.header.transactionCnt;
    }

    function _tryInsertAddressInThresholdSet(
        address adr,
        address[] memory thresholdSet,
        uint256 currentThresholdCount,
        address[] memory expectedParticipants
    ) internal pure returns (uint256) {
        for (uint256 i = 0; i < expectedParticipants.length; i++) {
            if (expectedParticipants[i] == adr && thresholdSet[i] != adr) {
                thresholdSet[i] = adr;
                return currentThresholdCount + 1;
            }
        }

        return currentThresholdCount;
    }
}
