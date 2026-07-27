import { ContractFactory, ethers } from "ethers";
import path from "node:path";

import { EvmStateMachine } from "@/evm";
import type P2pInstance from "@/evm/P2pInstance";
import type { RuntimeEventMap } from "@/evm/p2pRuntime/RuntimeEventEmitter";
import {
    MathStateMachine,
    MathStateMachine__factory,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import MathStateMachineArtifact from "../../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import type { PingPongRpc } from "./PingPongRpcManifest";

const PING_PONG_MANIFEST = path.resolve(__dirname, "PingPongRpcManifest.ts");

async function deployLocalStateMachine(signer: ethers.Signer): Promise<string> {
    const factory = new ContractFactory(
        MathStateMachineArtifact.abi,
        MathStateMachineArtifact.bytecode,
        signer
    );
    const tx = await signer.sendTransaction(
        await factory.getDeployTransaction(5_000_000)
    );
    const receipt = await tx.wait();
    if (!receipt?.contractAddress) {
        throw new Error("No local MathStateMachine contract address created");
    }
    return receipt.contractAddress;
}

export async function createPingPeer(options: {
    runtimeWallet: ethers.HDNodeWallet;
    stateChannelManagerAddress: string;
    providerUrl: string;
    discoveryUrl: string;
    onConnection?: RuntimeEventMap["onConnection"];
}): Promise<P2pInstance<MathStateMachine, PingPongRpc>> {
    const runtimeSigner = options.runtimeWallet;
    const instance = await EvmStateMachine.p2pSetup<
        MathStateMachine,
        PingPongRpc
    >(
        StateChannelManagerProxy__factory.connect(
            options.stateChannelManagerAddress,
            runtimeSigner
        ),
        MathStateMachine__factory.connect(ethers.ZeroAddress, runtimeSigner),
        deployLocalStateMachine,
        {
            signerSecret: options.runtimeWallet.privateKey,
            customRpcManifest: { module: PING_PONG_MANIFEST },
            config: {
                PROVIDER_URL: options.providerUrl,
                LOCAL_DISCOVERY_REGISTRY_URL: options.discoveryUrl,
                RUN_SDK_IN_THREAD: false,
                VM_DEDICATED_THREAD: false,
                DEBUG_LOCAL_TRANSPORT: true
            }
        }
    );
    if (options.onConnection) {
        instance.on("onConnection", options.onConnection);
    }
    return instance;
}
