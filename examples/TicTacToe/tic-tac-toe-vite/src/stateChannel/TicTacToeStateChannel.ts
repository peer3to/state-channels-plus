import { ethers, Wallet, NonceManager, Signer } from "ethers";
import {
    EvmStateMachine,
    P2pEventHooks,
    P2pSigner,
    EvmUtils
} from "@peer3/state-channels-plus";
import {
    TicTacToeStateChannelManagerProxy,
    TicTacToeStateMachine,
    TicTacToeStateMachine__factory
} from "./typechain-types";
import TempSingleton from "./TempSingleton";
import TicTacToeStateMachineJSON from "../TicTacToeStateMachine.json";
import ContractsJSON from "../contracts.json";

const PROVIDER_URL = "http://localhost:8545";
const WSS_PROVIDER_URL = "ws://localhost:8545";
export const getRandomSigner = () => {
    let randomSinger: Signer = Wallet.createRandom(
        new ethers.WebSocketProvider(WSS_PROVIDER_URL)
        // new ethers.JsonRpcProvider(PROVIDER_URL)
    );
    // randomSinger = new NonceManager(randomSinger);
    return randomSinger;
};
export const getDltContracts = async (signer: Signer) => {
    let TicTacToeSmInstance = new ethers.Contract(
        ContractsJSON.TicTacToeStateMachine.address,
        ContractsJSON.TicTacToeStateMachine.abi,
        signer
    ) as unknown as TicTacToeStateMachine;

    let TicTacToeStateChannelManagerInstance = new ethers.Contract(
        ContractsJSON.TicTacToeStateChannelManagerProxy.address,
        ContractsJSON.TicTacToeStateChannelManagerProxy.abi,
        signer
    ) as unknown as TicTacToeStateChannelManagerProxy;
    return { TicTacToeStateChannelManagerInstance, TicTacToeSmInstance };
};

export const p2pSetup = async (
    TicTacToeStateChannelManagerInstance: TicTacToeStateChannelManagerProxy,
    TicTacToeSmInstance: TicTacToeStateMachine,
    p2pEventHooks: P2pEventHooks = {}
) => {
    //P2P setup;
    let factory = new ethers.ContractFactory(
        TicTacToeStateMachineJSON.abi,
        TicTacToeStateMachineJSON.bytecode,
        TicTacToeStateChannelManagerInstance.runner
    ) as TicTacToeStateMachine__factory;
    let deployTx = await factory.getDeployTransaction(); // this deployes the contract locally

    let p2p = await EvmStateMachine.p2pSetup(
        TicTacToeStateChannelManagerInstance.runner as Signer,
        deployTx,
        TicTacToeStateChannelManagerInstance,
        TicTacToeSmInstance,
        p2pEventHooks
    );
    return p2p;
};
