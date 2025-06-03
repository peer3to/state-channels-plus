import { ethers } from "hardhat";
import path from "path";
import { Wallet, NonceManager, Signer } from "ethers";
import { DeployUtils, config } from "@peer3/state-channels-plus";
import {
    TicTacToeStateChannelManagerProxy,
    TicTacToeStateMachine
} from "../../../typechain-types";

const getRandomSigner = () => {
    let randomSinger: Signer = Wallet.createRandom(
        new ethers.JsonRpcProvider(config.PROVIDER_URL)
    );

    randomSinger = new NonceManager(randomSinger);
    return randomSinger;
};
export async function deployTicTacToe(): Promise<
    [TicTacToeStateChannelManagerProxy, TicTacToeStateMachine]
> {
    let randomSinger = getRandomSigner();
    let contractsJSONpath = path.resolve(__dirname, "../contracts.json");
    const deployUtils = new DeployUtils(contractsJSONpath);

    console.log("Provider url:", config.PROVIDER_URL);

    //Deploy library
    let stateChannelUtilLibraryFactory = await ethers.getContractFactory(
        "StateChannelUtilLibrary"
    );
    stateChannelUtilLibraryFactory =
        stateChannelUtilLibraryFactory.connect(randomSinger);
    let stateChannelUtilLibrary = await deployUtils.deployAsync(
        stateChannelUtilLibraryFactory,
        "StateChannelUtilLibrary"
    );
    let libraryAddress = await stateChannelUtilLibrary.getAddress();
    console.log("Deployed StateChannelUtilLibrary at ", libraryAddress);

    //Deploy DisputeManagerFacet
    let disputeManagerFacetFactory = await ethers.getContractFactory(
        "DisputeManagerFacet",
        { libraries: { StateChannelUtilLibrary: libraryAddress } }
    );
    disputeManagerFacetFactory =
        disputeManagerFacetFactory.connect(randomSinger);
    let disputeManagerFacet = await deployUtils.deployAsync(
        disputeManagerFacetFactory,
        "DisputeManagerFacet"
    );
    let disputeManagerFacetAddress = await disputeManagerFacet.getAddress();
    console.log("Deployed DisputeManagerFacet at ", disputeManagerFacetAddress);

    //State machine logic
    let TicTacToeSmFactory = await ethers.getContractFactory(
        "TicTacToeStateMachine"
    );
    TicTacToeSmFactory = TicTacToeSmFactory.connect(randomSinger);
    // let mathContactInstance = await mathSmFactory.deploy();
    let TicTacToeContactInstance = await deployUtils.deployAsync(
        TicTacToeSmFactory,
        "TicTacToeStateMachine"
    );
    console.log(
        "Deployed TicTacToeStateMachine at ",
        await TicTacToeContactInstance.getAddress()
    );

    //Deploy MathStateChannelManager
    let TicTacToeSmcFactory = await ethers.getContractFactory(
        "TicTacToeStateChannelManagerProxy",
        { libraries: { StateChannelUtilLibrary: libraryAddress } }
    );
    TicTacToeSmcFactory = TicTacToeSmcFactory.connect(randomSinger);
    // let mathStateChannelContactInstance = await mathSmcFactory.deploy(
    //     await mathContactInstance.getAddress()
    // );

    let TicTacToeStateChannelContactInstance = await deployUtils.deployAsync(
        TicTacToeSmcFactory,
        "TicTacToeStateChannelManagerProxy",
        [
            await TicTacToeContactInstance.getAddress(),
            disputeManagerFacetAddress
        ]
    );
    console.log(
        "Deployed TicTacToeStateChannelManagerProxy at ",
        await TicTacToeStateChannelContactInstance.getAddress()
    );
    // await new Promise((resolve) => setTimeout(resolve, 20000));
    // console.log("This is needed so the block is mined and the contract is deployed");
    // console.log(
    //     "TIME - ",
    //     await TicTacToeStateChannelContactInstance.getAllTimes()
    // );
    return [TicTacToeStateChannelContactInstance, TicTacToeContactInstance];
}

deployTicTacToe()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
