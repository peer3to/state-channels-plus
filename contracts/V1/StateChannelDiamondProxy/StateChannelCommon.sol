pragma solidity ^0.8.8;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StateChannelManagerStorage.sol";
import "../StateChannelManagerEvents.sol";
import "../StateChannelManagerInterface.sol";
import "../types/MessageTypeHashes.sol";
import "./Errors.sol";
import "./utils/DisputeUtils.sol";
import "./utils/BlockUtils.sol";
import "./UtilityFacet.sol";

contract StateChannelCommon is StateChannelManagerStorage, StateChannelManagerEvents {
    function getOnChainSlashedParticipantsUpToTimestamp(bytes32 channelId, uint256 timestamp)
        public
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
        address[] memory finalSlashedParticipants = new address[](actualCount);
        for (uint256 i = 0; i < actualCount; i++) {
            finalSlashedParticipants[i] = slashedParticipants[i];
        }
        return finalSlashedParticipants;
    }

    function getOnChainSlashedParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        address[] memory slashedParticipants = new address[](disputeData[channelId].onChainSlashes.length);
        for (uint256 i = 0; i < disputeData[channelId].onChainSlashes.length; i++) {
            slashedParticipants[i] = disputeData[channelId].onChainSlashes[i].participant;
        }
        return slashedParticipants;
    }

    function isParticipantSlashedOnChain(bytes32 channelId, address participant) public view virtual returns (bool) {
        address[] memory slashedParticipants = getOnChainSlashedParticipants(channelId);
        for (uint256 i = 0; i < slashedParticipants.length; i++) {
            if (slashedParticipants[i] == participant) {
                return true;
            }
        }
        return false;
    }

    function addOnChainSlashedParticipant(bytes32 channelId, address slashedParticipant) internal virtual {
        if (isParticipantSlashedOnChain(channelId, slashedParticipant)) {
            return; //already slashed
        }
        disputeData[channelId].onChainSlashes.push(OnChainSlash(slashedParticipant, block.timestamp));
        emit ChainSlashed(channelId, slashedParticipant, block.timestamp);
    }

    function getOnChainThresholdSet(bytes32 channelId) public view virtual returns (address[] memory) {
        return UtilityFacet(utilityFacetAddress).subtractAddressArrays(
            UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(
                getSnapshotParticipants(channelId), getPendingParticipants(channelId)
            ),
            getOnChainSlashedParticipants(channelId)
        );
    }

    function getGenesisTimestamp(bytes32 channelId, bytes32 originForkId, bytes32 forkId)
        public
        view
        returns (bool isAvailable, uint256 timestamp)
    {
        DisputeData storage _disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = _disputeData.disputeWindowMap[originForkId];
        if (disputeWindow.evidence.creationTimestamp == 0) {
            StateSnapshot memory currentOnChainSnapshot = stateSnapshots[channelId];
            if (
                currentOnChainSnapshot.forkId == forkId
                    && StateChannelManagerInterface(address(this)).isGenesisSnapshotWithoutTimeCheck(currentOnChainSnapshot)
            ) {
                return (true, currentOnChainSnapshot.timestamp);
            }
            return (false, 0);
        }
        (bool isExpired, uint256 killPeriodEnd) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
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
                    && UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(currentOnChainSnapshot)
            ) {
                return (true, currentOnChainSnapshot.timestamp);
            }
            return (false, 0);
        }
        return (true, genesisTimestap);
    }

    function getSnapshotParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        return stateSnapshots[channelId].snapshotData.participants;
    }

    function getPendingParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        address[] memory pendingParticipants = _derivePendingParticipantsFromInboundHash(
            channelId, channelBalances[channelId].latestInboundMessageBlockHash, bytes32(0)
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
                    pendingParticipants = UtilityFacet(utilityFacetAddress).insertIntoAddressArrayNoDuplicates(
                        pendingParticipants, joinChannel.participant
                    );
                }
            }

            inboundHash = inboundBlock.previousBlockHash;
        }

        return pendingParticipants;
    }

    function _deriveEligibleParticipantsFromInboundHash(bytes32 channelId, bytes32 latestInboundMessageBlockHash)
        internal
        view
        returns (address[] memory eligibleParticipants)
    {
        address[] memory snapshotParticipants = getSnapshotParticipants(channelId);
        return _deriveEligibleParticipantsFromInboundHashAndSnapshotParticipants(
            channelId, latestInboundMessageBlockHash, snapshotParticipants
        );
    }

    function _deriveEligibleParticipantsFromInboundHashAndSnapshotParticipants(
        bytes32 channelId,
        bytes32 latestInboundMessageBlockHash,
        address[] memory snapshotParticipants
    ) internal view returns (address[] memory eligibleParticipants) {
        address[] memory pendingParticipants =
            _derivePendingParticipantsFromInboundHash(channelId, latestInboundMessageBlockHash, bytes32(0));

        address[] memory participants =
            UtilityFacet(utilityFacetAddress).concatAddressArraysNoDuplicates(snapshotParticipants, pendingParticipants);
        eligibleParticipants = UtilityFacet(utilityFacetAddress).subtractAddressArrays(
            participants, getOnChainSlashedParticipants(channelId)
        );
        return eligibleParticipants;
    }

    function getStateSnapshot(bytes32 channelId) public view virtual returns (StateSnapshot memory) {
        return stateSnapshots[channelId];
    }

    function getChannelBalance(bytes32 channelId) public view virtual returns (ChannelBalance memory) {
        return channelBalances[channelId];
    }

    function getStateMachineParticipants(bytes memory encodedState) public virtual returns (address[] memory) {
        // setState fails
        stateMachineImplementation.setState(encodedState);
        return stateMachineImplementation.getParticipants();
    }

    function getP2pTime() public view virtual returns (uint256) {
        return p2pTime;
    }

    function getAgreementTime() public view virtual returns (uint256) {
        return agreementTime;
    }

    function getChainFallbackTime() public view virtual returns (uint256) {
        return chainFallbackTime;
    }

    function getEvidenceTime() public view virtual returns (uint256) {
        return evidenceTime;
    }

    function getGasLimit() public view virtual returns (uint256) {
        return gasLimit;
    }

    function getAllTimes() public view virtual returns (uint256, uint256, uint256, uint256) {
        return (p2pTime, agreementTime, chainFallbackTime, evidenceTime);
    }

    function _persistInboundMessageBlock(bytes32 channelId, bytes32 blockHash, MessageBlock memory messageBlock)
        internal
    {
        MessageBlock storage storedBlock = inboundMessageBlockMap[channelId][blockHash];
        if (storedBlock.timestamp != 0 || storedBlock.messages.length != 0) {
            revert ErrorInboundMessageBlockAlreadyPersisted();
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

    function hasInboundMessageBlock(bytes32 channelId, bytes32 messageBlockHash) public view virtual returns (bool) {
        MessageBlock storage storedBlock = inboundMessageBlockMap[channelId][messageBlockHash];
        return storedBlock.timestamp != 0 || storedBlock.messages.length != 0;
    }

    function getBlockCallDataCommitment(bytes32 channelId, bytes32 forkId, uint256 blockHeight, address participant)
        public
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

    function isBlockAuthentic(SignedBlock memory _block) public view virtual returns (bool) {
        (bool decoded, Block memory decodedBlock) =
            UtilityFacet(utilityFacetAddress).tryDecodeBlock(_block.encodedBlock);
        if (!decoded) return false;
        (address signer, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(_block.encodedBlock, _block.signature);
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
    ) public view returns (bool) {
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

    function _isSnapshotLinkedToLatestBlock(Dispute memory dispute, StateSnapshot memory latestStateSnapshot)
        internal
        pure
        returns (bool)
    {
        bytes32 snapshotHash = keccak256(abi.encode(latestStateSnapshot));

        (bool hasBlock, Block memory latestBlock) = _getLatestBlock(dispute.input.stateProof);
        if (hasBlock) {
            return latestBlock.stateSnapshotHash == snapshotHash;
        }

        return dispute.input.forkId == keccak256(abi.encode(latestStateSnapshot.snapshotData));
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

    function _isLatestFinalizedStateLinkedToLatestFinalizedBlock(
        Dispute memory dispute,
        StateSnapshot memory latestFinalizedStateSnapshot,
        bytes memory latestFinalizedStateMachineState
    ) internal pure returns (bool) {
        bytes32 snapshotHash = keccak256(abi.encode(latestFinalizedStateSnapshot));
        if (
            latestFinalizedStateSnapshot.snapshotData.stateMachineStateHash
                != keccak256(latestFinalizedStateMachineState)
        ) {
            return false;
        }

        MilestoneProof[] memory milestones = dispute.input.stateProof.milestones;
        if (milestones.length > 0) {
            MilestoneProof memory lastMilestone = milestones[milestones.length - 1];
            if (lastMilestone.blockConfirmations.length == 0) {
                return false;
            }

            Block memory latestFinalizedBlock =
                abi.decode(lastMilestone.blockConfirmations[0].signedBlock.encodedBlock, (Block));
            return latestFinalizedBlock.stateSnapshotHash == snapshotHash;
        }

        return dispute.input.forkId == keccak256(abi.encode(latestFinalizedStateSnapshot.snapshotData));
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

        return _verifyInboundMessageBlocks(
            latestStateSnapshot.snapshotData.latestInboundMessageBlockHash,
            dispute.input.latestInboundMessageBlockHash,
            inboundMessageBlocks
        );
    }

    function _verifyInboundMessageBlocks(
        bytes32 previousInboundMessageBlockHash,
        bytes32 latestInboundMessageBlockHash,
        MessageBlock[] memory inboundMessageBlocks
    ) internal pure returns (bool) {
        uint256 lastHeight;
        bool hasLastHeight;
        for (uint256 i = 0; i < inboundMessageBlocks.length; i++) {
            if (previousInboundMessageBlockHash != inboundMessageBlocks[i].previousBlockHash) {
                return false;
            }
            if (hasLastHeight && inboundMessageBlocks[i].blockHeight != lastHeight + 1) {
                return false;
            }
            previousInboundMessageBlockHash = keccak256(abi.encode(inboundMessageBlocks[i]));
            lastHeight = inboundMessageBlocks[i].blockHeight;
            hasLastHeight = true;
        }
        return previousInboundMessageBlockHash == latestInboundMessageBlockHash;
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
                require(success, ErrorDisputeStateMachineInboundProcessingFailed());
                newTotalDeposits =
                    stateMachineImplementation.addBalance(newTotalDeposits, inboundMessageBlocks[i].messages[j].balance);
            }
        }
        encodedModifiedState = stateMachineImplementation.getState();
    }

    function _processOutboundMessage(Message memory message) internal virtual returns (bool) {
        if (message.messageType == MESSAGE_TYPE_EXIT) {
            ExitChannel memory exitChannel = abi.decode(message.data, (ExitChannel));
            require(
                stateMachineImplementation.areBalancesEqual(message.balance, exitChannel.balance),
                ErrorOutboundMessageBalanceMismatch()
            );
            bool success = StateChannelManagerInterface(address(this)).withdrawAssetsComposable(exitChannel);
            return success;
        }
        return _processCustomOutboundMessage(message);
    }

    function _processCustomOutboundMessage(Message memory message) internal virtual returns (bool) {
        revert ErrorOutboundMessageTypeUnsupported(message.messageType);
    }
    // !!!!!!!!!
    /// @dev Callable only by diamond facets - applies the join to the given state of the state machine and returns the modified state

    function applyJoinChannelToStateMachine(bytes memory encodedState, JoinChannel[] memory joinChannels)
        public
        onlySelf
        returns (bytes memory encodedModifiedState)
    {
        stateMachineImplementation.setState(encodedState);
        for (uint256 i = 0; i < joinChannels.length; i++) {
            bool success = stateMachineImplementation.joinChannel(joinChannels[i]);
            require(success, ErrorDisputeStateMachineJoiningFailed());
        }
        return (stateMachineImplementation.getState());
    }

    // !!!!!!!
    function isDisputeCommitted(Dispute memory dispute) internal view returns (bool) {
        bytes32 channelId = dispute.input.channelId;
        DisputeData storage disputeData = disputeData[channelId];
        DisputeWindow storage disputeWindow = disputeData.disputeWindowMap[_getDisputeFork(dispute)];
        bytes32 commitment = keccak256(abi.encode(dispute));

        for (uint256 i = 0; i < disputeWindow.evidence.disputeCommitments.length; i++) {
            if (disputeWindow.evidence.disputeCommitments[i] == commitment) {
                return true;
            }
        }
        return false;
    }

    function canParticipateInDisputes(bytes32 channelId, address participant) public view returns (bool) {
        address[] memory eligibleParticipants = _deriveEligibleParticipantsFromInboundHash(
            channelId, channelBalances[channelId].latestInboundMessageBlockHash
        );
        return UtilityFacet(utilityFacetAddress).isAddressInArray(eligibleParticipants, participant);
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
        (bool isExpired,) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
        require(isExpired, RaceConditionDisputeKillPeriodNotExpired());
        require(disputeWindow.reducedResult.forkId == bytes32(0), RaceConditionDisputeAlreadyReduced());
        disputeWindow.reducedResult.forkId = reducedForkId;
        disputeWindow.reducedResult.timestamp = reductionTimestamp;
        disputeWindow.reducedResult.reducer = msg.sender; //calling function should check that msg.sender is part of channel 'can participate'

        emit DisputeReducedResultCommitted(
            channelId, disputeWindow.forkId, reducedForkId, reductionTimestamp, msg.sender
        );
    }
}
