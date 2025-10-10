import { ethers, ContractTransactionResponse, AddressLike } from "ethers";
import { HardhatEthersHelpers } from "hardhat/types/runtime";
import {
    MathStateChannelManagerProxy,
    MathStateMachine
} from "@typechain-types";

import { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import P2pEventHooks from "@/P2pEventHooks";

export const createJoinChannelTestObject = (
    address: AddressLike,
    channelId?: string
): JoinChannelStruct => {
    let currentTime = 0;
    try {
        currentTime = Clock.getTimeInSeconds();
    } catch (e) {
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

export const getCurrentBlockTime = async (
    provider: ethers.Provider
): Promise<number> => {
    const block = await provider.getBlock("latest");
    return block!.timestamp;
};
export const getCurrentTimeSeconds = (): number => {
    return Math.floor(Date.now() / 1000);
};

export async function deployMathChannelProxyFixture(
    _ethers: typeof ethers & HardhatEthersHelpers
): Promise<{
    mathChannelManager: MathStateChannelManagerProxy & {
        deploymentTransaction(): ContractTransactionResponse;
    };
    mathInstance: MathStateMachine;
}> {
    // Facet configurations in constructor order
    const facetConfigs = [
        { name: "DisputeManagerFacet" },
        { name: "DisputeVerificationFacet" },
        { name: "FraudProofFacet" },
        { name: "DisputeFraudProofFacet" },
        { name: "StateSnapshotFacet" },
        { name: "JoinChannelFacet" },
        { name: "MathConsumerFacet" },
        { name: "UtilityFacet" }
    ] as const;

    // the generic are here in order to make the spread operator in mathSmcFactory.deploy work
    // typescipt needs to know the keys and the order of the array
    async function deployFacets<T extends readonly any[]>(
        configs: T
    ): Promise<{ [K in keyof T]: string }> {
        const addresses = await Promise.all(
            configs.map(async (config) => {
                const factory = await _ethers.getContractFactory(config.name, {
                    libraries: config.libs
                });
                const facet = await factory.deploy();
                return await facet.getAddress();
            })
        );
        return addresses as { [K in keyof T]: string };
    }

    // Deploy all facets in parallel and get addresses in order
    const facetAddresses = await deployFacets(facetConfigs);

    //State machine logic
    const mathSmFactory = await _ethers.getContractFactory("MathStateMachine");
    const mathContactInstance = await mathSmFactory.deploy(500000);

    //Deploy MathStateChannelManager with all facet addresses
    const mathSmcFactory = await _ethers.getContractFactory(
        "MathStateChannelManagerProxy"
    );
    const mathStateChannelContactInstance = await mathSmcFactory.deploy(
        await mathContactInstance.getAddress(),
        ...facetAddresses
    );

    return {
        mathChannelManager: mathStateChannelContactInstance,
        mathInstance: mathContactInstance
    };
}
export async function getMathDeploymentTransaction(
    _ethers: typeof ethers & HardhatEthersHelpers,
    gasLimit: number = 500000
) {
    const MathStateMachineFactory =
        await _ethers.getContractFactory("MathStateMachine");
    return await MathStateMachineFactory.getDeployTransaction(gasLimit);
}

export function getMathP2pEventHooks(
    onTurnCallback: () => void,
    myAddress: string
) {
    const hooks: P2pEventHooks = {
        onTurn(address: AddressLike): void {
            (address as string) == myAddress && onTurnCallback();
        }
    };
    return hooks;
}
export async function deployUtilityFacetTestContract(
    _ethers: typeof ethers & HardhatEthersHelpers
) {
    const UtilityFacetFactory =
        await _ethers.getContractFactory("UtilityFacet");
    return await UtilityFacetFactory.deploy();
}

export async function getSigners(
    _ethers: typeof ethers & HardhatEthersHelpers
) {
    const signers = await _ethers.getSigners();
    const firstSigner = signers[0];
    const secondSigner = signers[1];
    const thirdSigner = signers[2];
    return { firstSigner, secondSigner, thirdSigner, signers };
}
