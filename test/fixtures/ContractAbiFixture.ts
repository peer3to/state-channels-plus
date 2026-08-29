// @spec-test-coverage-ignore: shared ABI assertions; executable evidence is mapped from the owning unit tests
import { ethers, Fragment, InterfaceAbi } from "ethers";
import { fragmentKey } from "@/utils/contractAbi";
import { errorAbis } from "@/utils/GeneratedArtifacts";

export function abiFragments(abi: InterfaceAbi): readonly Fragment[] {
    return ethers.Interface.from(abi).fragments;
}

export function fragmentKeys(abi: InterfaceAbi): string[] {
    return abiFragments(abi).map(fragmentKey);
}

export function fragmentKeysOfType(
    abi: InterfaceAbi,
    type: Fragment["type"]
): string[] {
    return abiFragments(abi)
        .filter((fragment) => fragment.type === type)
        .map(fragmentKey)
        .sort();
}

export function duplicateFragmentKeys(abi: InterfaceAbi): string[] {
    const keys = fragmentKeys(abi);
    return keys.filter((key, index) => keys.indexOf(key) !== index);
}

export function expectedManagerErrorKeys(): string[] {
    return [...new Set(fragmentKeys(errorAbis as InterfaceAbi))].sort();
}

export function expectCompleteFragmentKeys(
    actual: InterfaceAbi,
    expected: InterfaceAbi
): { actual: string[]; expected: string[] } {
    return {
        actual: [...fragmentKeys(actual)].sort(),
        expected: [...fragmentKeys(expected)].sort()
    };
}
