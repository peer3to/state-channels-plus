import { AddressLike, ethers, Wallet, NonceManager, Signer } from "ethers";
import { BigNumberish } from "ethers";
import EvmStateMachine from "../../src/evm/EvmStateMachine";
import {
    MathStateChannelManager,
    MathStateChannelManager__factory,
    MathStateChannelManagerProxy,
    MathStateMachine,
    MathStateMachine__factory
} from "../../typechain-types";
import { JoinChannelStruct } from "../../typechain-types/contracts/V1/DataTypes";
import MathStateMachineJSON from "../../artifacts/contracts/V1/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import P2pEventHooks from "../../src/P2pEventHooks";
// import dotenv from "dotenv";

let PROVIDER_URL = "http://localhost:8545";
// dotenv.config();
// PROVIDER_URL = process.env.PROVIDER_URL || "http://localhost:8545";

const createJoinChannelTestObject = (
    address: AddressLike,
    channelId?: string
): JoinChannelStruct => {
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
        deadlineTimestamp: Math.floor(Date.now() / 1000) + 120, // 2 minutes from now
        data: "0x00"
    };
    return jc;
};

const signJoinChannel = async (
    jc: JoinChannelStruct,
    signer: ethers.Signer
): Promise<{ encodedJoinChannel: string; signature: string }> => {
    let encodedJoinChannel = ethers.AbiCoder.defaultAbiCoder().encode(
        [
            `tuple(bytes32 channelId, address participant, uint256 amount, uint256 deadlineTimestamp, bytes data)`
        ],
        [jc]
    );
    let encodedHash = ethers.keccak256(encodedJoinChannel);
    let econdedHashBytes = ethers.getBytes(encodedHash);
    let signature = await signer.signMessage(econdedHashBytes);
    return { encodedJoinChannel, signature };
};
const getSigner = (privateKey: string) => {
    return new NonceManager(
        new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(PROVIDER_URL))
    );
};
const getRandomSigner = () => {
    let randomSinger: Signer = Wallet.createRandom(
        new ethers.JsonRpcProvider(PROVIDER_URL)
    );
    randomSinger = new NonceManager(randomSinger);
    return randomSinger;
};

const main = async () => {
    const args = process.argv.slice(2);
    let signer = getRandomSigner();
    let signerAddress = await signer.getAddress();
    if (args.length <= 0) return;
    let channelId = args[0];
    const ContractsJSON = require("../../contracts.json");
    // console.log(ContractsJSON);
    // return;
    let mathSmInstance = new ethers.Contract(
        ContractsJSON.MathStateMachine.address,
        ContractsJSON.MathStateMachine.abi,
        signer
    ) as unknown as MathStateMachine;

    let mathStateChannelManagerInstance = new ethers.Contract(
        ContractsJSON.MathStateChannelManagerProxy.address,
        ContractsJSON.MathStateChannelManagerProxy.abi,
        signer
    ) as unknown as MathStateChannelManagerProxy;
    console.log(await mathStateChannelManagerInstance.getAllTimes());
    // return;
    //P2P disovery/matchamking (this is not done here - just the end result)
    let joinChannelCommitment = createJoinChannelTestObject(
        signerAddress,
        channelId
    );

    let jcSigned = await signJoinChannel(joinChannelCommitment, signer);

    //P2P setup;
    let mathSmFactory = new ethers.ContractFactory(
        MathStateMachineJSON.abi,
        MathStateMachineJSON.bytecode,
        signer
    ) as MathStateMachine__factory;
    let deployTx = await mathSmFactory.getDeployTransaction(); // this deployes the contract locally
    let mathContractP2P: MathStateMachine;

    let p2p = await EvmStateMachine.p2pSetup(
        signer,
        deployTx,
        mathStateChannelManagerInstance,
        mathSmInstance,
        {
            onConnection: (address) => {
                //TODO! This is only for tests - currently
                p2p.p2pSigner.p2pManager.rpcProxy
                    .onSignJoinChannelTEST(
                        jcSigned.encodedJoinChannel,
                        jcSigned.signature
                    )
                    .broadcast();
            },
            onTurn: async () => {
                await new Promise((resolve) => setTimeout(resolve, 1000));

                console.log("Playing my move:", signerAddress);
                try {
                    let sum = await p2p.p2pContractInstance.getSum();
                    if (Number(sum) % 2 == 0) {
                        await mathContractP2P.add(3);
                    } else {
                        await mathContractP2P.add(5);
                    }
                } catch (e) {
                    console.log("\x1b[33m%s\x1b[0m", new Error().stack);
                    console.log("########", e);
                }
            }
        } as unknown as P2pEventHooks
    );

    mathContractP2P = p2p.p2pContractInstance;
    mathContractP2P.on(
        mathContractP2P.filters.Addition,
        (a: BigNumberish, b: BigNumberish, sum: BigNumberish) => {
            console.log(a, " + ", b, " = ", sum);
        }
    );
    mathContractP2P.on(mathContractP2P.filters.NextToPlay, async (player) => {
        console.log("Next to play ", player);
    });
    p2p.p2pSigner.setJc(joinChannelCommitment, jcSigned); //TODO! TEST
    console.log("Establishing connection");

    await p2p.p2pSigner.connectToChannel(joinChannelCommitment.channelId);
    console.log("Connection established");
    //on-chain open the channel

    // sleep for 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000));
};

main();
