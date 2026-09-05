// @spec-test-coverage-ignore: browser page script for the WebRTC smokes; evidence is mapped from run-worker-contract-executor.mjs
import WebRTCSetupService from "../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts";
import { installWebRTCMainThreadBridge } from "../../src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts";
import { TransportType } from "../../src/transport/TransportType.ts";

const MAIN_A_ADDRESS = "0x0000000000000000000000000000000000000001";
const MAIN_B_ADDRESS = "0x0000000000000000000000000000000000000002";
const WORKER_ADDRESS = "0x00000000000000000000000000000000000000a1";
const MAIN_ADDRESS = "0x00000000000000000000000000000000000000b2";

function waitFor(predicate, label, timeoutMs = 15000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                const value = predicate();
                if (value) {
                    resolve(value);
                    return;
                }
            } catch (error) {
                reject(error);
                return;
            }

            if (Date.now() - startedAt > timeoutMs) {
                const message = typeof label === "function" ? label() : label;
                reject(new Error(`${message} timed out`));
                return;
            }
            setTimeout(tick, 20);
        };
        tick();
    });
}

function createLogger(errors, progress = []) {
    const logger = {
        child: () => logger,
        debug: (...args) => {
            progress.push(`debug:${args.map(String).join(" ")}`);
        },
        info: (...args) => {
            progress.push(`info:${args.map(String).join(" ")}`);
        },
        warn: (...args) => {
            progress.push(`warn:${args.map(String).join(" ")}`);
        },
        error: (...args) => {
            errors.push(new Error(args.map(String).join(" ")));
        },
        verbose: () => undefined
    };
    return logger;
}

function createP2PManager(localAddress, remoteAddress, errors, progress = []) {
    const logger = createLogger(errors, progress);
    const manager = {
        localAddress,
        remoteAddress,
        logger,
        openConnections: [],
        receivedMessages: [],
        webRTCTransports: [],
        stateManager: {
            logger,
            forkId: 0n,
            getChannelId: () => "browser-webrtc-smoke"
        },
        profileManager: {
            // Every transport registers itself with the profile manager on
            // construction (ATransport); the smoke tracks open transports
            // through the handshake hook instead.
            registerTransport: () => undefined,
            getProfileByTransport: (transport) => {
                if (transport.__baseTransport) {
                    return { evmAddress: remoteAddress };
                }
                return undefined;
            }
        },
        localRpc: {
            initHandshakeService: {
                initHandshake: (transport) => {
                    transport.peerAddress ||= remoteAddress;
                    if (!manager.webRTCTransports.includes(transport)) {
                        manager.webRTCTransports.push(transport);
                    }
                    if (!manager.openConnections.includes(transport)) {
                        manager.openConnections.push(transport);
                    }
                }
            }
        },
        remoteRpc: undefined,
        onRpc: (serializedRPC, transport) => {
            manager.receivedMessages.push({ serializedRPC, transport });
        },
        disconnectConnection: (transport) => {
            manager.openConnections = manager.openConnections.filter(
                (t) => t !== transport
            );
        }
    };
    return manager;
}

function createServiceHarness(
    localAddress,
    remoteAddress,
    errors,
    progress = []
) {
    const p2pManager = createP2PManager(
        localAddress,
        remoteAddress,
        errors,
        progress
    );
    const service = new WebRTCSetupService(p2pManager);
    p2pManager.localRpc.webRTCSetupService = service;
    return { p2pManager, service };
}

function createBaseTransport(peerAddress) {
    return {
        __baseTransport: true,
        peerAddress,
        transportType: TransportType.HOLEPUNCH
    };
}

function createMainThreadSignalRouter(initiator, responder, errors) {
    let initiatorCanReceiveIce = false;
    let responderCanReceiveIce = false;
    const pendingForInitiator = [];
    const pendingForResponder = [];

    const run = (promise) => {
        Promise.resolve(promise).catch((error) => {
            errors.push(
                error instanceof Error ? error : new Error(String(error))
            );
        });
    };

    const addIceToInitiator = async (candidate) => {
        if (!initiatorCanReceiveIce) {
            pendingForInitiator.push(candidate);
            return;
        }
        await initiator.service.addWebRTCIceCandidate(
            responder.p2pManager.localAddress,
            candidate
        );
    };

    const addIceToResponder = async (candidate) => {
        if (!responderCanReceiveIce) {
            pendingForResponder.push(candidate);
            return;
        }
        await responder.service.addWebRTCIceCandidate(
            initiator.p2pManager.localAddress,
            candidate
        );
    };

    const drainIce = async () => {
        while (pendingForResponder.length > 0) {
            await addIceToResponder(pendingForResponder.shift());
        }
        while (pendingForInitiator.length > 0) {
            await addIceToInitiator(pendingForInitiator.shift());
        }
    };

    initiator.p2pManager.remoteRpc = {
        webRTCSetupService: {
            onOfferWebRTC: (serializedOffer) => ({
                sendOne: () =>
                    run(
                        (async () => {
                            const answer =
                                await responder.service.acceptWebRTCOffer(
                                    initiator.p2pManager.localAddress,
                                    JSON.parse(serializedOffer)
                                );
                            responderCanReceiveIce = true;
                            await initiator.service.applyWebRTCAnswer(
                                responder.p2pManager.localAddress,
                                answer
                            );
                            initiatorCanReceiveIce = true;
                            await drainIce();
                        })()
                    )
            }),
            onAnswerWebRTC: () => ({ sendOne: () => undefined }),
            onIceCandidate: (serializedCandidate) => ({
                sendOne: () =>
                    run(addIceToResponder(JSON.parse(serializedCandidate)))
            })
        }
    };

    responder.p2pManager.remoteRpc = {
        webRTCSetupService: {
            onOfferWebRTC: () => ({ sendOne: () => undefined }),
            onAnswerWebRTC: () => ({ sendOne: () => undefined }),
            onIceCandidate: (serializedCandidate) => ({
                sendOne: () =>
                    run(addIceToInitiator(JSON.parse(serializedCandidate)))
            })
        }
    };
}

