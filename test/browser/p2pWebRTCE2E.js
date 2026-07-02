import { ethers, NonceManager, ContractFactory } from "ethers";

import { EvmStateMachine } from "@/evm";
import Clock from "@/Clock";
import {
    MathStateMachine__factory,
    StateChannelManagerProxy__factory
} from "@typechain-types";
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
 * main -> worker), with all real components and real on-chain channel data.
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
 * same-origin RPC proxy) and derive a shared channel id for discovery. The two
 * peers rendezvous on this id and connect over WebRTC; the on-chain channel
 * open / state sync is a separate concern from the WebRTC transport this test
 * exercises, so it's intentionally left out (no channel => the post-handshake
 * participant sync is skipped and can't tear the transport down mid-negotiation).
 */
async function deployStack(providerUrl) {
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallets = [0, 1, 2].map((index) =>
        ethers.HDNodeWallet.fromPhrase(
            DEFAULT_HARDHAT_MNEMONIC,
            undefined,
            `m/44'/60'/0'/0/${index}`
        )
    );
    const [deployerWallet, peerAWallet, peerBWallet] = wallets;
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

    // A stable 32-byte channel id both peers rendezvous on (same derivation the
    // channel-open path uses), without opening an on-chain channel.
    const channelId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["string"],
            ["browser-webrtc-e2e"]
        )
    );

    return {
        provider,
        scmAddress: scmDeployment.address,
        channelId,
        peerWallets: [peerAWallet, peerBWallet]
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
        runtimeSigner,
        StateChannelManagerProxy__factory.connect(scmAddress, runtimeSigner),
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

    const { scmAddress, channelId, peerWallets } = await deployStack(
        config.providerUrl
    );

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
    const [peerA, peerB] = peerInstances;

    const connectedBy = peerInstances.map(() => new Set());
    peerInstances.forEach((peer, index) => {
        peer.on("onConnection", (address) => {
            connectedBy[index].add(String(address).toLowerCase());
        });
    });

    // Both worker peers surface a bridge port (they can't drive
    // RTCPeerConnection themselves) — proof the #380 surfacing fired.
    const bridgePorts = peerInstances.map((peer) =>
        Boolean(peer.webRTCBridgePort)
    );

    try {
        await Promise.all(
            peerInstances.map((peer) =>
                peer.p2pSigner.connectToChannel(channelId)
            )
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
            rtcCreated: rtcConnections.length,
            rtcConnected: rtcConnections.filter((r) => r.reachedConnected)
                .length
        };
    } finally {
        await Promise.allSettled([peerA.dispose(), peerB.dispose()]);
    }
};
