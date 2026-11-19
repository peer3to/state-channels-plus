// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {DisputeManagerFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol";
import {
    ErrorDuplicateSelectorRegistration,
    ErrorRouteTargetHasNoCode
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {ErrorNonCanonicalEncoding} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {Block, SignedBlock} from "../../../contracts/V1/types/DataTypes.sol";

contract RouteTarget {}

contract DuplicateRouteRegistrationHarness is StateChannelManagerProxy {
    constructor(address routeTarget)
        StateChannelManagerProxy(
            address(1),
            routeTarget,
            routeTarget,
            routeTarget,
            routeTarget,
            routeTarget,
            routeTarget,
            routeTarget,
            routeTarget,
            address(10),
            0,
            0,
            0,
            0,
            0,
            0
        )
    {
        _registerRoute(DisputeManagerFacet.uploadDispute.selector, routeTarget);
    }
}

contract StateChannelManagerProxyRegistrationTest is Test {
    function _deployUtilityProxy() internal returns (StateChannelManagerProxy proxy) {
        UtilityFacet utilityFacet = new UtilityFacet();
        proxy = new StateChannelManagerProxy(
            address(1),
            address(utilityFacet),
            address(utilityFacet),
            address(utilityFacet),
            address(utilityFacet),
            address(utilityFacet),
            address(utilityFacet),
            address(utilityFacet),
            address(utilityFacet),
            address(10),
            0,
            0,
            0,
            0,
            0,
            0
        );
    }

    function _canonicalBlockForPoster(address poster) internal pure returns (Block memory b) {
        b.transaction.header.channelId = keccak256("poster-channel");
        b.transaction.header.participant = poster;
        b.transaction.header.forkId = keccak256("poster-fork");
        b.transaction.header.transactionCnt = 1;
        b.transaction.header.timestamp = 1;
        b.transaction.body.data = hex"ab";
        b.stateSnapshotHash = keccak256("poster-snapshot");
        b.previousBlockHash = keccak256("poster-prev");
    }

    function test_postBlockCalldata_rejectsNonCanonicalWithoutCommitment() public {
        StateChannelManagerProxy proxy = _deployUtilityProxy();
        Block memory b = _canonicalBlockForPoster(address(this));
        bytes memory canonical = abi.encode(b);
        SignedBlock memory noncanonical =
            SignedBlock({encodedBlock: abi.encodePacked(canonical, bytes32(uint256(0x1234))), signature: hex""});
        (bool foundBefore, bytes32 commitmentBefore) = StateChannelManagerInterface(address(proxy))
            .getBlockCallDataCommitment(b.transaction.header.channelId, b.transaction.header.forkId, 1, address(this));
        assertFalse(foundBefore, "commitment must be absent before the rejected post");
        assertEq(commitmentBefore, bytes32(0), "commitment must be absent before the rejected post");
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        proxy.postBlockCalldata(noncanonical, block.timestamp);
        (bool foundAfter, bytes32 commitmentAfter) = StateChannelManagerInterface(address(proxy))
            .getBlockCallDataCommitment(b.transaction.header.channelId, b.transaction.header.forkId, 1, address(this));
        assertFalse(foundAfter, "rejected post must not store a commitment");
        assertEq(commitmentAfter, bytes32(0), "rejected post must not store a commitment");
    }

    function test_postBlockCalldata_canonicalStoresCommitment() public {
        StateChannelManagerProxy proxy = _deployUtilityProxy();
        Block memory b = _canonicalBlockForPoster(address(this));
        bytes memory canonical = abi.encode(b);
        SignedBlock memory noncanonical =
            SignedBlock({encodedBlock: abi.encodePacked(canonical, bytes32(uint256(0x1234))), signature: hex""});
        vm.expectRevert(abi.encodeWithSelector(ErrorNonCanonicalEncoding.selector));
        proxy.postBlockCalldata(noncanonical, block.timestamp);
        SignedBlock memory signedBlock = SignedBlock({encodedBlock: canonical, signature: hex""});
        proxy.postBlockCalldata(signedBlock, block.timestamp);
        bytes32 expected = keccak256(abi.encode(signedBlock, block.timestamp));
        (bool found, bytes32 commitment) = StateChannelManagerInterface(address(proxy))
            .getBlockCallDataCommitment(b.transaction.header.channelId, b.transaction.header.forkId, 1, address(this));
        assertTrue(found, "canonical post must store a commitment");
        assertEq(commitment, expected, "commitment must bind the signed block and timestamp");
    }

    function test_constructor_duplicateSelectorRegistration_reverts() public {
        RouteTarget routeTarget = new RouteTarget();
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorDuplicateSelectorRegistration.selector, DisputeManagerFacet.uploadDispute.selector
            )
        );
        new DuplicateRouteRegistrationHarness(address(routeTarget));
    }

    function test_constructor_codelessRouteTarget_reverts() public {
        RouteTarget routeTarget = new RouteTarget();
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorRouteTargetHasNoCode.selector, DisputeManagerFacet.uploadDispute.selector, address(0)
            )
        );
        new StateChannelManagerProxy(
            address(1),
            address(0),
            address(routeTarget),
            address(routeTarget),
            address(routeTarget),
            address(routeTarget),
            address(routeTarget),
            address(routeTarget),
            address(routeTarget),
            address(10),
            0,
            0,
            0,
            0,
            0,
            0
        );
    }

    function test_routedSelector_executesOnFacet() public {
        StateChannelManagerProxy proxy = _deployUtilityProxy();

        assertEq(StateChannelManagerInterface(address(proxy)).getP2pTime(), 15);
    }
}
