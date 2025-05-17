import { ethers, ContractTransactionResponse, AddressLike } from "ethers";
import { HardhatEthersHelpers } from "hardhat/types/runtime";
import {
    MathStateChannelManagerProxy,
    MathStateMachine,
    StateChannelUtilLibrary
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
        amount: 500,
        deadlineTimestamp: currentTime + 120, // 2 minutes from now
        data: "0x00"
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

    //Deploy DisputeManagerFacet
    let disputeManagerFacetFactory = await _ethers.getContractFactory(
        "DisputeManagerFacet",
        { libraries: { StateChannelUtilLibrary: libraryAddress } }
    );
    // Deploy FraudProofVerification facet
    let fraudProofFacetFactory = await _ethers.getContractFactory(
        "FraudProofFacet",
        { libraries: { StateChannelUtilLibrary: libraryAddress } }
    );

    let disputeManagerFacet = await disputeManagerFacetFactory.deploy();
    let disputeManagerFacetAddress = await disputeManagerFacet.getAddress();

    let fraudProofFacet = await fraudProofFacetFactory.deploy();
    let fraudProofFacetAddress = await fraudProofFacet.getAddress();
    //State machine logic
    let mathSmFactory = await _ethers.getContractFactory("MathStateMachine");
    let mathContactInstance = await mathSmFactory.deploy();

    //Deploy StateSnapshotFacet
    let stateSnapshotFacetFactory =
        await _ethers.getContractFactory("StateSnapshotFacet");
    let stateSnapshotFacet = await stateSnapshotFacetFactory.deploy();
    let stateSnapshotFacetAddress = await stateSnapshotFacet.getAddress();

    //Deploy MathStateChannelManager
    let mathSmcFactory = await _ethers.getContractFactory(
        "MathStateChannelManagerProxy",
        { libraries: { StateChannelUtilLibrary: libraryAddress } }
    );
    let mathStateChannelContactInstance = await mathSmcFactory.deploy(
        await mathContactInstance.getAddress(),
        disputeManagerFacetAddress,
        fraudProofFacetAddress,
        stateSnapshotFacetAddress
    );

    return {
        mathChannelManager: mathStateChannelContactInstance,
        mathInstance: mathContactInstance
    };
}
export async function getMathDeploymentTransaction(
    _ethers: typeof ethers & HardhatEthersHelpers
) {
    const MathStateMachineFactory =
        await _ethers.getContractFactory("MathStateMachine");
    return await MathStateMachineFactory.getDeployTransaction();
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
