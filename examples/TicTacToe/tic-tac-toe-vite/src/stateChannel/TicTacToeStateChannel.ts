import {
    ethers,
    EvmStateMachine,
    P2pEventHooks
} from "@peer3/state-channels-plus";
import type {
    Signer,
    StateChannelManagerProxy
} from "@peer3/state-channels-plus";
import {
    TicTacToeStateChannelManagerProxy,
    TicTacToeStateMachine,
    TicTacToeStateMachine__factory
} from "./typechain-types";
import TicTacToeStateMachineJSON from "../TicTacToeStateMachine.json";
import ContractsJSON from "../contracts.json";
import { TicTacToeRpc } from "./CustomRpc";
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
    const deployStateMachine = async (signer: Signer) => {
        const factory = new ethers.ContractFactory(
            TicTacToeStateMachineJSON.abi,
            TicTacToeStateMachineJSON.bytecode,
            signer
        ) as TicTacToeStateMachine__factory;
        const response = await signer.sendTransaction(
            await factory.getDeployTransaction(1_000_000)
        );
        const receipt = await response.wait();
        if (!receipt?.contractAddress) {
            throw new Error(
                "Local TicTacToeStateMachine deployment failed: missing contractAddress"
            );
        }
        return receipt.contractAddress;
    };

    let p2p = await EvmStateMachine.p2pSetup<
        TicTacToeStateMachine,
        TicTacToeRpc
    >(
        TicTacToeStateChannelManagerInstance.runner as Signer,
        TicTacToeStateChannelManagerInstance as unknown as StateChannelManagerProxy,
        TicTacToeSmInstance,
        deployStateMachine,
        {
            customRpc: TicTacToeRpc,
            config: peer3Config
        }
    );

    // Event hooks are now registered as listeners on the instance.
    for (const [name, fn] of Object.entries(p2pEventHooks)) {
        if (typeof fn === "function") {
            p2p.on(name as Parameters<typeof p2p.on>[0], fn as never);
        }
    }

    return p2p;
};
