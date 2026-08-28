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

export function connectStateChannelManager(
    address: string,
    runner: ContractRunner | null
): StateChannelManagerInterface {
    return new ethers.Contract(
        address,
        stateChannelManagerAbi,
        runner
    ) as unknown as StateChannelManagerInterface;
}
