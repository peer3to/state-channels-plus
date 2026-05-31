import WebRTCSetupService from "../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts";
import { TransportType } from "../../src/transport/TransportType.ts";

// Force the SDK down the main-thread bridge path even in browsers that expose
// native RTCPeerConnection inside dedicated workers.
Object.defineProperties(globalThis, {
    RTCPeerConnection: {
        configurable: true,
        value: undefined
    },
    RTCIceCandidate: {
        configurable: true,
        value: undefined
    }
});

const WORKER_ADDRESS = "0x00000000000000000000000000000000000000a1";
const MAIN_ADDRESS = "0x00000000000000000000000000000000000000b2";

function createLogger() {
    const logger = {
        child: () => logger,
        debug: (...args) => {
            globalThis.postMessage({
                type: "progress",
                message: `worker debug:${args.map(String).join(" ")}`
            });
        },
        info: (...args) => {
            globalThis.postMessage({
                type: "progress",
                message: `worker info:${args.map(String).join(" ")}`
            });
        },
        warn: (...args) => {
            globalThis.postMessage({
                type: "progress",
                message: `worker warn:${args.map(String).join(" ")}`
            });
        },
        error: (...args) => {
            globalThis.postMessage({
                type: "logError",
                message: args.map(String).join(" ")
            });
        },
        verbose: () => undefined
    };
    return logger;
}

function createRemoteRpc() {
    const send = (type, payload) => ({
        sendOne: () => {
            globalThis.postMessage({ type, ...payload });
        }
    });

    return {
        webRTCSetupService: {
            onOfferWebRTC: (serializedOffer) =>
                send("offer", { serializedOffer }),
            onAnswerWebRTC: (serializedAnswer) =>
                send("answer", { serializedAnswer }),
            onIceCandidate: (serializedCandidate) =>
                send("iceCandidate", { serializedCandidate })
        }
    };
}

function createP2PManager() {
    const logger = createLogger();
    const manager = {
        logger,
        openConnections: [],
        receivedMessages: [],
        webRTCTransports: [],
        stateManager: {
            logger,
            p2pEventHooks: {},
            forkId: 0n,
            getChannelId: () => "browser-webrtc-worker-smoke"
        },
        profileManager: {
            getProfileByTransport: (transport) => {
                if (transport.__baseTransport) {
                    return { evmAddress: MAIN_ADDRESS };
                }
                return undefined;
            }
        },
        localRpc: {
            initHandshakeService: {
                initHandshake: (transport) => {
                    transport.peerAddress ||= MAIN_ADDRESS;
                    if (!manager.webRTCTransports.includes(transport)) {
                        manager.webRTCTransports.push(transport);
                    }
                    if (!manager.openConnections.includes(transport)) {
                        manager.openConnections.push(transport);
                    }
                    globalThis.postMessage({ type: "transportOpen" });
                }
            }
        },
        remoteRpc: createRemoteRpc(),
        onRpc: (serializedRPC) => {
            manager.receivedMessages.push(serializedRPC);
            globalThis.postMessage({
                type: "transportMessage",
                data: serializedRPC
            });
        },
        disconnectConnection: (transport) => {
            manager.openConnections = manager.openConnections.filter(
                (t) => t !== transport
            );
        }
    };
    return manager;
}

const p2pManager = createP2PManager();
const service = new WebRTCSetupService(p2pManager);
p2pManager.localRpc.webRTCSetupService = service;

function postConnectionState(label) {
    globalThis.postMessage({
        type: "progress",
        message: `${label} ${JSON.stringify(
            service.getWebRTCConnectionState(MAIN_ADDRESS)
        )}`
    });
}

async function handleMessage(message) {
    if (message.type === "start") {
        globalThis.postMessage({
            type: "progress",
            message: "worker start received"
        });
        await service.initiateWebRTC({
            __baseTransport: true,
            peerAddress: MAIN_ADDRESS,
            transportType: TransportType.HOLEPUNCH
        });
        globalThis.postMessage({
            type: "progress",
            message: "worker initiate finished"
        });
        globalThis.postMessage({ type: "started" });
        return;
    }

    if (message.type === "answer") {
        globalThis.postMessage({
            type: "progress",
            message: "worker answer received"
        });
        await service.applyWebRTCAnswer(
            MAIN_ADDRESS,
            JSON.parse(message.serializedAnswer)
        );
        globalThis.postMessage({
            type: "progress",
            message: "worker answer applied"
        });
        postConnectionState("worker state after answer");
        return;
    }

    if (message.type === "iceCandidate") {
        globalThis.postMessage({
            type: "progress",
            message: "worker ICE received"
        });
        await service.addWebRTCIceCandidate(
            MAIN_ADDRESS,
            JSON.parse(message.serializedCandidate)
        );
        globalThis.postMessage({
            type: "progress",
            message: "worker ICE applied"
        });
        postConnectionState("worker state after ICE");
        return;
    }

    if (message.type === "send") {
        const [transport] = p2pManager.webRTCTransports;
        if (!transport) {
            throw new Error("Worker WebRTC transport is not open");
        }
        transport._send(message.data);
    }
}

globalThis.onmessage = (event) => {
    Promise.resolve(handleMessage(event.data)).catch((error) => {
        globalThis.postMessage({
            type: "workerError",
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    });
};
