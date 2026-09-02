// @spec-test-coverage-ignore: browser page driver for the WebRTC E2E run; evidence is mapped from run-p2p-webrtc-e2e.mjs
import { ethers, NonceManager, ContractFactory } from "ethers";

import { EvmStateMachine } from "@/evm";
import Clock from "@/Clock";
import { installWebRTCMainThreadBridge } from "@/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge";
import { Status } from "@/types";
import { MathStateMachine__factory } from "@typechain-types";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import { Codec, SignatureUtils, Type } from "@/utils";
import { deployFullStack } from "../../scripts/V1/deploy";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";

/**
 * Browser e2e: two REAL p2pSetup peers connect over WebRTC.
 *
 * Path (1) of Luka's ask: run our normal `p2pSetup` directly from the main
 * thread with the SDK-thread flag (`RUN_SDK_IN_THREAD`). Each peer's SDK boots
 * in a Web Worker that cannot drive `RTCPeerConnection` itself, so it surfaces a
 * bridge port that `p2pSetup` auto-installs on this main thread. The two workers
 * rendezvous through the local-discovery relay hub, handshake over a
 * `BrowserLocalTransport`, then upgrade to WebRTC — the data plane the worker
 * peers can only reach through the auto-installed main-thread bridge.
 *
 * The direction under test is worker -> main thread (unlike the old smoke's
 * main -> worker), with all real components (real p2pSetup, EVM, handshake,
 * WebRTC) rather than mocks.
 */

const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

/**
 * Surface Web Worker load/runtime errors. A worker that throws while evaluating
 * its module fires the parent Worker's `error` event (not console), which the
 * test runner would otherwise never see — the worker just goes silent.
 */
function installWorkerErrorSpy() {
    const NativeWorker = globalThis.Worker;
    if (!NativeWorker || NativeWorker.__p2pE2ESpy) return;
    class SpiedWorker extends NativeWorker {
        constructor(url, options) {
            super(url, options);
            this.addEventListener("error", (event) => {
                console.error(
                    `[worker error] ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`
                );
            });
            this.addEventListener("messageerror", (event) => {
                console.error(`[worker messageerror] ${String(event.data)}`);
            });
        }
    }
    SpiedWorker.__p2pE2ESpy = true;
    globalThis.Worker = SpiedWorker;
}
installWorkerErrorSpy();

/**
 * Spy on the page main thread's `RTCPeerConnection`. Worker-hosted peers can't
 * construct one, so every instance recorded here is proof the bridge delegated
 * WebRTC negotiation up to the main thread — exactly the path #376/#380 enable.
 */
const rtcConnections = [];
function installRTCPeerConnectionSpy() {
    const Native = globalThis.RTCPeerConnection;
    if (!Native || Native.__p2pE2ESpy) return;

    class SpiedRTCPeerConnection extends Native {
        constructor(...args) {
            super(...args);
            const record = { connection: this, reachedConnected: false };
            rtcConnections.push(record);
            this.addEventListener("connectionstatechange", () => {
                if (this.connectionState === "connected") {
                    record.reachedConnected = true;
                }
            });
            this.addEventListener("iceconnectionstatechange", () => {
                if (
                    this.iceConnectionState === "connected" ||
                    this.iceConnectionState === "completed"
                ) {
                    record.reachedConnected = true;
                }
            });
        }
    }
    SpiedRTCPeerConnection.__p2pE2ESpy = true;
    globalThis.RTCPeerConnection = SpiedRTCPeerConnection;
}
installRTCPeerConnectionSpy();

function waitFor(predicate, label, timeoutMs = 45_000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            let value;
            try {
                value = predicate();
            } catch (error) {
                reject(error);
                return;
            }
            if (value) {
                resolve(value);
                return;
            }
            if (Date.now() - startedAt > timeoutMs) {
                const message = typeof label === "function" ? label() : label;
                reject(new Error(`${message} timed out`));
                return;
            }
            setTimeout(tick, 50);
        };
        tick();
    });
}

