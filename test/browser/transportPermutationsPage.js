// @spec-test-coverage-ignore: browser page driver for the transport permutation gates; evidence is mapped from run-transport-*-e2e.mjs
import {
    DEFAULT_HARDHAT_MNEMONIC,
    deployStack,
    setupBrowserPeer
} from "./sdkSetup.js";
import { Codec, SignatureUtils, Type } from "@/utils";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import { ethers, NonceManager } from "ethers";

/**
 * One page hosts one SDK runtime (SDK in its own worker, WebRTC on this main
 * thread through the auto-installed bridge). The gate drives several pages
 * through `globalThis.__transportE2E`; `__TRANSPORT_E2E__` says which
 * bootstrap transport the runtime discovers peers with.
 */

const pageConfig = globalThis.__TRANSPORT_E2E__;

/**
 * Every RTCPeerConnection this page drives. Their data channels are
 * transferred to the SDK worker, so the page cuts WebRTC at the connection.
 */
const rtcConnections = [];
const NativeRTCPeerConnection = globalThis.RTCPeerConnection;
globalThis.RTCPeerConnection = class extends NativeRTCPeerConnection {
    constructor(...args) {
        super(...args);
        rtcConnections.push(this);
    }
};

function hardhatWallet(index) {
    return ethers.HDNodeWallet.fromPhrase(
        DEFAULT_HARDHAT_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${index}`
    );
}

function transportConfig() {
    if (pageConfig.mode === "local")
        return {
            DEBUG_LOCAL_TRANSPORT: true,
            LOCAL_DISCOVERY_REGISTRY_URL: pageConfig.relayUrl,
            HOLEPUNCH_RELAYER_URLS: []
        };
    return {
        DEBUG_LOCAL_TRANSPORT: false,
        LOCAL_DISCOVERY_REGISTRY_URL: "",
        HOLEPUNCH_RELAYER_URLS: [pageConfig.relayUrl]
    };
}

let peer;
let address;
const observed = {
    finalized: 0,
    ownTurns: 0,
    playErrors: [],
    disconnections: 0
};

globalThis.__transportE2E = {
    async deploy() {
        const stack = await deployStack(pageConfig.providerUrl, false);
        stack.provider.destroy();
        return { scmAddress: stack.scmAddress };
    },

    /** Opens `channelId` on chain with the given wallets as participants. */
    async openChannel({ scmAddress, channelId, participantIndices }) {
        const provider = new ethers.JsonRpcProvider(pageConfig.providerUrl);
        try {
            const participants = participantIndices.map(hardhatWallet);
            const latestBlock = await provider.getBlock("latest");
            const openChannel = {
                channelId,
                participants: participants.map((wallet) => wallet.address),
                balances: participants.map(() => ({
                    amount: 500n,
                    data: "0x1234"
                })),
                deadlineTimestamp: BigInt(latestBlock.timestamp + 120),
                isAtomic: true,
                data: "0x"
            };
            const signatures = await Promise.all(
                participants.map((wallet) =>
                    SignatureUtils.signOpenChannel(openChannel, wallet)
                )
            );
            const manager = connectStateChannelManager(
                scmAddress,
                new NonceManager(hardhatWallet(0).connect(provider))
            );
            await (
                await manager.open({
                    encodedOpenChannel: Codec.encode(
                        openChannel,
                        Type.OpenChannel
                    ),
                    signatures: signatures.map(({ signature }) => signature)
                })
            ).wait();
        } finally {
            provider.destroy();
        }
    },

    /** Starts this page's runtime; it authors a block on every own turn. */
    async start({ scmAddress, walletIndex }) {
        const wallet = hardhatWallet(walletIndex);
        address = wallet.address;
        peer = await setupBrowserPeer(
            wallet,
            pageConfig.providerUrl,
            scmAddress,
            {
                peerId: walletIndex,
                config: {
                    RUN_SDK_IN_THREAD: true,
                    LOG_LEVEL: pageConfig.logLevel,
                    CRASH_LOG_UPLOAD_ENDPOINT: "",
                    ...transportConfig()
                }
            }
        );
        peer.events.on("p2pEventHooks", "onBlockFinalized", () => {
            observed.finalized++;
        });
        peer.events.on("p2pEventHooks", "onDisconnection", () => {
            observed.disconnections++;
        });
        peer.events.on("p2pEventHooks", "onTurn", (turnAddress) => {
            if (!ethers.isAddress(turnAddress)) return;
            if (ethers.getAddress(turnAddress) !== address) return;
            observed.ownTurns++;
            peer.p2pContractInstance.add(1).catch((error) => {
                observed.playErrors.push(String(error?.message ?? error));
            });
        });
        return address;
    },

    joinLobby(topic) {
        return peer.p2pSigner.joinLobby(topic);
    },

    connectToChannel(channelId) {
        return peer.p2pSigner.connectToChannel(channelId);
    },

    async state() {
        const [status, connections] = await Promise.all([
            peer.p2pSigner.getChannelStatus(),
            peer.p2pSigner.getOpenConnections()
        ]);
        return {
            address,
            status,
            connections,
            ...observed,
            rtcOpen: rtcConnections.filter(
                (connection) => connection.connectionState === "connected"
            ).length
        };
    },

    /** Closes every connected WebRTC connection, as a dead direct path. */
    closeWebRtc() {
        const connected = rtcConnections.filter(
            ({ connectionState }) => connectionState === "connected"
        );
        for (const connection of connected) connection.close();
        return connected.length;
    },

    dispose() {
        return peer?.dispose();
    }
};
