import { ethers, ContractTransactionResponse, AddressLike } from "ethers";
import { HardhatEthersHelpers } from "hardhat/types/runtime";
import {
    MathStateChannelManagerProxy,
    MathStateMachine,
    StateChannelUtilLibrary
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
    let jc: JoinChannelStruct = {
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

export async function deployLibraryTestContract(
    _ethers: typeof ethers & HardhatEthersHelpers
): Promise<StateChannelUtilLibrary> {
    //Deploy library
    let stateChannelUtilLibraryFactory = await _ethers.getContractFactory(
        "StateChannelUtilLibrary"
    );
    let stateChannelUtilLibrary = await stateChannelUtilLibraryFactory.deploy();
    let libraryAddress = await stateChannelUtilLibrary.getAddress();

    //Deploy DisputeManagerFacet
    let libraryTestContractFactory = await _ethers.getContractFactory(
        "LibraryTestContract"
    );
    let libraryTestContract =
        await libraryTestContractFactory.deploy(libraryAddress);
    let proxy = stateChannelUtilLibraryFactory.attach(
        await libraryTestContract.getAddress()
    );
    return proxy as StateChannelUtilLibrary;
}
export async function deployMathChannelProxyFixture(
    _ethers: typeof ethers & HardhatEthersHelpers
): Promise<{
    mathChannelManager: MathStateChannelManagerProxy & {
        deploymentTransaction(): ContractTransactionResponse;
    };
    mathInstance: MathStateMachine;
}> {
    //Deploy library
    let stateChannelUtilLibraryFactory = await _ethers.getContractFactory(
        "StateChannelUtilLibrary"
    );
    let stateChannelUtilLibrary = await stateChannelUtilLibraryFactory.deploy();
    let libraryAddress = await stateChannelUtilLibrary.getAddress();

    const libs = { StateChannelUtilLibrary: libraryAddress };

    // Facet configurations in constructor order
    const facetConfigs = [
        { name: "DisputeManagerFacet", libs },
        { name: "DisputeVerificationFacet", libs },
        { name: "FraudProofFacet", libs },
        { name: "DisputeFraudProofFacet", libs },
        { name: "StateSnapshotFacet", libs: undefined },
        { name: "JoinChannelFacet", libs },
        { name: "MathConsumerFacet", libs }
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
    let mathSmFactory = await _ethers.getContractFactory("MathStateMachine");
    let mathContactInstance = await mathSmFactory.deploy(500000);

    //Deploy MathStateChannelManager with all facet addresses
    let mathSmcFactory = await _ethers.getContractFactory(
        "MathStateChannelManagerProxy"
    );
    let mathStateChannelContactInstance = await mathSmcFactory.deploy(
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
    let hooks: P2pEventHooks = {
        onTurn(address: AddressLike): void {
            (address as string) == myAddress && onTurnCallback();
        }
    };
    return hooks;
}
export async function getSigners(
    _ethers: typeof ethers & HardhatEthersHelpers
) {
    const signers = await _ethers.getSigners();
    let firstSigner = signers[0];
    let secondSigner = signers[1];
    let thirdSigner = signers[2];
    return { firstSigner, secondSigner, thirdSigner, signers };
}
