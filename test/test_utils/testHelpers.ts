// @spec-test-coverage-ignore: shared deployment helpers for test files; declares no runnable case, so no specification or implementation IDs apply
import { ethers, AddressLike } from "ethers";
import { HardhatEthersHelpers } from "hardhat/types/runtime";
import {
    StateChannelManagerInterface,
    StateChannelManagerInterface__factory,
    MathStateMachine
} from "@typechain-types";

import {
    JoinChannelStruct,
    OpenChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { hash } from "@/utils";

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

export async function deployMathChannelProxyFixture(
    _ethers: typeof ethers & HardhatEthersHelpers
): Promise<{
    mathChannelManager: StateChannelManagerInterface;
    mathInstance: MathStateMachine;
    facetAddresses: DeployedFacetAddresses;
    consumerFacetAddress: string;
}> {
    // Facet configurations in constructor order
    const facetConfigs = [
        { name: "DisputeManagerFacet" },
        { name: "DisputeVerificationFacet" },
        { name: "FraudProofFacet" },
        { name: "DisputeFraudProofFacet" },
        { name: "StateSnapshotFacet" },
        { name: "JoinChannelFacet" },
        { name: "StateProofFacet" },
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

    const mathConsumerFactory =
        await _ethers.getContractFactory("MathConsumerFacet");
    const mathConsumerFacet = await mathConsumerFactory.deploy();

    //State machine logic
    const mathSmFactory = await _ethers.getContractFactory("MathStateMachine");
    const mathContactInstance = await mathSmFactory.deploy(500000);

    //Deploy MathStateChannelManager with all facet addresses
    const mathSmcFactory = await _ethers.getContractFactory(
        "StateChannelManagerProxy"
    );
    const mathStateChannelContactInstance = await mathSmcFactory.deploy(
        await mathContactInstance.getAddress(),
        ...facetAddresses,
        await mathConsumerFacet.getAddress(),
        0,
        0,
        0,
        0,
        0
    );

    // The proxy only implements a handful of selectors itself and routes the
    // rest to facets, so bind the diamond's full surface at its address.
    return {
        mathChannelManager: StateChannelManagerInterface__factory.connect(
            await mathStateChannelContactInstance.getAddress(),
            mathStateChannelContactInstance.runner
        ),
        mathInstance: mathContactInstance,
        facetAddresses: Object.fromEntries(
            facetConfigs.map((config, index) => [
                config.name,
                facetAddresses[index]
            ])
        ),
        consumerFacetAddress: await mathConsumerFacet.getAddress()
    };
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
