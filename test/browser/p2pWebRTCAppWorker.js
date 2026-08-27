// @spec-test-coverage-ignore: browser app-worker driver for the WebRTC E2E page; evidence is mapped from run-p2p-webrtc-e2e.mjs
// Must run before any EVM/stream import pulls in Node globals: this app worker
// runs the SDK host inline in its own realm (like the SDK worker entry does).
import "@/evm/p2pRuntime/worker/nodeGlobalsShim";

import { ethers, ContractFactory } from "ethers";

import { EvmStateMachine } from "@/evm";
import {
    MathStateMachine__factory,
    StateChannelManagerInterface__factory
} from "@typechain-types";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";

/**
 * Path (2) of Luka's ask: a consumer app that runs the SDK inside its OWN worker.
 *
 * This worker runs `p2pSetup` inline (`RUN_SDK_IN_THREAD: false`) — the SDK host
 * runs in this worker realm. Because a worker can't drive `RTCPeerConnection`,
 * the host surfaces its WebRTC bridge port on `p2pInstance.webRTCBridgePort` and
 * — since `isWorkerRuntime()` is true — `p2pSetup` does NOT auto-install it.
 * Instead we bubble that port up to the page main thread (transferred here),
 * where the test calls `installWebRTCMainThreadBridge(port)` so the main thread
 * drives the RTCPeerConnection on this worker's behalf (worker -> main).
 */

async function deployLocalStateMachine(stateMachineSigner) {
    const stateMachineFactory = new ContractFactory(
        MathStateMachineArtifact.abi,
        MathStateMachineArtifact.bytecode,
        stateMachineSigner
    );
    const deployTx = await stateMachineFactory.getDeployTransaction(5_000_000);
    const sent = await stateMachineSigner.sendTransaction(deployTx);
    const receipt = await sent.wait();
    if (!receipt?.contractAddress) {
        throw new Error("No local MathStateMachine address created");
    }
    return receipt.contractAddress;
}

self.onmessage = async (event) => {
    const message = event.data;
    if (message?.type !== "start") return;

    const {
        providerUrl,
        scmAddress,
        channelId,
        signerSecret,
        relayUrl,
        peerId
    } = message;

    try {
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const runtimeSigner = new ethers.Wallet(signerSecret, provider);
        const stateMachineContractInstance = MathStateMachine__factory.connect(
            ethers.ZeroAddress,
            runtimeSigner
        );

        const p2pInstance = await EvmStateMachine.p2pSetup(
            StateChannelManagerInterface__factory.connect(
                scmAddress,
                runtimeSigner
            ),
            stateMachineContractInstance,
            deployLocalStateMachine,
            {
                peerId,
                signerSecret,
                config: {
                    PROVIDER_URL: providerUrl,
                    // Inline host in this worker realm — no nested SDK worker.
                    RUN_SDK_IN_THREAD: false,
                    DEBUG_LOCAL_TRANSPORT: true,
                    LOCAL_DISCOVERY_REGISTRY_URL: relayUrl,
                    CRASH_LOG_UPLOAD_ENDPOINT: "",
                    HOLEPUNCH_RELAYER_URLS: []
                }
            }
        );

        // Running in a worker, so the bridge was NOT auto-installed — bubble the
        // surfaced port up to the page main thread for manual install.
        const bridgePort = p2pInstance.webRTCBridgePort;
        if (!bridgePort) {
            self.postMessage({
                type: "error",
                message:
                    "p2pInstance.webRTCBridgePort was not surfaced inside the worker"
            });
            return;
        }

        p2pInstance.events.on("p2pEventHooks", "onConnection", (address) => {
            self.postMessage({ type: "connection", address: String(address) });
        });

        self.postMessage({ type: "bridgePort", port: bridgePort }, [
            bridgePort
        ]);

        await p2pInstance.p2pSigner.connectToChannel(channelId);
        self.postMessage({ type: "ready" });
    } catch (error) {
        self.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    }
};
