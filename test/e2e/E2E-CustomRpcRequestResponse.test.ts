import { expect } from "chai";
import { BytesLike, NonceManager, ethers } from "ethers";

import type P2pInstance from "@/evm/P2pInstance";
import { Codec, LocalDiscoveryServer, SignatureUtils, Type } from "@/utils";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { waitFor } from "@test/utils/waitFor";
import {
    slotAccountIndex,
    slotDeployerIndex
} from "@test/harness/core/slotAccounts";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { deployFullStack } from "../../scripts/V1/deploy";
import {
    MathStateMachine,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import type {
    PingPongRpc,
    SumResponse
} from "@test/fixtures/customRpc/PingPongRpcManifest";
import {
    startDiscoveryRegistry,
    startHardhatNode,
    type DiscoveryHandle,
    type NodeHandle
} from "@test/utils/nodeInfra";
import { createPingPeer } from "@test/fixtures/customRpc/createPingPeer";

let hardhatNodeUrl = process.env.HARDHAT_NODE_URL;
let localDiscoveryRegistryUrl = process.env.LOCAL_DISCOVERY_REGISTRY_URL;
const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

type PingPeer = P2pInstance<MathStateMachine, PingPongRpc>;

async function waitForNode(url: string): Promise<void> {
    const provider = new ethers.JsonRpcProvider(url);
    await waitFor(async () => {
        try {
            await provider.getBlockNumber();
            return true;
        } catch {
            return false;
        }
    }, 30_000);
}

function walletAt(
    index: number,
    provider: ethers.Provider
): ethers.HDNodeWallet {
    return ethers.HDNodeWallet.fromPhrase(
        DEFAULT_HARDHAT_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${index}`
    ).connect(provider) as ethers.HDNodeWallet;
}

describe("E2E: custom RPC request/response over the runtime port", function () {
    let peers: PingPeer[] = [];
    let nodeHandle: NodeHandle | undefined;
    let discoveryHandle: DiscoveryHandle | undefined;

    before(async function () {
        this.timeout(60_000);
        if (hardhatNodeUrl) {
            await waitForNode(hardhatNodeUrl);
        } else {
            nodeHandle = await startHardhatNode();
            hardhatNodeUrl = nodeHandle.url;
        }
        if (!localDiscoveryRegistryUrl) {
            discoveryHandle = await startDiscoveryRegistry();
            localDiscoveryRegistryUrl = discoveryHandle.url;
        }
    });

    afterEach(async function () {
        this.timeout(30_000);
        await Promise.allSettled(peers.map((peer) => peer.dispose()));
        peers = [];
        await LocalDiscoveryServer.cleanup();
    });

    after(function () {
        discoveryHandle?.stop();
        nodeHandle?.stop();
    });

    it("lets a client drive hostRpc.request()/sendOne() across the port (self + peer)", async function () {
        this.timeout(120_000);

        if (!hardhatNodeUrl) {
            throw new Error("Hardhat node URL is not initialized");
        }
        if (!localDiscoveryRegistryUrl) {
            throw new Error("Local discovery registry URL is not initialized");
        }
        const provider = new ethers.JsonRpcProvider(hardhatNodeUrl);
        const deployerSigner = new NonceManager(
            walletAt(slotDeployerIndex(), provider)
        );
        const peer0Wallet = walletAt(slotAccountIndex(0), provider);
        const peer1Wallet = walletAt(slotAccountIndex(1), provider);
        const peer0Address = peer0Wallet.address;
        const peer1Address = peer1Wallet.address;

        // Deploy the shared on-chain stack once.
        const scmDeployment = await deployFullStack(deployerSigner, {
            stateMachineArtifact: MathStateMachineArtifact as any,
            consumerFacetArtifact: MathConsumerFacetArtifact as any,
            stateMachineArgs: [5_000_000],
            consumerFacetArgs: [],
            timeConfig: {
                p2pTime: 1,
                agreementTime: 10,
                chainFallbackTime: 2,
                evidenceTime: 2
            },
            disputeExecutionGasLimit: 1_000_000
        });

        // Track connection completion via client-side p2p event hooks (these
        // cross the port from the host). No host/state-manager access is used.
        const connectedTo = new Map<string, Set<string>>([
            [peer0Address, new Set<string>()],
            [peer1Address, new Set<string>()]
        ]);

        const peer0 = await createPingPeer({
            runtimeWallet: peer0Wallet,
            stateChannelManagerAddress: scmDeployment.address,
            providerUrl: hardhatNodeUrl,
            discoveryUrl: localDiscoveryRegistryUrl,
            // Track connection completion via a client-side p2p event listener
            // (forwarded over the port from the host).
            onConnection: (address) => {
                connectedTo
                    .get(peer0Address)
                    ?.add(String(address).toLowerCase());
            }
        });
        peers.push(peer0);
        const peer1 = await createPingPeer({
            runtimeWallet: peer1Wallet,
            stateChannelManagerAddress: scmDeployment.address,
            providerUrl: hardhatNodeUrl,
            discoveryUrl: localDiscoveryRegistryUrl,
            onConnection: (address) => {
                connectedTo
                    .get(peer1Address)
                    ?.add(String(address).toLowerCase());
            }
        });
        peers.push(peer1);

        // Open a channel with both participants, driven entirely from the
        // client side (connectToChannel forwards over the port; the host wires
        // up local discovery and the handshake).
        const openChannel = createOpenChannelTestObject([
            peer0Address,
            peer1Address
        ]);
        const signatures: BytesLike[] = await Promise.all(
            [peer0Wallet, peer1Wallet].map((wallet) =>
                SignatureUtils.signOpenChannel(openChannel, wallet).then(
                    (s) => s.signature as BytesLike
                )
            )
        );

        const channelId = ethers.hexlify(openChannel.channelId);
        await peer0.hostRpc.network.connectToChannel(channelId).request();
        await peer1.hostRpc.network.connectToChannel(channelId).request();

        const channelManager = StateChannelManagerProxy__factory.connect(
            scmDeployment.address,
            deployerSigner
        );
        const openTx = await channelManager.open({
            encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
            signatures
        });
        await openTx.wait();

        // Wait until both peers report a completed handshake to each other.
        await waitFor(
            () =>
                connectedTo
                    .get(peer0Address)
                    ?.has(peer1Address.toLowerCase()) === true &&
                connectedTo
                    .get(peer1Address)
                    ?.has(peer0Address.toLowerCase()) === true,
            20_000
        );

        // --- Self-call (no target): runs on the peer's own host (loopback) ---
        const sumSelf: SumResponse = await peer0.hostRpc.pingService
            .sum(1, 2, "sum-self-0")
            .request({ timeoutMs: 5000 });
        expect(sumSelf.sum).to.equal(3);
        expect(sumSelf.nonce).to.equal("sum-self-0");
        expect(sumSelf.requester?.toLowerCase()).to.equal(
            peer0Address.toLowerCase()
        );

        // --- Request/response: peer0 -> peer1 ---
        const sum0: SumResponse = await peer0.hostRpc.pingService
            .sum(20, 22, "sum-from-0")
            .request(peer1Address, { timeoutMs: 5000 });
        expect(sum0.sum).to.equal(42);
        expect(sum0.nonce).to.equal("sum-from-0");
        expect(sum0.requester?.toLowerCase()).to.equal(
            peer0Address.toLowerCase()
        );

        // --- Request/response: peer1 -> peer0 ---
        const sum1: SumResponse = await peer1.hostRpc.pingService
            .sum(4, 7, "sum-from-1")
            .request(peer0Address, { timeoutMs: 5000 });
        expect(sum1.sum).to.equal(11);
        expect(sum1.nonce).to.equal("sum-from-1");
        expect(sum1.requester?.toLowerCase()).to.equal(
            peer1Address.toLowerCase()
        );

        // --- Fire-and-forget over the port resolves without error ---
        await peer0.hostRpc.pingService.ping("from-0").sendOne(peer1Address);

        // --- Remote handler error is propagated back across the port ---
        let requestError: unknown;
        try {
            await peer0.hostRpc.pingService
                .fail("intentional-request-failure")
                .request(peer1Address, { timeoutMs: 5000 });
        } catch (error) {
            requestError = error;
        }
        expect(requestError).to.be.instanceOf(Error);
        expect((requestError as Error).message).to.include(
            "intentional-request-failure"
        );
    });

    it("recovers discovery retries and cancels them during cleanup", async function () {
        this.timeout(120_000);
        if (!hardhatNodeUrl) {
            throw new Error("Hardhat node URL is not initialized");
        }

        const retryRegistry = await startDiscoveryRegistry({
            port: 0,
            label: "failure-enabled discovery",
            env: {
                LOCAL_DISCOVERY_FAIL_FIRST_CONNECTIONS: "2"
            }
        });
        let pendingRegistry: DiscoveryHandle | undefined;
        try {
            expect(new URL(retryRegistry.url).port).to.not.equal("0");
            const provider = new ethers.JsonRpcProvider(hardhatNodeUrl);
            const deployerSigner = new NonceManager(
                walletAt(slotDeployerIndex(), provider)
            );
            const scmDeployment = await deployFullStack(deployerSigner, {
                stateMachineArtifact: MathStateMachineArtifact as any,
                consumerFacetArtifact: MathConsumerFacetArtifact as any,
                stateMachineArgs: [5_000_000],
                consumerFacetArgs: [],
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 10,
                    chainFallbackTime: 2,
                    evidenceTime: 2
                },
                disputeExecutionGasLimit: 1_000_000
            });
            const peer0Wallet = walletAt(slotAccountIndex(0), provider);
            const peer1Wallet = walletAt(slotAccountIndex(1), provider);
            let peer0Connections = 0;
            let peer1Connections = 0;

            const peer0 = await createPingPeer({
                runtimeWallet: peer0Wallet,
                stateChannelManagerAddress: scmDeployment.address,
                providerUrl: hardhatNodeUrl,
                discoveryUrl: retryRegistry.url,
                onConnection: () => {
                    peer0Connections++;
                }
            });
            peers.push(peer0);
            const peer1 = await createPingPeer({
                runtimeWallet: peer1Wallet,
                stateChannelManagerAddress: scmDeployment.address,
                providerUrl: hardhatNodeUrl,
                discoveryUrl: retryRegistry.url,
                onConnection: () => {
                    peer1Connections++;
                }
            });
            peers.push(peer1);

            const channelId = ethers.keccak256(
                ethers.toUtf8Bytes("local-discovery-retry-lifecycle")
            );
            await peer0.hostRpc.network.connectToChannel(channelId).request();
            await peer1.hostRpc.network.connectToChannel(channelId).request();

            await waitFor(
                () =>
                    retryRegistry.getConnectionCount() >= 4 &&
                    peer0Connections === 1 &&
                    peer1Connections === 1,
                20_000
            );
            const stableRegistryConnections =
                retryRegistry.getConnectionCount();
            await new Promise((resolve) => setTimeout(resolve, 1200));
            expect(retryRegistry.getConnectionCount()).to.equal(
                stableRegistryConnections
            );
            expect(peer0Connections).to.equal(1);
            expect(peer1Connections).to.equal(1);

            pendingRegistry = await startDiscoveryRegistry({
                port: 0,
                label: "pending-retry discovery",
                env: {
                    LOCAL_DISCOVERY_FAIL_FIRST_CONNECTIONS: "100"
                }
            });
            const peer2Wallet = walletAt(slotAccountIndex(2), provider);
            const peer2 = await createPingPeer({
                runtimeWallet: peer2Wallet,
                stateChannelManagerAddress: scmDeployment.address,
                providerUrl: hardhatNodeUrl,
                discoveryUrl: pendingRegistry.url
            });
            peers.push(peer2);
            await peer2.hostRpc.network.connectToChannel(channelId).request();
            await waitFor(
                () => pendingRegistry?.getConnectionCount() === 1,
                5000
            );

            await peer2.hostRpc.network.cleanupLocalDiscovery().sendOne();
            const countAfterCleanup = pendingRegistry.getConnectionCount();
            await new Promise((resolve) => setTimeout(resolve, 1200));
            expect(pendingRegistry.getConnectionCount()).to.equal(
                countAfterCleanup
            );
        } finally {
            pendingRegistry?.stop();
            retryRegistry.stop();
        }
    });
});
