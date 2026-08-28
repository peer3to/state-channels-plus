import {
    ErrorFragment,
    ethers,
    EventFragment,
    Fragment,
    FunctionFragment,
    InterfaceAbi
} from "ethers";

export type FragmentKey = string;

/** Stable identity used to compare and de-duplicate ABI fragments. */
export function fragmentKey(fragment: Fragment): FragmentKey {
    if (
        fragment instanceof FunctionFragment ||
        fragment instanceof EventFragment ||
        fragment instanceof ErrorFragment
    ) {
        return `${fragment.type}:${fragment.format("sighash")}`;
    }
    return fragment.type;
}

/** Merges ABIs in order. The first definition of a fragment identity wins. */
export function mergeAbis(...abis: InterfaceAbi[]): Fragment[] {
    const merged = new Map<FragmentKey, Fragment>();
    for (const abi of abis) {
        for (const fragment of ethers.Interface.from(abi).fragments) {
            const key = fragmentKey(fragment);
            if (!merged.has(key)) merged.set(key, fragment);
        }
    }
    return [...merged.values()];
}
