import { ethers, ContractTransactionResponse, AddressLike } from "ethers";
import { HardhatEthersHelpers } from "hardhat/types/runtime";
import {
    DisputeManagerFacet,
    DisputeManagerFacetTest,
    FraudProofFacet,
    MathStateChannelManagerProxy,
    MathStateMachine,
    StateChannelUtilLibrary,
    StateSnapshotFacet
} from "@typechain-types";

import { JoinChannelStruct } from "@typechain-types/contracts/V1/DataTypes";
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

    //Deploy LibraryTestContract
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

// ---------------------- Deployment of individual contracts ----------------------
export async function deployStateChannelUtilLibrary(
    _ethers: typeof ethers & HardhatEthersHelpers
): Promise<{
    libraryUtilContract: StateChannelUtilLibrary;
    libraryUtilContractAddress: string;
}> {
    let libraryUtilContractFactory = await _ethers.getContractFactory(
        "StateChannelUtilLibrary"
    );
    let libraryUtilContract = await libraryUtilContractFactory.deploy();
    return {
        libraryUtilContract,
        libraryUtilContractAddress: await libraryUtilContract.getAddress()
    };
}

export async function deployDisputeManagerFacetTest(
    _ethers: typeof ethers & HardhatEthersHelpers,
    libraryUtilContractAddress: string
): Promise<{
    disputeManagerFacetTest: DisputeManagerFacetTest;
    disputeManagerFacetTestAddress: string;
}> {
    let disputeManagerFacetTestFactory = await _ethers.getContractFactory(
        "DisputeManagerFacetTest",
        { libraries: { StateChannelUtilLibrary: libraryUtilContractAddress } }
    );
    let disputeManagerFacetTest = await disputeManagerFacetTestFactory.deploy();
    return {
        disputeManagerFacetTest,
        disputeManagerFacetTestAddress: await disputeManagerFacetTest.getAddress()
    };
}

export async function deployDisputeManagerFacet(
    _ethers: typeof ethers & HardhatEthersHelpers,
    libraryUtilContractAddress: string
): Promise<{
    disputeManagerFacet: DisputeManagerFacet;
    disputeManagerFacetAddress: string;
}> {
    let disputeManagerFacetFactory = await _ethers.getContractFactory(
        "DisputeManagerFacet",
        { libraries: { StateChannelUtilLibrary: libraryUtilContractAddress } }
    );
    let disputeManagerFacet = await disputeManagerFacetFactory.deploy();
    let disputeManagerFacetAddress = await disputeManagerFacet.getAddress();
    return {
        disputeManagerFacet,
        disputeManagerFacetAddress
    };
}

export async function deployFraudProofFacet(
    _ethers: typeof ethers & HardhatEthersHelpers,
    libraryUtilContractAddress: string
): Promise<{
    fraudProofFacet: FraudProofFacet;
    fraudProofFacetAddress: string;
}> {
    let fraudProofFacetFactory = await _ethers.getContractFactory(
        "FraudProofFacet",
        { libraries: { StateChannelUtilLibrary: libraryUtilContractAddress } }
    );
    let fraudProofFacet = await fraudProofFacetFactory.deploy();
    return {
        fraudProofFacet,
        fraudProofFacetAddress: await fraudProofFacet.getAddress()
    };
}

export async function deployStateSnapshotFacet(
    _ethers: typeof ethers & HardhatEthersHelpers,
    libraryUtilContractAddress: string
): Promise<{
    stateSnapshotFacet: StateSnapshotFacet;
    stateSnapshotFacetAddress: string;
}> {
    let stateSnapshotFacetFactory = await _ethers.getContractFactory(
        "StateSnapshotFacet",
        { libraries: { StateChannelUtilLibrary: libraryUtilContractAddress } }
    );
    let stateSnapshotFacet = await stateSnapshotFacetFactory.deploy();
    return {
        stateSnapshotFacet,
        stateSnapshotFacetAddress: await stateSnapshotFacet.getAddress()
    };
}



export async function deployMathChannelProxyFixture(
    _ethers: typeof ethers & HardhatEthersHelpers
): Promise<{
    mathChannelManager: MathStateChannelManagerProxy & {
        deploymentTransaction(): ContractTransactionResponse;
    };
    mathInstance: MathStateMachine;
}> {
    const libraryUtilContract = await deployStateChannelUtilLibrary(_ethers);
   
    //Deploy DisputeManagerFacet
    const disputeManagerFacet = await deployDisputeManagerFacet(_ethers, libraryUtilContract.libraryUtilContractAddress);

    //Deploy FraudProofFacet
    const fraudProofFacet = await deployFraudProofFacet(_ethers, libraryUtilContract.libraryUtilContractAddress);

    //Deploy StateSnapshotFacet
    const stateSnapshotFacet = await deployStateSnapshotFacet(_ethers, libraryUtilContract.libraryUtilContractAddress);

    //State machine logic
    let mathSmFactory = await _ethers.getContractFactory("MathStateMachine");
    let mathContactInstance = await mathSmFactory.deploy(500000);

    //Deploy MathStateChannelManager
    let mathSmcFactory = await _ethers.getContractFactory(
        "MathStateChannelManagerProxy",
        { libraries: { StateChannelUtilLibrary: libraryUtilContract.libraryUtilContractAddress } }
    );
    let mathStateChannelContactInstance = await mathSmcFactory.deploy(
        await mathContactInstance.getAddress(),
        disputeManagerFacet.disputeManagerFacetAddress,
        fraudProofFacet.fraudProofFacetAddress,
        stateSnapshotFacet.stateSnapshotFacetAddress
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
        onTurn(address: string): void {
            address == myAddress && onTurnCallback();
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
