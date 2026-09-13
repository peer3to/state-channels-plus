// @spec-test-coverage-ignore: browser worker script for the WebRTC worker smokes; evidence is mapped from run-worker-contract-executor.mjs
import "@test/fixtures/NodeGlobalsShim";
import { createBrowserSdkExecutor } from "./sdkSetup.js";
import { ethers } from "ethers";

// Force the SDK down the main-thread bridge path even in browsers that expose
// native RTCPeerConnection inside dedicated workers.
Object.defineProperties(globalThis, {
    RTCPeerConnection: { configurable: true, value: undefined },
    RTCIceCandidate: { configurable: true, value: undefined }
});

let factory;
const peerAddress = ethers.Wallet.createRandom().address;
const candidates = [];
const received = [];
let sdk;
let answerApplied = false;
let channel;
let starting;

async function handleMessage(message) {
    if (message.type === "start") {
        globalThis.__SDK_RUNTIME__ = message.runtime;
        const hosts = [];
        const count = message.disposeIndex === undefined ? 1 : 2;
        for (let index = 0; index < count; index++) {
            let host;
            const instance = await createBrowserSdkExecutor({
                config: { VM_DEDICATED_THREAD: false },
                onRuntimeRoot(root) {
                    if (root.constructor.name === "P2pRuntimeHostRoot")
                        host = root;
                }
            });
            const port = instance.instance.webRTCBridgePort;
            if (!port)
                throw new Error(
                    "SDK worker did not supply its WebRTC bridge port"
                );
            globalThis.postMessage({ type: "bridge", port }, [port]);
            globalThis.postMessage({ type: "host-ready", index });
            hosts.push({
                sdk: instance,
                factory: await host.hostRpc
                    .requireManager()
                    .localRpc.webRTCSetupService.getConnectionFactory()
            });
        }
        if (message.disposeIndex !== undefined) {
            if (hosts[0].factory === hosts[1].factory)
                throw new Error("SDK hosts share a bridge factory");
            await hosts[message.disposeIndex].sdk.dispose();
        }
        const survivor = hosts[message.disposeIndex === 0 ? 1 : 0];
        sdk = survivor.sdk;
        factory = survivor.factory;
        const offer = await factory.createOffer(peerAddress, {
            onDataChannel(value) {
                channel = value;
                channel.onmessage = ({ data }) => {
                    received.push(data);
                    if (data === "main-to-worker") {
                        channel.send("worker-to-main");
                        globalThis.postMessage({
                            type: "result",
                            received: received.length,
                            transferredChannel:
                                typeof RTCDataChannel !== "undefined" &&
                                channel instanceof RTCDataChannel
                        });
                    }
                };
            },
            onIceCandidate(candidate) {
                globalThis.postMessage({ type: "ice", candidate });
            },
            onConnectionStateChange() {},
            onError(error) {
                globalThis.postMessage({
                    type: "error",
                    message: error.message
                });
            }
        });
        globalThis.postMessage({ type: "offer", offer });
    } else if (message.type === "answer") {
        await factory.applyAnswer(peerAddress, message.answer);
        answerApplied = true;
        for (const candidate of candidates.splice(0))
            await factory.addIceCandidate(peerAddress, candidate);
    } else if (message.type === "ice") {
        if (answerApplied)
            await factory.addIceCandidate(peerAddress, message.candidate);
        else candidates.push(message.candidate);
    } else if (message.type === "dispose") {
        await starting;
        try {
            await factory.close(peerAddress);
            await sdk?.dispose();
        } finally {
            globalThis.postMessage({ type: "disposed" });
        }
    }
}

globalThis.onmessage = ({ data }) => {
    const work = handleMessage(data);
    if (data.type === "start") starting = work;
    work.catch((error) =>
        globalThis.postMessage({ type: "error", message: error.message })
    );
};
