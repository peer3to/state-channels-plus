// @spec-test-coverage-ignore: shared Foundry diamond deployment harness exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DisputeManagerFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {FraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {StateSnapshotFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol";
import {JoinChannelFacet} from "../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {MathConsumerFacet} from "../../../contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol";

import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

abstract contract DiamondHarness is Test {
    MathStateMachine internal stateMachine;
    UtilityFacet internal utilityFacet;
    FraudProofFacet internal fraudProofFacet;
    MathConsumerFacet internal consumerFacet;
    // never etched, so signed opening terms carry the real Math genesis hash
    MathConsumerFacet internal genesisReference;
    StateChannelManagerInterface internal deployedDiamond;

    // non-zero so tests check against a known value, not the contract default
    uint256 internal constant P2P_TIME = 100;
    uint256 internal constant SM_GAS_LIMIT = 3_000_000;
    uint256 internal constant MAX_CHANNEL_PARTICIPANTS = 32;

    /// @dev Returns the diamond typed as its full external surface: the proxy
    /// implements only a few selectors itself and routes the rest to facets.
    function deployDiamond() internal returns (StateChannelManagerInterface diamond) {
        return deployDiamondWith(
            MathStateMachine(
                vm.deployCode(
                    "MathStateMachine.sol:MathStateMachine", abi.encode(SM_GAS_LIMIT, MAX_CHANNEL_PARTICIPANTS)
                )
            )
        );
    }

    /// @dev Same deployment behind a caller-supplied machine (a Math variant), for suites that
    /// need transitions the reference machine does not have.
    function deployDiamondWith(MathStateMachine machine) internal returns (StateChannelManagerInterface diamond) {
        stateMachine = machine;
        // deployCode deploys the built contracts/ artifacts; `new` would embed and
        // re-optimize every facet inside each via_ir test contract

        DisputeManagerFacet disputeManager =
            DisputeManagerFacet(vm.deployCode("DisputeManagerFacet.sol:DisputeManagerFacet"));
        DisputeVerificationFacet disputeVerification =
            DisputeVerificationFacet(vm.deployCode("DisputeVerificationFacet.sol:DisputeVerificationFacet"));
        fraudProofFacet = FraudProofFacet(vm.deployCode("FraudProofFacet.sol:FraudProofFacet"));
        DisputeFraudProofFacet disputeFraudProof =
            DisputeFraudProofFacet(vm.deployCode("DisputeFraudProofFacet.sol:DisputeFraudProofFacet"));
        StateSnapshotFacet stateSnapshot =
            StateSnapshotFacet(vm.deployCode("StateSnapshotFacet.sol:StateSnapshotFacet"));
        JoinChannelFacet joinChannel = JoinChannelFacet(vm.deployCode("JoinChannelFacet.sol:JoinChannelFacet"));
        StateProofFacet stateProof = StateProofFacet(vm.deployCode("StateProofFacet.sol:StateProofFacet"));
        utilityFacet = UtilityFacet(vm.deployCode("UtilityFacet.sol:UtilityFacet"));
        consumerFacet = MathConsumerFacet(vm.deployCode("MathConsumerFacet.sol:MathConsumerFacet"));
        genesisReference = MathConsumerFacet(vm.deployCode("MathConsumerFacet.sol:MathConsumerFacet"));

        diamond = StateChannelManagerInterface(
            address(
                vm.deployCode(
                    "StateChannelManagerProxy.sol:StateChannelManagerProxy",
                    abi.encode(
                        address(stateMachine),
                        address(disputeManager),
                        address(disputeVerification),
                        address(fraudProofFacet),
                        address(disputeFraudProof),
                        address(stateSnapshot),
                        address(joinChannel),
                        address(stateProof),
                        address(utilityFacet),
                        address(consumerFacet),
                        P2P_TIME,
                        0, // agreementTime  -> contract default
                        0, // chainFallbackTime -> default
                        0, // evidenceTime -> default
                        0, // disputeExecutionGasLimit -> default
                        MAX_CHANNEL_PARTICIPANTS
                    )
                )
            )
        );
        deployedDiamond = diamond;
    }

    function _sign(uint256 pk, bytes memory encodedBlock) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(encodedBlock)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// `join` signed by `joinerPk` and co-signed by each of `signerPks`
    function _joinConfirmation(JoinChannel memory join, uint256 joinerPk, uint256[] memory signerPks)
        internal
        pure
        returns (JoinChannelConfirmation memory confirmation)
    {
        bytes memory encodedJoin = abi.encode(join);
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoin, signature: _sign(joinerPk, encodedJoin)});
        confirmation.signatures = new bytes[](signerPks.length);
        for (uint256 i = 0; i < signerPks.length; i++) {
            confirmation.signatures[i] = _sign(signerPks[i], encodedJoin);
        }
    }

    /// the 0xA11CE / 0xB0B pair suites open two-party channels with
    function _twoPartyPrivateKeys() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = 0xA11CE;
        pks[1] = 0xB0B;
    }

    // distinct slots of `account` written from zero to nonzero
    function _freshSlotsOf(address account, Vm.AccountAccess[] memory accesses) internal pure returns (uint256 count) {
        bytes32[] memory seen = new bytes32[](256);
        for (uint256 i = 0; i < accesses.length; i++) {
            Vm.StorageAccess[] memory storageAccesses = accesses[i].storageAccesses;
            for (uint256 j = 0; j < storageAccesses.length; j++) {
                Vm.StorageAccess memory access = storageAccesses[j];
                if (access.account != account || !access.isWrite || access.reverted) continue;
                if (access.previousValue != 0 || access.newValue == 0) continue;
                bool counted;
                for (uint256 k = 0; k < count; k++) {
                    if (seen[k] == access.slot) counted = true;
                }
                if (!counted) seen[count++] = access.slot;
            }
        }
    }

    function _makeSignedBlock(
        uint256 pk,
        bytes32 channelId,
        bytes32 forkId,
        uint256 transactionCnt,
        uint256 timestamp,
        bytes32 previousBlockHash
    ) internal pure returns (SignedBlock memory) {
        Block memory b;
        b.transaction.header.channelId = channelId;
        b.transaction.header.participant = vm.addr(pk);
        b.transaction.header.forkId = forkId;
        b.transaction.header.transactionCnt = transactionCnt;
        b.transaction.header.timestamp = timestamp;
        b.previousBlockHash = previousBlockHash;
        bytes memory enc = abi.encode(b);
        return SignedBlock({encodedBlock: enc, signature: _sign(pk, enc)});
    }

    function _makeSignedGenesisBlock(
        uint256 pk,
        bytes32 channelId,
        bytes32 forkId,
        uint256 timestamp,
        bytes32 previousBlockHash
    ) internal pure returns (SignedBlock memory) {
        return _makeSignedBlock(pk, channelId, forkId, 0, timestamp, previousBlockHash);
    }

    /// An open-channel request signed by every listed participant.
    function _openChannelConfirmation(
        bytes32 channelId,
        uint256[] memory participantPrivateKeys,
        uint256[] memory amounts
    ) internal view returns (OpenChannelConfirmation memory) {
        return _openChannelConfirmationWithDeadline(
            channelId, participantPrivateKeys, amounts, block.timestamp + 1 days
        );
    }

    /// The same signed open-channel request with caller-chosen terms deadline.
    function _openChannelConfirmationWithDeadline(
        bytes32 channelId,
        uint256[] memory participantPrivateKeys,
        uint256[] memory amounts,
        uint256 deadlineTimestamp
    ) internal view returns (OpenChannelConfirmation memory) {
        OpenChannel memory openChannel;
        openChannel.channelId = channelId;
        openChannel.participants = new address[](participantPrivateKeys.length);
        openChannel.balances = new Balance[](participantPrivateKeys.length);
        openChannel.deadlineTimestamp = deadlineTimestamp;

        JoinChannel[] memory joins = new JoinChannel[](participantPrivateKeys.length);
        for (uint256 i = 0; i < participantPrivateKeys.length; i++) {
            openChannel.participants[i] = vm.addr(participantPrivateKeys[i]);
            openChannel.balances[i] = Balance({amount: amounts[i], data: ""});
            joins[i] = JoinChannel({
                channelId: channelId,
                participant: openChannel.participants[i],
                deadlineTimestamp: deadlineTimestamp,
                balance: openChannel.balances[i]
            });
        }
        openChannel.genesisStateHash = keccak256(genesisReference.openChannelGenesis(joins, openChannel.data));

        bytes memory encodedOpenChannel = abi.encode(openChannel);
        bytes[] memory signatures = new bytes[](participantPrivateKeys.length);
        for (uint256 i = 0; i < participantPrivateKeys.length; i++) {
            signatures[i] = _sign(participantPrivateKeys[i], encodedOpenChannel);
        }

        return OpenChannelConfirmation({encodedOpenChannel: encodedOpenChannel, signatures: signatures});
    }

    function _openChannel(bytes32 channelId, uint256[] memory participantPrivateKeys) internal {
        deployedDiamond.open(
            _openChannelConfirmation(channelId, participantPrivateKeys, new uint256[](participantPrivateKeys.length))
        );
    }

    /// the chain snapshot's same-fork successor with `nextParticipants` and every pending inbound consumed;
    /// an empty set is the final close
    function _makeSameForkSnapshot(bytes32 channelId, address[] memory nextParticipants, uint256[] memory pks)
        internal
        view
        returns (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots)
    {
        StateSnapshot memory currentSnapshot = deployedDiamond.getStateSnapshot(channelId);
        ChannelBalance memory inboundHead = deployedDiamond.getChannelBalance(channelId);
        StateSnapshot memory nextSnapshot = currentSnapshot;
        nextSnapshot.snapshotData.participants = nextParticipants;
        nextSnapshot.snapshotData.latestInboundMessageBlockHash = inboundHead.latestInboundMessageBlockHash;
        nextSnapshot.snapshotData.latestInboundMessageBlockHeight = inboundHead.latestInboundMessageBlockHeight;
        nextSnapshot.blockHeight = currentSnapshot.blockHeight + 1;
        nextSnapshot.timestamp = currentSnapshot.timestamp + 1;

        Block memory nextBlock;
        nextBlock.transaction.header.channelId = channelId;
        nextBlock.transaction.header.participant = vm.addr(pks[0]);
        nextBlock.transaction.header.forkId = currentSnapshot.forkId;
        nextBlock.transaction.header.transactionCnt = nextSnapshot.blockHeight;
        nextBlock.transaction.header.timestamp = nextSnapshot.timestamp;
        nextBlock.stateSnapshotHash = keccak256(abi.encode(nextSnapshot));

        proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](1);
        proofs[0].blockConfirmations[0] = _blockConfirmation(abi.encode(nextBlock), pks);
        snapshots = new StateSnapshot[](1);
        snapshots[0] = nextSnapshot;
    }

    /// one-block milestone authored by `pks[0]` and co-signed by the rest
    function _milestone(bytes32 channelId, bytes32 forkId, uint256[] memory pks)
        internal
        pure
        returns (MilestoneProof memory milestone)
    {
        Block memory milestoneBlock;
        milestoneBlock.transaction.header.channelId = channelId;
        milestoneBlock.transaction.header.forkId = forkId;
        milestoneBlock.transaction.header.participant = vm.addr(pks[0]);
        milestoneBlock.transaction.header.transactionCnt = 1;
        milestone.blockConfirmations = new BlockConfirmation[](1);
        milestone.blockConfirmations[0] = _blockConfirmation(abi.encode(milestoneBlock), pks);
    }

    function _blockConfirmation(bytes memory encodedBlock, uint256[] memory pks)
        internal
        pure
        returns (BlockConfirmation memory confirmation)
    {
        confirmation.signedBlock = SignedBlock({encodedBlock: encodedBlock, signature: _sign(pks[0], encodedBlock)});
        confirmation.signatures = new bytes[](pks.length - 1);
        for (uint256 i = 1; i < pks.length; i++) {
            confirmation.signatures[i - 1] = _sign(pks[i], encodedBlock);
        }
    }

    /// The data of the first recorded log of `selector` indexed by `channelId`.
    function _logData(Vm.Log[] memory logs, bytes32 selector, bytes32 channelId) internal pure returns (bytes memory) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length < 2 || logs[i].topics[0] != selector || logs[i].topics[1] != channelId) continue;
            return logs[i].data;
        }
        revert("channel log not recorded");
    }
}