async function waitForAsync(predicate, label, timeoutMs = 45_000) {
    const startedAt = Date.now();
    for (;;) {
        if (await predicate()) return;
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(typeof label === "function" ? label() : label);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

// Generous agreement window: the handshake round-trip (and the peers' clock
// difference) must fit inside `agreementTime`, and browser workers running the
// EVM are far slower than node — a tight 2s window flakes on RTT.
const timeConfig = {
    p2pTime: 5,
    agreementTime: 30,
    chainFallbackTime: 30,
    evidenceTime: 60
};

/**
 * Deploy the full stack against the external hardhat node (reached through the
 * same-origin RPC proxy) and derive a shared channel id for discovery. The
 * existing-channel case opens that ID on-chain after the genesis runtime has
 * selected it, so the observer exercises the real sync boundary over WebRTC.
 */
async function deployStack(providerUrl, openExistingChannel) {
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallets = [0, 1, 2, 3].map((index) =>
        ethers.HDNodeWallet.fromPhrase(
            DEFAULT_HARDHAT_MNEMONIC,
            undefined,
            `m/44'/60'/0'/0/${index}`
        )
    );
    const [deployerWallet, peerAWallet, peerBWallet, genesisPeerWallet] =
        wallets;
    const deployerSigner = new NonceManager(deployerWallet.connect(provider));

    const scmDeployment = await deployFullStack(deployerSigner, {
        stateMachineArtifact: MathStateMachineArtifact,
        consumerFacetArtifact: MathConsumerFacetArtifact,
        stateMachineArgs: [5_000_000],
        consumerFacetArgs: [],
        timeConfig,
        disputeExecutionGasLimit: 1_000_000
    });

    await Clock.init(provider);

    const channelId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["string"],
            ["browser-webrtc-e2e"]
        )
    );

    const openConfirmedChannel = async () => {
        const latestBlock = await provider.getBlock("latest");
        const openChannel = {
            channelId,
            participants: [deployerWallet.address, genesisPeerWallet.address],
            balances: [
                { amount: 500n, data: "0x1234" },
                { amount: 500n, data: "0x5678" }
            ],
            deadlineTimestamp: BigInt(latestBlock.timestamp + 120),
            isAtomic: true,
            data: "0x"
        };
        const signatures = await Promise.all(
            [deployerWallet, genesisPeerWallet].map((wallet) =>
                SignatureUtils.signOpenChannel(openChannel, wallet)
            )
        );
        const manager = connectStateChannelManager(
            scmDeployment.address,
            deployerSigner
        );
        await (
            await manager.open({
                encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
                signatures: signatures.map(({ signature }) => signature)
            })
        ).wait();
    };

    return {
        provider,
        scmAddress: scmDeployment.address,
        channelId,
        peerWallets: openExistingChannel
            ? [deployerWallet, peerAWallet]
            : [peerAWallet, peerBWallet],
        openConfirmedChannel
    };
}

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

async function setupPeer(
    peerWallet,
    providerUrl,
    scmAddress,
    relayUrl,
    peerId
) {
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const runtimeSigner = peerWallet.connect(provider);

    const stateMachineContractInstance = MathStateMachine__factory.connect(
        ethers.ZeroAddress,
        runtimeSigner
    );

    return EvmStateMachine.p2pSetup(
        connectStateChannelManager(scmAddress, runtimeSigner),
        stateMachineContractInstance,
        deployLocalStateMachine,
        {
            peerId,
            config: {
                PROVIDER_URL: providerUrl,
                RUN_SDK_IN_THREAD: true,
                DEBUG_LOCAL_TRANSPORT: true,
                LOCAL_DISCOVERY_REGISTRY_URL: relayUrl,
                LOG_LEVEL: globalThis.__P2P_E2E__?.logLevel ?? "info",
                // Silence background network work that congests the worker event
                // loop (and adds noisy errors): no crash-log upload, no
                // Holepunch relay — discovery here is the local relay hub.
                CRASH_LOG_UPLOAD_ENDPOINT: "",
                HOLEPUNCH_RELAYER_URLS: []
            },
            signerSecret: peerWallet.privateKey
        }
    );
}

