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
    const randomSinger = getRandomSigner();
    const deployUtils = new DeployUtils();
    console.log("Provider url:", PROVIDER_URL);

    const deploy = async (contractName: string, args: any[] = []) => {
        let factory = await ethers.getContractFactory(contractName);
        factory = factory.connect(randomSinger);
        const contract = await deployUtils.deployAsync(
            factory,
            contractName,
            args
        );
        console.log(
            `Deployed ${contractName} at `,
            await contract.getAddress()
        );
        return contract;
    };

    const disputeManagerFacet = await deploy("DisputeManagerFacet");
    const disputeVerificationFacet = await deploy("DisputeVerificationFacet");
    const fraudProofFacet = await deploy("FraudProofFacet");
    const disputeFraudProofFacet = await deploy("DisputeFraudProofFacet");
    const stateSnapshotFacet = await deploy("StateSnapshotFacet");
    const joinChannelFacet = await deploy("JoinChannelFacet");
    const utilityFacet = await deploy("UtilityFacet");
    const mathConsumerFacet = await deploy("MathConsumerFacet");

    const mathStateMachine = await deploy("MathStateMachine", [500000]);

    const stateChannelManagerProxy = await deploy("StateChannelManagerProxy", [
        await mathStateMachine.getAddress(),
        await disputeManagerFacet.getAddress(),
        await disputeVerificationFacet.getAddress(),
        await fraudProofFacet.getAddress(),
        await disputeFraudProofFacet.getAddress(),
        await stateSnapshotFacet.getAddress(),
        await joinChannelFacet.getAddress(),
        await utilityFacet.getAddress(),
        await mathConsumerFacet.getAddress(),
        0,
        0,
        0,
        0
    ]);

    console.log(
        "StateChannelManagerProxy deployed at",
        await stateChannelManagerProxy.getAddress()
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
