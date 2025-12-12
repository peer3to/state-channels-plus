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
            UtilityFacet(utilityFacetAddress).concatAddressArrays(
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
                    && UtilityFacet(utilityFacetAddress).isGenesisSnapshotWithoutTimeCheck(currentOnChainSnapshot)
            ) {
                return (true, currentOnChainSnapshot.timestamp);
            }
            return (false, 0);
        }
        (bool isExpired, uint256 killPeriodEnd) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
        if (!isExpired) {
            return (false, killPeriodEnd);
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
            return (false, killPeriodEnd);
        }
        return (true, killPeriodEnd);
    }

    function getSnapshotParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        return stateSnapshots[channelId].snapshotData.participants;
    }

    function getPendingParticipants(bytes32 channelId) public view virtual returns (address[] memory) {
        return disputeData[channelId].pendingParticipants;
    }

    function getStateSnapshot(bytes32 channelId) public view virtual returns (StateSnapshot memory) {
        return stateSnapshots[channelId];
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

    function appendInboundMessages(bytes32 channelId, Message[] memory messages)
        public
        onlySelf
        returns (MessageBlock memory messageBlock, Balance memory newTotalDeposits)
    {
        return _appendInboundMessages(channelId, messages);
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

    function decodeBlock(bytes memory encodedBlock) public pure returns (Block memory) {
        return abi.decode(encodedBlock, (Block));
    }

    function isBlockAuthentic(SignedBlock memory _block) public view returns (bool) {
        // try decode block
        bytes memory data = abi.encodeCall(this.decodeBlock, (_block.encodedBlock));
        (bool success, bytes memory encodedBlock) = address(this).staticcall(data);
        if (!success) return false;
        Block memory decodedBlock = abi.decode(encodedBlock, (Block));
        (address signer, bool isValid) =
            UtilityFacet(utilityFacetAddress).retrieveSignerAddress(encodedBlock, _block.signature);
        if (signer != decodedBlock.transaction.header.participant || !isValid) {
            return false;
        }
        return true;
    }

    function _verifyOutboundMessageBlocks(
        MessageBlock[] memory outboundMessageBlocks,
        SnapshotData memory fromSnapshot,
        SnapshotData memory toSnapshot
    ) public view returns (bool) {
        bytes32 previousBlockHash = fromSnapshot.latestOutboundMessageBlockHash;
        Balance memory totalOutbound = fromSnapshot.totalWithdrawals;
        uint256 expectedHeight = fromSnapshot.latestOutboundMessageBlockHeight;

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
        if (keccak256(abi.encode(totalOutbound)) != keccak256(abi.encode(toSnapshot.totalWithdrawals))) {
            return false;
        }
        if (expectedHeight != toSnapshot.latestOutboundMessageBlockHeight) {
            return false;
        }

        return previousBlockHash == toSnapshot.latestOutboundMessageBlockHash;
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

    function _canParticipateInDisputes(bytes32 channelId, address participant) public view returns (bool) {
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

        return !isParticipantSlashedOnChain(channelId, participant);
    }
    // ???????

    function _commitToDisputeReducedResult(
        bytes32 channelId,
        DisputeWindow storage disputeWindow,
        bytes32 reducedForkId,
        uint256 reductionTimestamp
    ) internal {
        (bool isExpired,) = _isKillPeriodExpired(disputeWindow, getEvidenceTime());
        require(isExpired, ErrorDisputeKillPeriodNotExpired());
        require(disputeWindow.reducedResult.forkId == bytes32(0), ErrorDisputeAlreadyReduced());
        disputeWindow.reducedResult.forkId = reducedForkId;
        disputeWindow.reducedResult.timestamp = reductionTimestamp;
        disputeWindow.reducedResult.reducer = msg.sender; //calling function should check that msg.sender is part of channel 'can participate'

        emit DisputeReducedResultCommitted(
            channelId, disputeWindow.forkId, reducedForkId, reductionTimestamp, msg.sender
        );
    }
}
