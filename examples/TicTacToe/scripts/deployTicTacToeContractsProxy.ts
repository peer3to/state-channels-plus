import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import {
    DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT,
    deploy
} from "@peer3/state-channels-plus";
import {
    TicTacToeStateChannelManagerProxy,
    TicTacToeStateMachine,
    TicTacToeConsumerFacet
} from "../tic-tac-toe-vite/src/stateChannel/typechain-types";

const DEFAULT_STATE_MACHINE_GAS_LIMIT = 500000;
const LOCALHOST_RPC_URL = process.env.PROVIDER_URL ?? "http://localhost:8545";

const getLocalhostSigners = async () => {
    const provider = new ethers.JsonRpcProvider(LOCALHOST_RPC_URL);

    // Random signer: useful for the SDK demo flow where gas price is 0.
    const randomSigner = ethers.Wallet.createRandom(provider);

    // NonceManager prevents tx replacement when multiple sends happen concurrently.
    const managedSigner = new ethers.NonceManager(randomSigner);

    return managedSigner;
};

export async function deployTicTacToe(): Promise<
    [TicTacToeStateChannelManagerProxy, TicTacToeStateMachine]
> {
    const deployer = await getLocalhostSigners();
    console.log("Deploying to", LOCALHOST_RPC_URL);
    console.log("Deployer:", await deployer.getAddress());

    const exampleContractsJsonPath = path.resolve(
        __dirname,
        "../contracts.json"
    );
    const viteContractsJsonPath = path.resolve(
        __dirname,
        "../tic-tac-toe-vite/src/contracts.json"
    );

    // State machine logic (app-specific)
    const ticTacToeSmFactory = await ethers.getContractFactory(
        "TicTacToeStateMachine",
        deployer
    );
    const ticTacToeContactInstance = (await ticTacToeSmFactory.deploy(
        DEFAULT_STATE_MACHINE_GAS_LIMIT
    )) as unknown as TicTacToeStateMachine;
    await ticTacToeContactInstance.waitForDeployment();
    console.log(
        "Deployed TicTacToeStateMachine at ",
        await ticTacToeContactInstance.getAddress()
    );

    // Consumer facet (app-specific on-chain logic)
    const ticTacToeConsumerFacetFactory = await ethers.getContractFactory(
        "TicTacToeConsumerFacet",
        deployer
    );
    const ticTacToeConsumerFacet =
        (await ticTacToeConsumerFacetFactory.deploy()) as unknown as TicTacToeConsumerFacet;
    await ticTacToeConsumerFacet.waitForDeployment();
    const ticTacToeConsumerFacetAddress =
        await ticTacToeConsumerFacet.getAddress();
    console.log(
        "Deployed TicTacToeConsumerFacet at ",
        ticTacToeConsumerFacetAddress
    );

    // Deploy core facets + StateChannelManagerProxy via the SDK helper.
    const sdkProxy = await deploy(
        await ticTacToeContactInstance.getAddress(),
        ticTacToeConsumerFacetAddress,
        deployer as any,
        {
            p2pTime: 5,
            agreementTime: 3,
            chainFallbackTime: 3,
            evidenceTime: 5
        },
        DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT
    );

    // Use the example project's ethers instance for typing + ABI formatting.
    const ticTacToeStateChannelContactInstance = (await ethers.getContractAt(
        "TicTacToeStateChannelManagerProxy",
        sdkProxy.address,
        deployer
    )) as unknown as TicTacToeStateChannelManagerProxy;
    console.log(
        "Deployed TicTacToeStateChannelManagerProxy at ",
        await ticTacToeStateChannelContactInstance.getAddress()
    );
    // await new Promise((resolve) => setTimeout(resolve, 20000));
    // console.log("This is needed so the block is mined and the contract is deployed");
    // console.log(
    //     "TIME - ",
    //     await TicTacToeStateChannelContactInstance.getAllTimes()
    // );
    const proxyFactory = await ethers.getContractFactory(
        "TicTacToeStateChannelManagerProxy"
    );

    const contractsJson = {
        TicTacToeStateMachine: {
            address: await ticTacToeContactInstance.getAddress(),
            abi: ticTacToeSmFactory.interface.formatJson()
        },
        TicTacToeConsumerFacet: {
            address: ticTacToeConsumerFacetAddress,
            abi: ticTacToeConsumerFacetFactory.interface.formatJson()
        },
        TicTacToeStateChannelManagerProxy: {
            address: await ticTacToeStateChannelContactInstance.getAddress(),
            abi: proxyFactory.interface.formatJson()
        }
    };

    fs.writeFileSync(
        exampleContractsJsonPath,
        JSON.stringify(contractsJson, null, 2)
    );
    fs.writeFileSync(
        viteContractsJsonPath,
        JSON.stringify(contractsJson, null, 2)
    );

    return [ticTacToeStateChannelContactInstance, ticTacToeContactInstance];
}

deployTicTacToe()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
