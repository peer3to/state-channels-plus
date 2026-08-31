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
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";

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
            0
        )
    {
        _registerRoute(DisputeManagerFacet.uploadDispute.selector, routeTarget);
    }
}

contract StateChannelManagerProxyRegistrationTest is Test {
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
            0
        );
    }

    function test_routedSelector_executesOnFacet() public {
        UtilityFacet utilityFacet = new UtilityFacet();
        StateChannelManagerProxy proxy = new StateChannelManagerProxy(
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
            0
        );

        assertEq(StateChannelManagerInterface(address(proxy)).getP2pTime(), 15);
    }
}
