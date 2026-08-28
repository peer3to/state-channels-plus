import { expect } from "chai";
import { ethers } from "hardhat";

import {
    deployMathChannelProxyFixture,
    DeployedFacetAddresses
} from "@test/test_utils/testHelpers";
import {
    diamondCallableFunctions,
    diamondFunctionLabel,
    expectFacetSelectorsNotRouted,
    expectFacetSelectorsRouted,
    facetRoutingSpecs,
    facetRoutingSpec,
    facetSelectorCollisions,
    interfaceFunctions,
    proxyShadowedRoutedFunctions
} from "@test/fixtures/ProxySelectorRoutingFixture";
import {
    StateChannelManagerInterface,
    StateChannelManagerProxy__factory
} from "@typechain-types";

describe("StateChannelManagerProxy selector routing", function () {
    let diamond: StateChannelManagerInterface;
    let facetAddresses: DeployedFacetAddresses;
    let consumerFacetAddress: string;

    // The routing table is immutable, so one deployment serves every case.
    before(async function () {
        const contracts = await deployMathChannelProxyFixture(ethers);
        diamond = contracts.mathChannelManager;
        facetAddresses = contracts.facetAddresses;
        consumerFacetAddress = contracts.consumerFacetAddress;
    });

    it("uses the canonical routed-facet inventory for every deployed facet", function () {
        expect(
            facetRoutingSpecs.map(({ facetName }) => facetName).sort()
        ).to.deep.equal(Object.keys(facetAddresses).sort());
    });

    it("routes every dispute manager selector to the dispute manager facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("DisputeManagerFacet"),
            facetAddresses.DisputeManagerFacet
        );
    });

    it("routes every dispute verification selector to the dispute verification facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("DisputeVerificationFacet"),
            facetAddresses.DisputeVerificationFacet
        );
    });

    it("routes every fraud proof selector to the fraud proof facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("FraudProofFacet"),
            facetAddresses.FraudProofFacet
        );
    });

    it("routes every dispute fraud proof selector to the dispute fraud proof facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("DisputeFraudProofFacet"),
            facetAddresses.DisputeFraudProofFacet
        );
    });

    it("routes every state snapshot selector to the state snapshot facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("StateSnapshotFacet"),
            facetAddresses.StateSnapshotFacet
        );
    });

    it("routes every join channel selector to the join channel facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("JoinChannelFacet"),
            facetAddresses.JoinChannelFacet
        );
    });

    it("routes every state proof selector to the state proof facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("StateProofFacet"),
            facetAddresses.StateProofFacet
        );
    });

    it("routes every utility view selector to the utility facet", async function () {
        await expectFacetSelectorsRouted(
            diamond,
            facetRoutingSpec("UtilityFacet"),
            facetAddresses.UtilityFacet
        );
    });

    it("leaves the utility facet's stateless helpers off the routing table", async function () {
        await expectFacetSelectorsNotRouted(
            diamond,
            facetRoutingSpec("UtilityFacet"),
            consumerFacetAddress
        );
    });

    it("leaves the dispute verification facet's internal steps off the routing table", async function () {
        await expectFacetSelectorsNotRouted(
            diamond,
            facetRoutingSpec("DisputeVerificationFacet"),
            consumerFacetAddress
        );
    });

    it("leaves the fraud proof facet's internal step off the routing table", async function () {
        await expectFacetSelectorsNotRouted(
            diamond,
            facetRoutingSpec("FraudProofFacet"),
            consumerFacetAddress
        );
    });

    it("has no selector defined by two facets", async function () {
        const collisions = facetSelectorCollisions();
        expect(
            [...collisions].map(
                ([selector, facets]) => `${selector}: ${facets.join(", ")}`
            )
        ).to.deep.equal([]);
    });

    it("has no routed facet selector shadowed by a proxy function", async function () {
        // A shadowed routed function is unreachable: the proxy body dispatches
        // first, while facetAddressForSelector still reports its facet.
        expect(
            proxyShadowedRoutedFunctions().map(diamondFunctionLabel)
        ).to.deep.equal([]);
    });

    it("declares every proxy-owned and routed facet function on the interface", async function () {
        const declared = new Set(
            interfaceFunctions().map((fragment) => fragment.selector)
        );
        const undeclared = [...diamondCallableFunctions().values()]
            .filter((callable) => !declared.has(callable.fragment.selector))
            .map(diamondFunctionLabel);
        expect(undeclared).to.deep.equal([]);
    });

    it("declares nothing the proxy neither implements nor routes", async function () {
        const callables = diamondCallableFunctions();
        const unreachable = interfaceFunctions()
            .filter((fragment) => !callables.has(fragment.selector))
            .map((fragment) => fragment.format("sighash"));
        expect(unreachable).to.deep.equal([]);
    });

    it("declares the implementing function's state mutability for every interface function", async function () {
        const callables = diamondCallableFunctions();
        const mismatches: string[] = [];
        for (const fragment of interfaceFunctions()) {
            const callable = callables.get(fragment.selector);
            if (callable === undefined) continue;
            if (callable.fragment.stateMutability === fragment.stateMutability)
                continue;
            mismatches.push(
                `${diamondFunctionLabel(callable)}: interface=${fragment.stateMutability} ${callable.implementorName}=${callable.fragment.stateMutability}`
            );
        }
        expect(mismatches).to.deep.equal([]);
    });

    it("declares the implementing function's full signature for every interface function", async function () {
        const callables = diamondCallableFunctions();
        const mismatches: string[] = [];
        for (const fragment of interfaceFunctions()) {
            const callable = callables.get(fragment.selector);
            if (callable === undefined) continue;
            if (callable.fragment.format("full") === fragment.format("full"))
                continue;
            mismatches.push(
                `interface: ${fragment.format("full")}\n${callable.implementorName}: ${callable.fragment.format("full")}`
            );
        }
        expect(mismatches).to.deep.equal([]);
    });

    it("resolves an unknown selector to the consumer facet", async function () {
        const unknownSelector = ethers
            .id("thisFunctionDoesNotExistOnTheDiamond()")
            .slice(0, 10);
        expect(await diamond.facetAddressForSelector(unknownSelector)).to.equal(
            consumerFacetAddress
        );
    });

    it("keeps the proxy's own selectors out of the routing table", async function () {
        // The proxy's declared functions dispatch before the fallback, so the
        // routing table never sees them and reports the fallback of last resort.
        const proxyInterface =
            StateChannelManagerProxy__factory.createInterface();
        const openSelector = proxyInterface.getFunction("open").selector;
        expect(await diamond.facetAddressForSelector(openSelector)).to.equal(
            consumerFacetAddress
        );
    });
});