async function assertBidirectionalTransport(
    leftManager,
    rightManager,
    leftPayload,
    rightPayload
) {
    await waitFor(
        () =>
            leftManager.webRTCTransports[0] && rightManager.webRTCTransports[0],
        "WebRTC transports to open"
    );

    const [leftTransport] = leftManager.webRTCTransports;
    const [rightTransport] = rightManager.webRTCTransports;

    leftTransport._send(leftPayload);
    await waitFor(
        () =>
            rightManager.receivedMessages.some(
                (message) => message.serializedRPC === leftPayload
            ),
        "right side to receive WebRTC payload"
    );

    rightTransport._send(rightPayload);
    await waitFor(
        () =>
            leftManager.receivedMessages.some(
                (message) => message.serializedRPC === rightPayload
            ),
        "left side to receive WebRTC payload"
    );

    leftTransport.close(true);
    rightTransport.close(true);
}

globalThis.runWebRTCMainThreadBrowserSmoke = async () => {
    const errors = [];
    const progress = [];
    const initiator = createServiceHarness(
        MAIN_A_ADDRESS,
        MAIN_B_ADDRESS,
        errors,
        progress
    );
    const responder = createServiceHarness(
        MAIN_B_ADDRESS,
        MAIN_A_ADDRESS,
        errors,
        progress
    );
    createMainThreadSignalRouter(initiator, responder, errors);

    await initiator.service.initiateWebRTC(createBaseTransport(MAIN_B_ADDRESS));
    try {
        await assertBidirectionalTransport(
            initiator.p2pManager,
            responder.p2pManager,
            "main-thread-offer-to-answer",
            "main-thread-answer-to-offer"
        );
    } catch (error) {
        // A bare timeout hides why the channels never opened: surface what
        // the services logged and the connection states they reached.
        const states = [initiator, responder].map((side) =>
            JSON.stringify(
                side.service.getWebRTCConnectionState(
                    side.p2pManager.remoteAddress
                )
            )
        );
        throw new Error(
            `${error.message}; states=${states.join(" / ")}; errors=${errors
                .map((e) => e.message)
                .join(" | ")}; progress=${progress.slice(-30).join(" | ")}`
        );
    }

    if (errors.length > 0) throw errors[0];
    return {
        receivedByInitiator: initiator.p2pManager.receivedMessages.length,
        receivedByResponder: responder.p2pManager.receivedMessages.length
    };
};

