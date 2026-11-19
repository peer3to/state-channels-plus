import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import {
    DEFAULT_MAX_CHANNEL_PARTICIPANTS,
    deploy,
    deployArtifact,
    deployFacets
} from "../../scripts/V1/deploy";
// @spec-test-coverage-ignore: shared deployment helpers for test files; declares no runnable case, so no specification or implementation IDs apply
import Clock from "@/Clock";
import { hash } from "@/utils";
import { routedFacets } from "@/utils/routedFacets";
import {
    StateChannelManagerInterface,
    MathStateMachine,
    MathStateMachine__factory
} from "@typechain-types";
import {
    JoinChannelStruct,
    OpenChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers, AddressLike, type Signer } from "ethers";
import { HardhatEthersHelpers } from "hardhat/types/runtime";

export type TestObjectOptions = {
    channelId?: string;
    initialBalance?: number;
};

export const createJoinChannelTestObject = (
    address: AddressLike,
    channelId?: string
): JoinChannelStruct => {
    let currentTime = 0;
    try {
        currentTime = Clock.getTimeInSeconds();
    } catch {
        currentTime = Math.floor(Date.now() / 1000);
    }
    const jc: JoinChannelStruct = {
        participant: address,
        channelId: channelId
            ? ethers.keccak256(
                  ethers.AbiCoder.defaultAbiCoder().encode(
                      ["string"],
                      [channelId]
                  )
              )
            : ethers.keccak256("0x2371"),
        balance: {
            amount: 500,
            data: "0x00"
        },
        deadlineTimestamp: currentTime + 120 // 2 minutes from now
    };
    return jc;
};

export const createOpenChannelTestObject = (
    participants: AddressLike[],
    options?: TestObjectOptions
): OpenChannelStruct => {
    const { channelId, initialBalance } = options ?? {};
    let currentTime = 0;
    try {
        currentTime = Clock.getTimeInSeconds();
    } catch {
        currentTime = Math.floor(Date.now() / 1000);
    }

    const balances = participants.map(() => ({
        amount: initialBalance === undefined ? 500 : initialBalance,
        data: "0x00"
    }));

    const oc: OpenChannelStruct = {
        channelId: channelId
            ? hash(
                  ethers.AbiCoder.defaultAbiCoder().encode(
                      ["string"],
                      [channelId]
                  )
              )
            : hash("0x2371"),
        participants: participants,
        balances: balances,
        deadlineTimestamp: currentTime + 120, // 2 minutes from now
        isAtomic: true,
        data: "0x00"
    };
    return oc;
};

/** Facet contract name -> deployed address of that facet behind the diamond. */
export type DeployedFacetAddresses = Record<string, string>;

/**
 * A fresh math stack on the deployer's chain: the routed facets, the math
 * consumer facet and state machine, and a proxy given 0 for every time window
 * and limit (the contract defaults), bound to the deployer. Sends one at a time after the facets, so
 * the deployer's pending nonce stays right on any node.
 */
export async function deployMathChannelProxyFixture(deployer: Signer): Promise<{
    mathChannelManager: StateChannelManagerInterface;
    mathInstance: MathStateMachine;
    facetAddresses: DeployedFacetAddresses;
    consumerFacetAddress: string;
}> {
    const facetAddresses = await deployFacets(deployer);
    const { address: consumerFacetAddress } = await deployArtifact(
        MathConsumerFacetArtifact,
        deployer
    );
    const { address: stateMachineAddress } = await deployArtifact(
        MathStateMachineArtifact,
        deployer,
        { args: [500000, DEFAULT_MAX_CHANNEL_PARTICIPANTS] }
    );
    const { contract } = await deploy(
        stateMachineAddress,
        consumerFacetAddress,
        deployer,
        { p2pTime: 0, agreementTime: 0, chainFallbackTime: 0, evidenceTime: 0 },
        0,
        0,
        facetAddresses
    );

    return {
        mathChannelManager: contract,
        mathInstance: MathStateMachine__factory.connect(
            stateMachineAddress,
            deployer
        ),
        facetAddresses: Object.fromEntries(
            routedFacets.map((config, index) => [
                config.facetName,
                facetAddresses[index]
            ])
        ),
        consumerFacetAddress
    };
}

export async function deployUtilityFacetTestContract(
    _ethers: typeof ethers & HardhatEthersHelpers
) {
    const UtilityFacetFactory =
        await _ethers.getContractFactory("UtilityFacet");
    return await UtilityFacetFactory.deploy();
}
