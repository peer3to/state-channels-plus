import { mergeAbis } from "@/utils/contractAbi";
import { isLocalEvmExecutionFailure } from "@/utils/evmErrorHandler";
import { stateChannelManagerAbi } from "@/utils/stateChannelManager";
import {
    LocalDiamond,
    LocalDiamond__factory,
    StateChannelManagerInterface
} from "@typechain-types";
import { ContractRunner, ethers, Fragment, InterfaceAbi } from "ethers";

/**
 * The deployed local diamond as callers see it: `LocalDiamond`'s own local-only
 * surface plus every selector `StateChannelManagerProxy` routes to a facet.
 * The routed selectors are not in `LocalDiamond`'s own ABI - they are served by
 * the proxy fallback - so both ABIs are needed to reach the whole contract.
 */
export type LocalDiamondContract = LocalDiamond & StateChannelManagerInterface;

/** ABI covering both the local diamond's own functions and the routed ones. */
export const localDiamondAbi: Fragment[] = mergeAbis(
    LocalDiamond__factory.abi as InterfaceAbi,
    stateChannelManagerAbi
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

/**
 * Run a read on the local diamond and keep its answer when `acceptLocal`
 * allows it; otherwise, or when the local EVM reverts, the chain answers.
 * The local diamond mirrors the chain through the event pipeline and can lag
 * it, so a caller accepts locally only the answer that is safe to act on
 * without confirmation. Errors other than a revert are not a lagging mirror
 * and propagate.
 */
export async function preferLocal<T>(
    local: () => Promise<T>,
    onChain: () => Promise<T>,
    acceptLocal: (answer: T) => boolean
): Promise<T> {
    try {
        const answer = await local();
        if (acceptLocal(answer)) return answer;
    } catch (error) {
        if (!isLocalEvmExecutionFailure(error)) throw error;
    }
    return onChain();
}