globalThis.runP2pWebRTCMainThreadE2E = async () => {
    const config = globalThis.__P2P_E2E__;
    if (!config?.providerUrl || !config?.relayUrl) {
        throw new Error(
            "Missing __P2P_E2E__ config (providerUrl / relayUrl) on the page"
        );
    }
    installRTCPeerConnectionSpy();
    rtcConnections.length = 0;

    const { scmAddress, channelId, peerWallets, openConfirmedChannel } =
        await deployStack(config.providerUrl, true);

    const peerInstances = await Promise.all(
        peerWallets.map((wallet, index) =>
            setupPeer(
                wallet,
                config.providerUrl,
                scmAddress,
                config.relayUrl,
                index
            )
        )
    );
    // Select the channel on the genesis runtime before the external opening so
    // its provider listener applies genesis and can serve the observers.
    const selectedBeforeOpen =
        await peerInstances[0].p2pSigner.connectToChannel(channelId);
    if (selectedBeforeOpen !== false) {
        throw new Error("pre-open target selection unexpectedly connected");
    }
    await openConfirmedChannel();
    await waitForAsync(
        async () =>
            (await peerInstances[0].p2pSigner.getChannelStatus()) ===
            Status.PARTICIPATING,
        "genesis participant did not apply the confirmed opening"
    );

    const connectedBy = peerInstances.map(() => new Set());
    peerInstances.forEach((peer, index) => {
        peer.events.on("p2pEventHooks", "onConnection", (address) => {
            connectedBy[index].add(String(address).toLowerCase());
        });
    });

    // Both worker peers surface a bridge port (they can't drive
    // RTCPeerConnection themselves) — proof the #380 surfacing fired.
    const bridgePorts = peerInstances.map((peer) =>
        Boolean(peer.webRTCBridgePort)
    );

    try {
        // The genesis signer and observers must join the raw topic together.
        // A local discovery join remains pending until another peer appears.
        const connectResults = await Promise.race([
            Promise.all(
                peerInstances.map((peer) =>
                    peer.p2pSigner.connectToChannel(channelId)
                )
            ),
            new Promise((_, reject) =>
                setTimeout(
                    async () =>
                        reject(
                            new Error(
                                `existing-channel connects stuck at ${(
                                    await Promise.all(
                                        peerInstances.map((peer) =>
                                            peer.p2pSigner.getChannelStatus()
                                        )
                                    )
                                ).join(",")}`
                            )
                        ),
                    90_000
                )
            )
        ]);
        const connectStatuses = await Promise.all(
            peerInstances.map((peer) => peer.p2pSigner.getChannelStatus())
        );

        const addrA = peerWallets[0].address.toLowerCase();
        const addrB = peerWallets[1].address.toLowerCase();

        await waitFor(
            () =>
                connectedBy[0].has(addrB) &&
                connectedBy[1].has(addrA) &&
                rtcConnections.some((record) => record.reachedConnected),
            () =>
                `two worker peers to connect over WebRTC (` +
                `aSawB=${connectedBy[0].has(addrB)}, ` +
                `bSawA=${connectedBy[1].has(addrA)}, ` +
                `rtcCreated=${rtcConnections.length}, ` +
                `rtcConnected=${rtcConnections.filter((r) => r.reachedConnected).length})`
        );

        return {
            bridgePortA: bridgePorts[0],
            bridgePortB: bridgePorts[1],
            connectedAtoB: connectedBy[0].has(addrB),
            connectedBtoA: connectedBy[1].has(addrA),
            connectResults,
            connectStatuses,
            rtcCreated: rtcConnections.length,
            rtcConnected: rtcConnections.filter((r) => r.reachedConnected)
                .length
        };
    } finally {
        await Promise.allSettled(peerInstances.map((peer) => peer.dispose()));
    }
};

