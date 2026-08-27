import {
    ContractRunner,
    ErrorFragment,
    ethers,
    EventFragment,
    Fragment,
    FunctionFragment,
    InterfaceAbi
} from "ethers";
import {
    LocalDiamond,
    LocalDiamond__factory,
    StateChannelManagerInterface,
    StateChannelManagerInterface__factory
} from "@typechain-types";

/**
 * The deployed local diamond as callers see it: `LocalDiamond`'s own local-only
 * surface plus every selector `StateChannelManagerProxy` routes to a facet.
 * The routed selectors are not in `LocalDiamond`'s own ABI - they are served by
 * the proxy fallback - so both ABIs are needed to reach the whole contract.
 */
export type LocalDiamondContract = LocalDiamond & StateChannelManagerInterface;

/** `type:signature` of an ABI fragment - identity for de-duplication. */
type FragmentKey = string;

function fragmentKey(fragment: Fragment): FragmentKey {
    if (
        fragment instanceof FunctionFragment ||
        fragment instanceof EventFragment ||
        fragment instanceof ErrorFragment
    ) {
        return `${fragment.type}:${fragment.format("sighash")}`;
    }
    // constructor/fallback/receive have no signature and appear at most once
    return fragment.type;
}

function mergeAbis(...abis: InterfaceAbi[]): Fragment[] {
    const merged = new Map<FragmentKey, Fragment>();
    for (const abi of abis) {
        for (const fragment of ethers.Interface.from(abi).fragments) {
            const key = fragmentKey(fragment);
            if (!merged.has(key)) merged.set(key, fragment);
        }
    }
    return [...merged.values()];
}

/** ABI covering both the local diamond's own functions and the routed ones. */
export const localDiamondAbi: Fragment[] = mergeAbis(
    LocalDiamond__factory.abi as InterfaceAbi,
    StateChannelManagerInterface__factory.abi as InterfaceAbi
);

export function connectLocalDiamond(
    address: string,
    runner: ContractRunner | null
): LocalDiamondContract {
    return new ethers.Contract(
        address,
        localDiamondAbi,
        runner
    ) as unknown as LocalDiamondContract;
}
