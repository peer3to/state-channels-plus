import { expect } from "chai";
import {
    BytesLike,
    ContractFactory,
    NonceManager,
    Signer,
    ethers
} from "ethers";
import path from "node:path";

import { EvmStateMachine } from "@/evm";
import type P2pInstance from "@/evm/P2pInstance";
import { Codec, LocalDiscoveryServer, SignatureUtils, Type } from "@/utils";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { waitFor } from "@test/utils/waitFor";
import {
    slotAccountIndex,
    slotDeployerIndex
} from "@test/harness/core/slotAccounts";
import { protocolEventTimeoutMs } from "@test/harness/core/testTimeConfig";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { deployFullStack } from "../../scripts/V1/deploy";
import {
    MathStateMachine,
    MathStateMachine__factory,
    StateChannelManagerInterface__factory
} from "@typechain-types";
import type {
    PingPongRpc,
    SumResponse
} from "@test/fixtures/customRpc/PingPongRpcManifest";
import {
    startDiscoveryRegistry,
    startHardhatNode,
    waitForHardhatNode,
    type DiscoveryHandle,
    type NodeHandle
} from "@test/utils/nodeInfra";

let hardhatNodeUrl = process.env.HARDHAT_NODE_URL;
let localDiscoveryRegistryUrl = process.env.LOCAL_DISCOVERY_REGISTRY_URL;

const TEST_TIME_CONFIG = {
    p2pTime: 1,
    agreementTime: 10,
    chainFallbackTime: 2,
    evidenceTime: 2
};
const TEST_PROTOCOL_TIMEOUT_MS = protocolEventTimeoutMs(TEST_TIME_CONFIG, {
    withFirstBlockGrace: true
});
const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

const PING_PONG_MANIFEST = path.resolve(
    __dirname,
    "../fixtures/customRpc/PingPongRpcManifest.ts"
);

type PingPeer = P2pInstance<MathStateMachine, PingPongRpc>;

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

/** Deploys a fresh local MathStateMachine and returns its address. */
async function deployLocalStateMachine(signer: Signer): Promise<string> {
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

describe("E2E: custom RPC request/response over the runtime port", function () {
    let peers: PingPeer[] = [];
    let nodeHandle: NodeHandle | undefined;
    let discoveryHandle: DiscoveryHandle | undefined;

    before(async function () {
        if (hardhatNodeUrl) {
            await waitForHardhatNode(hardhatNodeUrl);
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
        await Promise.allSettled(peers.map((peer) => peer.dispose()));
        peers = [];
        await LocalDiscoveryServer.cleanup();
    });

    after(function () {
        discoveryHandle?.stop();
        nodeHandle?.stop();
    });

    it("lets a client drive hostRpc.request()/sendOne() across the port (self + peer)", async function () {
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
            timeConfig: TEST_TIME_CONFIG,
            disputeExecutionGasLimit: 1_000_000
        });

        // Track connection completion via client-side p2p event hooks (these
        // cross the port from the host). No host/state-manager access is used.
        const connectedTo = new Map<string, Set<string>>([
            [peer0Address, new Set<string>()],
            [peer1Address, new Set<string>()]
        ]);

        const makePeer = async (
            runtimeWallet: ethers.HDNodeWallet,
            selfAddress: string
        ): Promise<PingPeer> => {
            const runtimeSigner = runtimeWallet;
            const scm = StateChannelManagerInterface__factory.connect(
                scmDeployment.address,
                runtimeSigner
            );
            const stateMachineTemplate = MathStateMachine__factory.connect(
                ethers.ZeroAddress,
                runtimeSigner
            );

            const instance = await EvmStateMachine.p2pSetup<
                MathStateMachine,
                PingPongRpc
            >(scm, stateMachineTemplate, deployLocalStateMachine, {
                signerSecret: runtimeWallet.privateKey,
                customRpcManifest: { module: PING_PONG_MANIFEST },
                config: {
                    PROVIDER_URL: hardhatNodeUrl,
                    LOCAL_DISCOVERY_REGISTRY_URL: localDiscoveryRegistryUrl,
                    RUN_SDK_IN_THREAD: false,
                    VM_DEDICATED_THREAD: false,
                    DEBUG_LOCAL_TRANSPORT: true
                }
            });

            // Track connection completion via a client-side p2p event listener
            // (forwarded over the port from the host).
            instance.events.on("p2pEventHooks", "onConnection", (address) => {
                connectedTo
                    .get(selfAddress)
                    ?.add(String(address).toLowerCase());
            });

            return instance;
        };

        const peer0 = await makePeer(peer0Wallet, peer0Address);
        peers.push(peer0);
        const peer1 = await makePeer(peer1Wallet, peer1Address);
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

        const channelManager = StateChannelManagerInterface__factory.connect(
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
            TEST_PROTOCOL_TIMEOUT_MS
        );

        // --- Self-call (no target): runs on the peer's own host (loopback) ---
        const sumSelf: SumResponse = await peer0.hostRpc.pingService
            .sum(1, 2, "sum-self-0")
            .request({ timeoutMs: TEST_PROTOCOL_TIMEOUT_MS });
        expect(sumSelf.sum).to.equal(3);
        expect(sumSelf.nonce).to.equal("sum-self-0");
        expect(sumSelf.requester?.toLowerCase()).to.equal(
            peer0Address.toLowerCase()
        );

        // --- Request/response: peer0 -> peer1 ---
        const sum0: SumResponse = await peer0.hostRpc.pingService
            .sum(20, 22, "sum-from-0")
            .request(peer1Address, {
                timeoutMs: TEST_PROTOCOL_TIMEOUT_MS
            });
        expect(sum0.sum).to.equal(42);
        expect(sum0.nonce).to.equal("sum-from-0");
        expect(sum0.requester?.toLowerCase()).to.equal(
            peer0Address.toLowerCase()
        );

        // --- Request/response: peer1 -> peer0 ---
        const sum1: SumResponse = await peer1.hostRpc.pingService
            .sum(4, 7, "sum-from-1")
            .request(peer0Address, {
                timeoutMs: TEST_PROTOCOL_TIMEOUT_MS
            });
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
                .request(peer1Address, {
                    timeoutMs: TEST_PROTOCOL_TIMEOUT_MS
                });
        } catch (error) {
            requestError = error;
        }
        expect(requestError).to.be.instanceOf(Error);
        expect((requestError as Error).message).to.include(
            "intentional-request-failure"
        );
    });
});