async function runWebRTCWorkerBridgeSmoke(bridgeOptions = {}) {
    const errors = [];
    const progress = [];
    const mainHarness = createServiceHarness(
        MAIN_ADDRESS,
        WORKER_ADDRESS,
        errors,
        progress
    );
    let mainCanReceiveIce = false;
    let workerCanReceiveIce = false;
    const pendingForMain = [];
    const pendingForWorker = [];
    let workerTransportOpen = false;
    const workerReceivedMessages = [];

    const worker = new Worker(
        new URL("./webrtc-service-worker.js", import.meta.url),
        { type: "module" }
    );
    // Mirror the SDK contract: hand the worker the bridge port (the host would
    // surface this on P2pInstance.webRTCBridgePort), then bind the other end.
    const bridgeChannel = new MessageChannel();
    worker.postMessage({ type: "bridgePort" }, [bridgeChannel.port2]);
    const bridge = installWebRTCMainThreadBridge(
        bridgeChannel.port1,
        bridgeOptions
    );

    const postToWorker = (message) => worker.postMessage(message);

    const addIceToMain = async (candidate) => {
        if (!mainCanReceiveIce) {
            pendingForMain.push(candidate);
            return;
        }
        progress.push("add ICE to main");
        await mainHarness.service.addWebRTCIceCandidate(
            WORKER_ADDRESS,
            candidate
        );
    };

    const addIceToWorker = (candidate) => {
        if (!workerCanReceiveIce) {
            pendingForWorker.push(candidate);
            return;
        }
        progress.push("add ICE to worker");
        postToWorker({
            type: "iceCandidate",
            serializedCandidate: JSON.stringify(candidate)
        });
    };

    const drainIce = async () => {
        while (pendingForMain.length > 0) {
            await addIceToMain(pendingForMain.shift());
        }
        while (pendingForWorker.length > 0) {
            addIceToWorker(pendingForWorker.shift());
        }
    };

    mainHarness.p2pManager.remoteRpc = {
        webRTCSetupService: {
            onOfferWebRTC: () => ({ sendOne: () => undefined }),
            onAnswerWebRTC: (serializedAnswer) => ({
                sendOne: () => {
                    workerCanReceiveIce = true;
                    postToWorker({ type: "answer", serializedAnswer });
                    void drainIce().catch((error) => errors.push(error));
                }
            }),
            onIceCandidate: (serializedCandidate) => ({
                sendOne: () => addIceToWorker(JSON.parse(serializedCandidate))
            })
        }
    };

    const workerReady = new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
            const message = event.data;
            if (message.type === "workerError") {
                reject(new Error(message.message));
                return;
            }
            if (message.type === "logError") {
                errors.push(new Error(message.message));
                return;
            }
            if (message.type === "progress") {
                progress.push(message.message);
                return;
            }
            if (message.type === "transportOpen") {
                progress.push("worker transport open");
                workerTransportOpen = true;
                return;
            }
            if (message.type === "transportMessage") {
                workerReceivedMessages.push(message.data);
                return;
            }
            if (message.type === "offer") {
                progress.push("worker offer");
                void (async () => {
                    const answer = await mainHarness.service.acceptWebRTCOffer(
                        WORKER_ADDRESS,
                        JSON.parse(message.serializedOffer)
                    );
                    progress.push("main answer created");
                    mainCanReceiveIce = true;
                    const serializedAnswer = JSON.stringify(answer);
                    workerCanReceiveIce = true;
                    postToWorker({ type: "answer", serializedAnswer });
                    await drainIce();
                    resolve(undefined);
                })().catch(reject);
                return;
            }
            if (message.type === "iceCandidate") {
                progress.push("worker ICE");
                void addIceToMain(
                    JSON.parse(message.serializedCandidate)
                ).catch(reject);
            }
        };
        worker.onerror = (event) => {
            reject(new Error(event.message || "WebRTC worker failed"));
        };
    });

    try {
        postToWorker({ type: "start" });
        await workerReady;
        await waitFor(
            () =>
                workerTransportOpen &&
                mainHarness.p2pManager.webRTCTransports[0],
            () =>
                `worker and main WebRTC transports to open (${[
                    `workerOpen=${workerTransportOpen}`,
                    `mainTransports=${mainHarness.p2pManager.webRTCTransports.length}`,
                    `mainState=${JSON.stringify(
                        mainHarness.service.getWebRTCConnectionState(
                            WORKER_ADDRESS
                        )
                    )}`,
                    `pendingForMain=${pendingForMain.length}`,
                    `pendingForWorker=${pendingForWorker.length}`,
                    `errors=${errors.map((error) => error.message).join(" | ") || "none"}`,
                    `progress=${progress.join(" > ") || "none"}`
                ].join(", ")})`
        );

        const [mainTransport] = mainHarness.p2pManager.webRTCTransports;
        mainTransport._send("main-to-worker");
        await waitFor(
            () => workerReceivedMessages.includes("main-to-worker"),
            "worker to receive main WebRTC payload"
        );

        postToWorker({ type: "send", data: "worker-to-main" });
        await waitFor(
            () =>
                mainHarness.p2pManager.receivedMessages.some(
                    (message) => message.serializedRPC === "worker-to-main"
                ),
            "main to receive worker WebRTC payload"
        );

        if (errors.length > 0) throw errors[0];
        return {
            receivedByMain: mainHarness.p2pManager.receivedMessages.length,
            receivedByWorker: workerReceivedMessages.length
        };
    } finally {
        bridge.dispose();
        worker.terminate();
    }
}

globalThis.runWebRTCDedicatedWorkerBrowserSmoke = () =>
    runWebRTCWorkerBridgeSmoke();

// Force the proxy path: channel traffic is relayed over the bridge rather than
// handed to the worker as a transferred RTCDataChannel. Chromium supports
// channel transfer, so without forcing this the proxy path (the one
// Firefox/Safari always take) is never exercised end-to-end.
globalThis.runWebRTCProxyWorkerBrowserSmoke = () =>
    runWebRTCWorkerBridgeSmoke({ channelMode: "proxy" });
