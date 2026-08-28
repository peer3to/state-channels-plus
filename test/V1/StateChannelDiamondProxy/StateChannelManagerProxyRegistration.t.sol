// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {DisputeManagerFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol";
import {ErrorDuplicateSelectorRegistration} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";

contract DuplicateRouteRegistrationHarness is StateChannelManagerProxy {
    constructor()
        StateChannelManagerProxy(
            address(1),
            address(2),
            address(3),
            address(4),
            address(5),
            address(6),
            address(7),
            address(8),
            address(9),
            address(10),
            0,
            0,
            0,
            0,
            0
        )
    {
        _registerRoute(DisputeManagerFacet.uploadDispute.selector, address(2));
    }
}

contract StateChannelManagerProxyRegistrationTest is Test {
    function test_constructor_duplicateSelectorRegistration_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorDuplicateSelectorRegistration.selector, DisputeManagerFacet.uploadDispute.selector
            )
        );
        new DuplicateRouteRegistrationHarness();
    }

    function test_facetAddressForSelector_configuredZeroFacet_returnsZero() public {
        StateChannelManagerProxy proxy = new StateChannelManagerProxy(
            address(1),
            address(0),
            address(3),
            address(4),
            address(5),
            address(6),
            address(7),
            address(8),
            address(9),
            address(10),
            0,
            0,
            0,
            0,
            0
        );

        assertEq(proxy.facetAddressForSelector(DisputeManagerFacet.uploadDispute.selector), address(0));
    }
}
