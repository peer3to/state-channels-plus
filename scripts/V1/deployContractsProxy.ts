import { ethers } from "hardhat";
import { Wallet, NonceManager, Signer } from "ethers";
import { DeployUtils } from "@/utils";
import { PROVIDER_URL } from "@/utils/config";

const getRandomSigner = () => {
    let randomSinger: Signer = Wallet.createRandom(
        new ethers.JsonRpcProvider(PROVIDER_URL)
    );
    randomSinger = new NonceManager(randomSinger);
    return randomSinger;
};
async function main() {
    let randomSinger = getRandomSigner();
    const deployUtils = new DeployUtils();
    console.log("Provider url:", PROVIDER_URL);

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

    //Deploy DisputeVerificationFacet
    let disputeVerificationFacetFactory = await ethers.getContractFactory(
        "DisputeVerificationFacet",
        { libraries: { StateChannelUtilLibrary: libraryAddress } }
    );
    disputeVerificationFacetFactory =
        disputeVerificationFacetFactory.connect(randomSinger);
    let disputeVerificationFacet = await deployUtils.deployAsync(
        disputeVerificationFacetFactory,
        "DisputeVerificationFacet"
    );
    let disputeVerificationFacetAddress =
        await disputeVerificationFacet.getAddress();
    console.log(
        "Deployed DisputeVerificationFacet at ",
        disputeVerificationFacetAddress
    );

    //State machine logic
    let mathSmFactory = await ethers.getContractFactory("MathStateMachine");
    mathSmFactory = mathSmFactory.connect(randomSinger);
    // let mathContactInstance = await mathSmFactory.deploy();
    let mathContactInstance = await deployUtils.deployAsync(
        mathSmFactory,
        "MathStateMachine"
    );
    console.log(
        "Deployed MathStateMachine at ",
        await mathContactInstance.getAddress()
    );

    //Deploy MathStateChannelManager
    let mathSmcFactory = await ethers.getContractFactory(
        "MathStateChannelManagerProxy",
        { libraries: { StateChannelUtilLibrary: libraryAddress } }
    );
    mathSmcFactory = mathSmcFactory.connect(randomSinger);
    // let mathStateChannelContactInstance = await mathSmcFactory.deploy(
    //     await mathContactInstance.getAddress()
    // );

    let mathStateChannelContactInstance = await deployUtils.deployAsync(
        mathSmcFactory,
        "MathStateChannelManagerProxy",
        [
            await mathContactInstance.getAddress(),
            disputeManagerFacetAddress,
            disputeVerificationFacetAddress
        ]
    );
    console.log(
        "Deployed MathStateChannelManagerProxy at ",
        await mathStateChannelContactInstance.getAddress()
    );
    // console.log("Finished sleeping for 20 seconds");
    // console.log("TIME - ", await mathStateChannelContactInstance.getAllTimes());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
