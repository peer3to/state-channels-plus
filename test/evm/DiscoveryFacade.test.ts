import { expect } from "chai";
import { ethers, NonceManager } from "ethers";
import { Buffer } from "buffer";

import { EvmStateMachine } from "@/evm";
import type P2pInstance from "@/evm/P2pInstance";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { deployFullStack } from "../../scripts/V1/deploy";
import {
    slotAccountIndex,
    slotDeployerIndex
} from "@test/harness/core/slotAccounts";
import {
    MathStateMachine__factory,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import { ContractFactory } from "ethers";
import { startHardhatNode, type NodeHandle } from "@test/utils/nodeInfra";
import type { Config } from "@/utils/config";
import {
    AdKind,
    CHANNEL_AD_VERSION,
    type ChannelAdStruct
} from "@/discovery/ChannelAd";
import { waitFor } from "@test/utils/waitFor";
import path from "node:path";

const discoveryRpcManifest = {
    module: path.resolve(
        __dirname,
        "../fixtures/customRpc/DiscoveryRpcManifest.ts"
    )
};

const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";
// ChannelAdStruct.app is bytes32 (ChannelAdEthersType) - config.LOBBY_APP_NAMESPACE
// (and the ad's own `app` field) must be a valid bytes32 hex string, exactly
// mirroring how LocalP2pSigner.resolveAppNamespace pads the address fallback.
const TEST_APP_NAMESPACE = ethers.hexlify(ethers.randomBytes(32));

let hardhatNodeUrl = process.env.HARDHAT_NODE_URL;

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

/** Asserts a value round-trips through structuredClone unharmed - the F5 clone-safety proof for every request/response on the discovery facade. */
function assertCloneable<T>(value: T, label: string): void {
    let cloned: unknown;
    expect(() => {
        cloned = globalThis.structuredClone(value);
    }, `${label} must be structured-clone-able`).to.not.throw();
    expect(cloned).to.deep.equal(value);
}

type Deployment = {
    scmDeployment: Awaited<ReturnType<typeof deployFullStack>>;
    deployedStateMachine: ReturnType<typeof MathStateMachine__factory.connect>;
};

async function deployStack(): Promise<Deployment> {
    if (!hardhatNodeUrl) throw new Error("Hardhat node URL is not initialized");
    const provider = new ethers.JsonRpcProvider(hardhatNodeUrl);
    const deployerWallet = ethers.HDNodeWallet.fromPhrase(
        DEFAULT_HARDHAT_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${slotDeployerIndex()}`
    );
    const deployerSigner = new NonceManager(deployerWallet.connect(provider));

    const scmDeployment = await deployFullStack(deployerSigner, {
        stateMachineArtifact: MathStateMachineArtifact as any,
        consumerFacetArtifact: MathConsumerFacetArtifact as any,
        stateMachineArgs: [5_000_000],
        consumerFacetArgs: [],
        timeConfig: {
            p2pTime: 1,
            agreementTime: 1,
            chainFallbackTime: 1,
            evidenceTime: 1
        },
        disputeExecutionGasLimit: 1_000_000
    });

    const deployedStateMachine = MathStateMachine__factory.connect(
        ethers.ZeroAddress,
        provider
    );

    return { scmDeployment, deployedStateMachine };
}

async function setupP2pInstance(
    deployment: Deployment,
    options: {
        localIndex: number;
        runSdkInThread: boolean;
        config?: Partial<Config>;
        /** Explicit override; `null` opts OUT of the DiscoveryRpc manifest entirely (bare MainRpcService - LobbyService unavailable). */
        customRpcManifest?: { module: string } | null;
    }
): Promise<P2pInstance<any>> {
    if (!hardhatNodeUrl) throw new Error("Hardhat node URL is not initialized");
    const provider = new ethers.JsonRpcProvider(hardhatNodeUrl);
    const runtimeWallet = ethers.HDNodeWallet.fromPhrase(
        DEFAULT_HARDHAT_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${slotAccountIndex(options.localIndex)}`
    );
    const runtimeSigner = runtimeWallet.connect(provider);

    const deployStateMachine = async (stateMachineSigner: ethers.Signer) => {
        const stateMachineFactory = new ContractFactory(
            MathStateMachineArtifact.abi,
            MathStateMachineArtifact.bytecode,
            stateMachineSigner
        );
        const tx = await stateMachineSigner.sendTransaction(
            await stateMachineFactory.getDeployTransaction(5_000_000)
        );
        const receipt = await tx.wait();
        if (!receipt?.contractAddress) {
            throw new Error(
                "No local MathStateMachine contract address created"
            );
        }
        return receipt.contractAddress;
    };

    return EvmStateMachine.p2pSetup(
        StateChannelManagerProxy__factory.connect(
            deployment.scmDeployment.address,
            runtimeSigner
        ),
        deployment.deployedStateMachine,
        deployStateMachine,
        {
            // LobbyService is opt-in (not in MainRpcService) - wire it via
            // the same DiscoveryRpc manifest OpenChannelNegotiation's own
            // e2e coverage uses, unless a test explicitly opts out (`null`)
            // to exercise the "not wired" facade error.
            customRpcManifest:
                options.customRpcManifest === null
                    ? undefined
                    : (options.customRpcManifest ?? discoveryRpcManifest),
            config: {
                PROVIDER_URL: hardhatNodeUrl,
                RUN_SDK_IN_THREAD: options.runSdkInThread,
                VM_DEDICATED_THREAD: false,
                LOBBY_APP_NAMESPACE: TEST_APP_NAMESPACE,
                ...options.config
            },
            signerSecret: runtimeWallet.privateKey
        }
    );
}

function baseAd(overrides: Partial<ChannelAdStruct> = {}): ChannelAdStruct {
    return {
        v: CHANNEL_AD_VERSION,
        kind: AdKind.JOIN,
        channelId: ethers.hexlify(ethers.randomBytes(32)),
        advertiser: ethers.ZeroAddress, // publishAd always overwrites this
        app: TEST_APP_NAMESPACE,
        seq: 0n,
        expiresAtMs: BigInt(Date.now() + 60_000),
        capacity: 2,
        filled: 0,
        amount: 100n,
        data: "0x",
        signature: "0x",
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// Test-only fake DHT (mirrors the documented `global.Hyperswarm` seam in
// src/Holepunch.ts - "never assigned in production code, only by tests").
// The lobby rides this SAME shared swarm now (LobbyService.joinLobby calls
// `p2pManager.holepunch.join`), so this fake pairs two peers that join the
// same topic and lets the real handshake/LobbyService ad-exchange run
// end-to-end over the real runtime port, without any real DHT/network
// dependency.
// ---------------------------------------------------------------------------

type FakeDuplex = {
    on(event: string, cb: (...args: any[]) => void): void;
    write(data: Uint8Array): void;
    destroy(): void;
};

function createFakeSocketPair(): [FakeDuplex, FakeDuplex] {
    const aHandlers = new Map<string, ((...args: any[]) => void)[]>();
    const bHandlers = new Map<string, ((...args: any[]) => void)[]>();
    let destroyed = false;
    const on = (
        handlers: Map<string, ((...args: any[]) => void)[]>,
        event: string,
        cb: (...args: any[]) => void
    ) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
    };
    const fire = (
        handlers: Map<string, ((...args: any[]) => void)[]>,
        event: string,
        ...args: any[]
    ) => {
        for (const cb of handlers.get(event) ?? []) cb(...args);
    };
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        fire(aHandlers, "close");
        fire(bHandlers, "close");
    };
    // Deferred delivery (setImmediate, not synchronous): both sides of a pair
    // are handed to their respective `HolepunchTransport` (which immediately
    // starts the real init-handshake) in the same synchronous
    // registry.join() call below - a synchronous write here would reach the
    // peer before ITS "data" listener is registered on the second
    // (not-yet-run) call.
    const a: FakeDuplex = {
        on: (event, cb) => on(aHandlers, event, cb),
        write: (data) => setImmediate(() => fire(bHandlers, "data", data)),
        destroy
    };
    const b: FakeDuplex = {
        on: (event, cb) => on(bHandlers, event, cb),
        write: (data) => setImmediate(() => fire(aHandlers, "data", data)),
        destroy
    };
    return [a, b];
}

type FakeSwarmMember = {
    publicKeyHex: string;
    emitConnection: (socket: FakeDuplex, info: { publicKey: Buffer }) => void;
};

/** Topic-keyed pairing registry shared by every fake swarm instance in a test. */
class FakeSwarmRegistry {
    private readonly topics = new Map<string, Map<string, FakeSwarmMember>>();

    join(topicHex: string, member: FakeSwarmMember): void {
        let members = this.topics.get(topicHex);
        if (!members) {
            members = new Map();
            this.topics.set(topicHex, members);
        }
        for (const other of members.values()) {
            if (other.publicKeyHex === member.publicKeyHex) continue;
            const [socketForMember, socketForOther] = createFakeSocketPair();
            member.emitConnection(socketForMember, {
                publicKey: Buffer.from(other.publicKeyHex, "hex")
            });
            other.emitConnection(socketForOther, {
                publicKey: Buffer.from(member.publicKeyHex, "hex")
            });
        }
        members.set(member.publicKeyHex, member);
    }

    leave(topicHex: string, publicKeyHex: string): void {
        this.topics.get(topicHex)?.delete(publicKeyHex);
    }
}

/** One `new Hyperswarm()`-shaped fake identity, wired into `registry`. */
function createFakeHyperswarm(
    registry: FakeSwarmRegistry,
    publicKeyHex: string
) {
    let connectionListener: ((socket: any, info: any) => void) | undefined;
    const joinedTopics = new Set<string>();
    return {
        on: (event: string, cb: any) => {
            if (event === "connection") connectionListener = cb;
        },
        // Holepunch.setupSwarm calls this unconditionally before installing
        // its own "connection" listener (production wiring, shared by the
        // channel AND lobby planes now) - a real Hyperswarm has this method.
        removeAllListeners: (_events?: string[]) => {
            connectionListener = undefined;
        },
        join: (topic: Buffer, _opts: any) => {
            const hex = topic.toString("hex");
            joinedTopics.add(hex);
            registry.join(hex, {
                publicKeyHex,
                emitConnection: (socket, info) =>
                    connectionListener?.(socket, info)
            });
        },
        leave: (topic: Buffer) => {
            const hex = topic.toString("hex");
            joinedTopics.delete(hex);
            registry.leave(hex, publicKeyHex);
        },
        destroy: () => {
            for (const hex of joinedTopics) registry.leave(hex, publicKeyHex);
            joinedTopics.clear();
        }
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("E2E: discovery facade over the real runtime port", function () {
    let nodeHandle: NodeHandle | undefined;
    let deployment: Deployment;

    before(async function () {
        if (hardhatNodeUrl) {
            await waitForNode(hardhatNodeUrl);
        } else {
            nodeHandle = await startHardhatNode();
            hardhatNodeUrl = nodeHandle.url;
        }
        deployment = await deployStack();
    });

    after(function () {
        nodeHandle?.stop();
    });

    for (const runSdkInThread of [false, true] as const) {
        const modeLabel = runSdkInThread ? "worker" : "inline";

        describe(`${modeLabel} topology`, function () {
            it("no lobbyService wired: joinLobby() rejects with a typed error and constructs nothing", async function () {
                const p2pInstance = await setupP2pInstance(deployment, {
                    localIndex: 0,
                    runSdkInThread,
                    customRpcManifest: null
                });
                try {
                    let error: unknown;
                    try {
                        await p2pInstance.discovery.joinLobby();
                    } catch (e) {
                        error = e;
                    }
                    expect(error).to.be.instanceOf(Error);
                    expect((error as Error).message).to.match(/not enabled/);
                } finally {
                    await p2pInstance.dispose();
                }
            });

            it("round-trips every facade method over the real port, returning the declared shape and clone-safe payloads", async function () {
                const p2pInstance = await setupP2pInstance(deployment, {
                    localIndex: 0,
                    runSdkInThread
                });
                try {
                    const joinResult = await p2pInstance.discovery.joinLobby();
                    assertCloneable(joinResult, "joinLobby() response");
                    expect(joinResult.topic).to.be.a("string");
                    expect(joinResult.topic).to.match(/^[0-9a-f]{64}$/);

                    const ad = baseAd();
                    assertCloneable(ad, "publishAd() request (client-side ad)");
                    const publishResult =
                        await p2pInstance.discovery.publishAd(ad);
                    assertCloneable(publishResult, "publishAd() response");
                    expect(publishResult.adId).to.be.a("string");

                    const listResult = await p2pInstance.discovery.listAds();
                    assertCloneable(listResult, "listAds() response");
                    expect(listResult.encodedAds).to.be.an("array");
                    expect(listResult.encodedAds).to.have.length(1);

                    const filteredResult = await p2pInstance.discovery.listAds({
                        kind: AdKind.JOIN
                    });
                    expect(filteredResult.encodedAds).to.have.length(1);

                    await p2pInstance.discovery.withdrawAd(publishResult.adId);

                    const afterWithdraw = await p2pInstance.discovery.listAds();
                    expect(afterWithdraw.encodedAds).to.have.length(0);

                    // acquireChannel: parallelism>1 preserves its discriminant
                    // across the port without needing any connected peer.
                    const parallelismResult =
                        await p2pInstance.discovery.acquireChannel({
                            candidates: [baseAd()],
                            parallelism: 2,
                            amount: "100"
                        });
                    assertCloneable(
                        parallelismResult,
                        "acquireChannel() response"
                    );
                    expect(parallelismResult.status).to.equal("unsupported");
                    expect(
                        (parallelismResult as { reason: string }).reason
                    ).to.equal("parallelism>1");

                    // acquireChannel: an unresolvable candidate falls back to
                    // exhausted without hanging (no lobby peer accepted it).
                    const exhaustedResult =
                        await p2pInstance.discovery.acquireChannel({
                            candidates: [
                                baseAd({
                                    advertiser:
                                        ethers.Wallet.createRandom().address
                                })
                            ],
                            amount: "100"
                        });
                    assertCloneable(
                        exhaustedResult,
                        "acquireChannel() exhausted response"
                    );
                    expect(exhaustedResult.status).to.equal("exhausted");

                    await p2pInstance.discovery.leaveLobby();
                } finally {
                    await p2pInstance.dispose();
                }
            });

            it("p2pInstance.dispose() disposes the lobby and its swarm with no leaked interval/socket", async function () {
                const p2pInstance = await setupP2pInstance(deployment, {
                    localIndex: 0,
                    runSdkInThread
                });
                await p2pInstance.discovery.joinLobby();
                await p2pInstance.discovery.publishAd(baseAd());
                // No explicit teardown assertion beyond a clean dispose(): a
                // leaked setInterval (the ad TTL sweeper) or open swarm socket
                // would otherwise keep this process's event loop alive past
                // the test run (mocha would hang/timeout on `after`).
                await p2pInstance.dispose();
            });
        });
    }

    // Dual-peer discovery events (lobbyPeer/ad/adExpired/acquireStage) need
    // two REAL authenticated, handshake-completed lobby peers - only
    // reachable in the inline topology, since a worker thread has its own
    // isolated `global` (the `global.Hyperswarm` test seam can't reach into
    // it).
    describe("inline topology: two-peer discovery bus events", function () {
        it("ad, adExpired, lobbyPeer and acquireStage all arrive on p2pInstance.events on the main thread", async function () {
            const registry = new FakeSwarmRegistry();
            const originalHyperswarm = (global as any).Hyperswarm;

            // Setup itself never touches the swarm (Holepunch's swarm is
            // only created lazily, from inside joinLobby()) - so both
            // instances can be built first; `global.Hyperswarm` only needs
            // to be set right before each peer's OWN joinLobby() call
            // below. DEBUG_LOCAL_TRANSPORT is forced off here (the harness
            // default the rest of this suite otherwise inherits): this test
            // exercises the REAL `holepunch.join` path over the faked
            // swarm, not the DEBUG_LOCAL_TRANSPORT skip LobbyService.joinLobby
            // also has (mirroring P2PManager.tryOpenConnectionToChannel) for
            // harnesses that wire local peer discovery themselves.
            const peerA = await setupP2pInstance(deployment, {
                localIndex: 0,
                runSdkInThread: false,
                config: { DEBUG_LOCAL_TRANSPORT: false }
            });
            const peerB = await setupP2pInstance(deployment, {
                localIndex: 1,
                runSdkInThread: false,
                config: { DEBUG_LOCAL_TRANSPORT: false }
            });

            try {
                const lobbyPeerEvents: {
                    address: string;
                    connected: boolean;
                }[] = [];
                peerA.events.on("discovery", "lobbyPeer", (payload) => {
                    lobbyPeerEvents.push(payload);
                });
                const adEvents: { adId: string }[] = [];
                peerA.events.on("discovery", "ad", (payload) => {
                    assertCloneable(payload, "ad bus event payload");
                    adEvents.push(payload);
                });
                const adExpiredEvents: { adId: string; reason: string }[] = [];
                peerA.events.on("discovery", "adExpired", (payload) => {
                    assertCloneable(payload, "adExpired bus event payload");
                    adExpiredEvents.push(payload);
                });
                const acquireStageEvents: { stage: string; outcome: string }[] =
                    [];
                peerA.events.on("discovery", "acquireStage", (payload) => {
                    assertCloneable(payload, "acquireStage bus event payload");
                    acquireStageEvents.push(payload);
                });

                (global as any).Hyperswarm = createFakeHyperswarm(
                    registry,
                    "aa"
                );
                await peerA.discovery.joinLobby();
                (global as any).Hyperswarm = createFakeHyperswarm(
                    registry,
                    "bb"
                );
                await peerB.discovery.joinLobby();

                await waitFor(() => lobbyPeerEvents.length > 0, 5000);
                expect(lobbyPeerEvents[0].connected).to.equal(true);

                const peerBAddress = await peerB.chainSigner.getAddress();
                const ad = baseAd({ advertiser: peerBAddress });
                await peerB.discovery.publishAd(ad);
                await waitFor(() => adEvents.length > 0, 5000);
                expect(adEvents[0].adId).to.be.a("string");

                const withdrawnAdId = adEvents[0].adId;
                await peerB.discovery.withdrawAd(withdrawnAdId);
                await waitFor(() => adExpiredEvents.length > 0, 5000);
                expect(adExpiredEvents[0].reason).to.equal("withdrawn");

                // acquireStage: a candidate naming a peer that never accepted
                // (declines the requestIntent it never received a hold for -
                // here, unauthenticated/unknown) records at least one stage.
                await peerA.discovery.acquireChannel({
                    candidates: [
                        baseAd({
                            advertiser: ethers.Wallet.createRandom().address
                        })
                    ],
                    amount: "100"
                });
                await waitFor(() => acquireStageEvents.length > 0, 5000);
            } finally {
                (global as any).Hyperswarm = originalHyperswarm;
                await Promise.all([peerA.dispose(), peerB.dispose()]);
            }
        });
    });
});
