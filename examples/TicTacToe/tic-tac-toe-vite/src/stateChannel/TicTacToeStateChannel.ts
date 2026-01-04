import {
    ethers,
    EvmStateMachine,
    P2pEventHooks
} from "@peer3/state-channels-plus";
import type { Signer } from "@peer3/state-channels-plus";
import {
    TicTacToeStateChannelManagerProxy,
    TicTacToeStateMachine,
    TicTacToeStateMachine__factory
} from "./typechain-types";
import TicTacToeStateMachineJSON from "../TicTacToeStateMachine.json";
import ContractsJSON from "../contracts.json";
import { ticTacToeRpcServiceFactories } from "./CustomRpc";
import type { TicTacToeRpcFactories } from "./CustomRpc";
import peer3Config from "../peer3.config";

const PROVIDER_URL = "http://localhost:8545";
const WSS_PROVIDER_URL = "ws://localhost:8545";
export const getRandomSigner = () => {
    let randomSinger: Signer = ethers.Wallet.createRandom(
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
    let deployTx = await factory.getDeployTransaction(1_000_000); // this deployes the contract locally

    let p2p = await EvmStateMachine.p2pSetup<
        TicTacToeStateMachine,
        TicTacToeRpcFactories
    >(
        TicTacToeStateChannelManagerInstance.runner as Signer,
        deployTx,
        TicTacToeStateChannelManagerInstance,
        TicTacToeSmInstance,
        {
            p2pEventHooks,
            rpcServiceFactories: ticTacToeRpcServiceFactories,
            config: peer3Config
        }
    );
    return p2p;
};
