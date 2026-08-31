import { ContractRunner, ethers, Fragment, InterfaceAbi } from "ethers";
import {
    StateChannelManagerInterface,
    StateChannelManagerInterface__factory
} from "@typechain-types";
import { errorAbis } from "@/utils/GeneratedArtifacts";
import { mergeAbis } from "@/utils/contractAbi";

/** Public manager ABI: interface calls/events plus every reachable custom error. */
export const stateChannelManagerAbi: Fragment[] = mergeAbis(
    StateChannelManagerInterface__factory.abi as InterfaceAbi,
    errorAbis as InterfaceAbi
);

/** SDK-owned manager fragments first, followed by consumer-only extensions. */
export function mergeStateChannelManagerAbi(
    consumerAbi?: InterfaceAbi
): Fragment[] {
    return consumerAbi
        ? mergeAbis(stateChannelManagerAbi, consumerAbi)
        : stateChannelManagerAbi;
}

export function connectStateChannelManager(
    address: string,
    runner: ContractRunner | null,
    consumerAbi?: InterfaceAbi
): StateChannelManagerInterface {
    return new ethers.Contract(
        address,
        mergeStateChannelManagerAbi(consumerAbi),
        runner
    ) as unknown as StateChannelManagerInterface;
}