/**
 * Path (2): each peer runs `p2pSetup` inside its OWN app worker. Because it's a
 * worker, `p2pSetup` does not auto-install the bridge — the worker bubbles its
 * `webRTCBridgePort` up here (transferred), and we install it on the main
 * thread manually with `installWebRTCMainThreadBridge`. WebRTC is then driven on
 * this main thread on behalf of the workers (the nested-worker bubble-up path).
 */
globalThis.runP2pWebRTCWorkerBubbleUpE2E = async () => {
    const config = globalThis.__P2P_E2E__;
    if (!config?.providerUrl || !config?.relayUrl) {
        throw new Error(
            "Missing __P2P_E2E__ config (providerUrl / relayUrl) on the page"
        );
    }
    installWorkerErrorSpy();
    installRTCPeerConnectionSpy();
    rtcConnections.length = 0;

    const { scmAddress, channelId, peerWallets } = await deployStack(
        config.providerUrl,
        false
    );

    const connectedBy = [new Set(), new Set()];
    const bridgeHandles = [];
    const workers = [];

    const spawnPeer = (index) =>
        new Promise((resolve, reject) => {
            const worker = new Worker(
                new URL("./p2pWebRTCAppWorker.js", import.meta.url),
                { type: "module" }
            );
            workers.push(worker);
            worker.onmessage = (event) => {
                const message = event.data;
                if (message.type === "bridgePort") {
                    // The bubble-up path: install the worker's surfaced port on
                    // the main thread by hand (no auto-install inside a worker).
                    bridgeHandles.push(
                        installWebRTCMainThreadBridge(message.port)
                    );
                } else if (message.type === "connection") {
                    connectedBy[index].add(
                        String(message.address).toLowerCase()
                    );
                } else if (message.type === "connectResult") {
                    resolve(message);
                } else if (message.type === "error") {
                    reject(
                        new Error(`app worker ${index}: ${message.message}`)
                    );
                }
            };
            worker.onerror = (event) =>
                reject(
                    new Error(
                        `app worker ${index} error: ${event.message || "unknown"}`
                    )
                );
            worker.postMessage({
                type: "start",
                providerUrl: config.providerUrl,
                scmAddress,
                channelId,
                signerSecret: peerWallets[index].privateKey,
                relayUrl: config.relayUrl,
                peerId: index,
                connectOptions: {
                    autoOpen: true,
                    shouldJoin: true,
                    balance: { amount: 777n, data: "0x1234" }
                }
            });
        });

    try {
        const connectResults = await Promise.all([spawnPeer(0), spawnPeer(1)]);

        const addrA = peerWallets[0].address.toLowerCase();
        const addrB = peerWallets[1].address.toLowerCase();

        await waitFor(
            () =>
                connectedBy[0].has(addrB) &&
                connectedBy[1].has(addrA) &&
                rtcConnections.some((record) => record.reachedConnected),
            () =>
                `two worker-bubble-up peers to connect over WebRTC (` +
                `aSawB=${connectedBy[0].has(addrB)}, ` +
                `bSawA=${connectedBy[1].has(addrA)}, ` +
                `bridgesInstalled=${bridgeHandles.length}, ` +
                `rtcCreated=${rtcConnections.length}, ` +
                `rtcConnected=${rtcConnections.filter((r) => r.reachedConnected).length})`
        );

        return {
            bridgesInstalled: bridgeHandles.length,
            connectedAtoB: connectedBy[0].has(addrB),
            connectedBtoA: connectedBy[1].has(addrA),
            connectResults,
            rtcCreated: rtcConnections.length,
            rtcConnected: rtcConnections.filter((r) => r.reachedConnected)
                .length
        };
    } finally {
        for (const handle of bridgeHandles) {
            try {
                handle.dispose();
            } catch {
                // ignore
            }
        }
        for (const worker of workers) {
            try {
                worker.terminate();
            } catch {
                // ignore
            }
        }
    }
};
