// @spec-test-coverage-ignore: shared facet routing spec and assertion helpers; the executable evidence is mapped from SelectorRouting.test.ts
import { expect } from "chai";
import { ethers, FunctionFragment, InterfaceAbi } from "ethers";
import {
    StateChannelManagerInterface,
    StateChannelManagerInterface__factory,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import { routedFacets } from "@/utils/routedFacets";

/** Solidity function name as written on the facet. */
type FacetFunctionName = string;
/** Why a facet function is deliberately absent from the diamond's routed surface. */
type ExclusionReason = string;
/** 4-byte function selector as an `0x`-prefixed hex string. */
type Selector = string;
/** Contract that implements a callable function - the proxy or one of the facets. */
type ImplementorName = string;

/** A function reachable on the deployed diamond, with the contract that implements it. */
export type DiamondFunction = {
    implementorName: ImplementorName;
    fragment: FunctionFragment;
};

export type FacetRoutingSpec = {
    /** Contract name, as the deployment fixture keys its facet addresses. */
    facetName: string;
    abi: InterfaceAbi;
    notRouted: Record<FacetFunctionName, ExclusionReason>;
};

/**
 * One entry per facet the proxy routes to. Every function of a facet's ABI must
 * either resolve to that facet through `facetAddressForSelector` or be listed in
 * `notRouted` with the reason it stays off the diamond's external surface.
 */
const notRoutedByFacet: Record<
    string,
    Record<FacetFunctionName, ExclusionReason>
> = {
    DisputeVerificationFacet: {
        checkDisputeAuditingDataCommitment:
            "internal verification step - reached by facets and LocalDiamond, never through the proxy",
        computeDisputeOutputSnapshotData:
            "dispute computation helper - LocalDiamond delegatecalls it with its own gas budget",
        computeDisputeOutputState:
            "dispute computation helper - LocalDiamond delegatecalls it with its own gas budget",
        generateDisputeOutputState:
            "internal step of the dispute pipeline, not part of the diamond surface",
        isDisputeOutputCorrect:
            "dispute verification helper - LocalDiamond delegatecalls it with its own gas budget",
        killDispute:
            "invoked from within the dispute pipeline; exposing it externally would widen the attack surface"
    },
    FraudProofFacet: {
        runFraudProof:
            "single fraud-proof step driven by applyFraudProofs; not callable on its own"
    },
    UtilityFacet: {
        // The stateless helpers are called externally on the deployed facet by
        // StateChannelCommon, so they are not part of the diamond's surface.
        areAddressArraysEqual: "stateless helper called on the facet directly",
        concatAddressArraysNoDuplicates:
            "stateless helper called on the facet directly",
        concatBytesArrays: "stateless helper called on the facet directly",
        concatExitChannelArrays:
            "stateless helper called on the facet directly",
        decodeBlock: "stateless helper called on the facet directly",
        inParticipantUnion: "stateless helper called on the facet directly",
        insertBytesInByteArray: "stateless helper called on the facet directly",
        insertIntoAddressArrayNoDuplicates:
            "stateless helper called on the facet directly",
        isAddressInArray: "stateless helper called on the facet directly",
        retrieveSignerAddress: "stateless helper called on the facet directly",
        subtractAddressArrays: "stateless helper called on the facet directly",
        tryDecodeBlock: "stateless helper called on the facet directly",
        verifyThresholdSigned: "stateless helper called on the facet directly"
    }
};

export const facetRoutingSpecs: FacetRoutingSpec[] = routedFacets.map(
    ({ facetName, factory }) => ({
        facetName,
        abi: factory.abi as InterfaceAbi,
        notRouted: notRoutedByFacet[facetName] ?? {}
    })
);

export function facetRoutingSpec(facetName: string): FacetRoutingSpec {
    const spec = facetRoutingSpecs.find((s) => s.facetName === facetName);
    if (!spec) throw new Error(`No routing spec for facet ${facetName}`);
    return spec;
}

function functionFragments(abi: InterfaceAbi): FunctionFragment[] {
    return [...ethers.Interface.from(abi).fragments].filter(
        (fragment): fragment is FunctionFragment => fragment.type === "function"
    );
}

/**
 * Asserts that every function of the facet's ABI resolves to `facetAddress`
 * through the proxy's routing table, except the ones the spec excludes.
 */
export async function expectFacetSelectorsRouted(
    diamond: StateChannelManagerInterface,
    spec: FacetRoutingSpec,
    facetAddress: string
): Promise<void> {
    const routed = functionFragments(spec.abi).filter(
        (fragment) => !(fragment.name in spec.notRouted)
    );
    expect(
        routed.length,
        `${spec.facetName} has routed functions`
    ).to.be.greaterThan(0);
    for (const fragment of routed) {
        expect(
            await diamond.facetAddressForSelector(fragment.selector),
            `${spec.facetName}.${fragment.format("sighash")}`
        ).to.equal(facetAddress);
    }
}

/**
 * Asserts the excluded functions really are off the diamond surface: they fall
 * through to the consumer facet like any unknown selector.
 */
export async function expectFacetSelectorsNotRouted(
    diamond: StateChannelManagerInterface,
    spec: FacetRoutingSpec,
    consumerFacetAddress: string
): Promise<void> {
    for (const fragment of functionFragments(spec.abi)) {
        const reason = spec.notRouted[fragment.name];
        if (reason === undefined) continue;
        expect(
            await diamond.facetAddressForSelector(fragment.selector),
            `${spec.facetName}.${fragment.format("sighash")} (${reason})`
        ).to.equal(consumerFacetAddress);
    }
}

/** Functions the proxy implements itself - they dispatch before the fallback. */
export function proxyOwnedFunctions(): DiamondFunction[] {
    return functionFragments(
        StateChannelManagerProxy__factory.abi as InterfaceAbi
    ).map((fragment) => ({
        implementorName: "StateChannelManagerProxy",
        fragment
    }));
}

/** Facet functions the fallback routes: every facet function the spec doesn't exclude. */
export function routedFacetFunctions(): DiamondFunction[] {
    return facetRoutingSpecs.flatMap((spec) =>
        functionFragments(spec.abi)
            .filter((fragment) => !(fragment.name in spec.notRouted))
            .map((fragment) => ({
                implementorName: spec.facetName,
                fragment
            }))
    );
}

/** The declarations on `StateChannelManagerInterface`, the caller-side typing artifact. */
export function interfaceFunctions(): FunctionFragment[] {
    return functionFragments(
        StateChannelManagerInterface__factory.abi as InterfaceAbi
    );
}

/** Every function callable on the deployed diamond: proxy-owned plus routed. */
export function diamondCallableFunctions(): Map<Selector, DiamondFunction> {
    return new Map(
        [...proxyOwnedFunctions(), ...routedFacetFunctions()].map(
            (callable) => [callable.fragment.selector, callable]
        )
    );
}

/**
 * Routed facet functions whose selector the proxy also implements itself. The
 * proxy body dispatches before the fallback, so such a routed function is
 * unreachable even though `facetAddressForSelector` still names its facet.
 */
export function proxyShadowedRoutedFunctions(): DiamondFunction[] {
    const proxySelectors = new Set(
        proxyOwnedFunctions().map((callable) => callable.fragment.selector)
    );
    return routedFacetFunctions().filter((callable) =>
        proxySelectors.has(callable.fragment.selector)
    );
}

/** `implementor.signature`, the label failures identify a callable function by. */
export function diamondFunctionLabel(callable: DiamondFunction): string {
    return `${callable.implementorName}.${callable.fragment.format("sighash")}`;
}

/** Selectors defined by more than one facet ABI, as `selector -> facet names`. */
export function facetSelectorCollisions(): Map<string, string[]> {
    const owners = new Map<string, string[]>();
    for (const spec of facetRoutingSpecs) {
        for (const fragment of functionFragments(spec.abi)) {
            owners.set(fragment.selector, [
                ...(owners.get(fragment.selector) ?? []),
                spec.facetName
            ]);
        }
    }
    return new Map([...owners].filter(([, facets]) => facets.length > 1));
}
