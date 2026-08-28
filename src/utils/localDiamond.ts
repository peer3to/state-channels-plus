import { ContractRunner, ethers, Fragment, InterfaceAbi } from "ethers";
import {
    LocalDiamond,
    LocalDiamond__factory,
    StateChannelManagerInterface
} from "@typechain-types";
import { mergeAbis } from "@/utils/contractAbi";
import { stateChannelManagerAbi } from "@/utils/stateChannelManager";

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
