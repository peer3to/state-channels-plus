import MultiRpcProvider from "./MultiRpcProvider";
import type { LocalDiamondContract } from "@/utils/localDiamond";
import type { StateChannelManagerInterface } from "@typechain-types";
import type { BaseContract } from "ethers";

/**
 * Whether `contract`'s reads are answered now from chain state the serving
 * RPC node proved (the light client is on): the local diamond's copy of that
 * state then adds nothing.
 */
export async function isChainProven(contract: BaseContract): Promise<boolean> {
    const provider = contract.runner?.provider;
    return (
        provider instanceof MultiRpcProvider &&
        (await provider.answersFromProvenState())
    );
}

/**
 * Where to read chain state the local diamond replicates: the chain while
 * its answers are proven, which also sees what the event pipeline has not
 * applied yet, otherwise the local diamond's copy.
 */
export async function replicatedStateSource(
    localDiamond: LocalDiamondContract,
    chain: StateChannelManagerInterface
): Promise<StateChannelManagerInterface> {
    return (await isChainProven(chain)) ? chain : localDiamond;
}
