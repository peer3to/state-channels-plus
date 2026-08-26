import { expect } from "chai";
import { describe, it, before, after, beforeEach, afterEach } from "mocha";
import sinon from "sinon";
import { ethers, type Provider } from "ethers";

import { createLogger, getChecksumAddress } from "@/utils";
import { config } from "@/utils/config";
import { EventBus } from "@/events/EventBus";
import { Status } from "@/types";
import Clock from "@/Clock";
import LobbyService from "@/rpc/services/lobby/LobbyService";
import type { LobbyP2PManager } from "@/rpc/services/lobby/LobbyRpcMethods";
import {
    AdKind,
    CHANNEL_AD_VERSION,
    type ChannelAdStruct
} from "@/discovery/ChannelAd";
import LocalP2pSigner from "@/evm/signer/LocalP2pSigner";
import type P2PManager from "@/P2PManager";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import type { OpenChannelNegotiationP2PManager } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods";
import {
    ChannelAcquisitionCoordinator,
    type ChannelEnumerator
} from "@/discovery/ChannelAcquisitionCoordinator";

/**
 * Real coordinator against fabricated candidates (test/AGENTS.md): the LOBBY
 * side is a REAL `LobbyService` per peer, cross-wired through a fake
 * `remoteRpc.lobbyService` that resolves the target peer's `LobbyService`
 * directly and calls its real `handleAdvertise`/`handleWithdraw`/
 * `handleRequestIntent`/`handleReleaseIntent` - the actual admission/
 * reservation/ad-store code runs for real, only the wire transport
 * (sockets/handshake) is stood in for. `FakeLobbyNetwork.connect` fires the
 * SAME `handshakeCompleted` bus event `P2PManager` fires in production, so
 * `LobbyService`'s own peer-discovery hook (push-own-ads-on-handshake) runs
 * unmodified. The commit path's P2PManager/StateManager collaborators are a
 * narrow typed stand-in (the SAME accepted pattern this codebase already
 * uses to test OpenChannelNegotiationService itself -
 * test/rpc/openChannelNegotiation/negotiationTestFactory.ts - "a live
 * instance can only come from a real P2PManager backed by a live
 * chain/session"): OpenChannelNegotiationService is a REAL instance, and
 * status transitions are driven through a REAL EventBus, so the
 * coordinator's own wait-for-status/timeout/fallback/security logic runs
 * for real end to end.
 */

function createTestLogger() {
    return createLogger({}, {}, { level: "error" });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
    predicate: () => boolean,
    timeoutMs = 5000,
    stepMs = 20
): Promise<void> {
    const start = Date.now();
    for (;;) {
        if (predicate()) return;
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor: condition never became true");
        }
        await sleep(stepMs);
    }
}

// Shared lobby coordinates so every LobbyService in a test derives the SAME topic.
const stateChannelManagerAddress = ethers.Wallet.createRandom().address;
const appNamespace = ethers.hexlify(ethers.randomBytes(32));

function baseAd(overrides: Partial<ChannelAdStruct> = {}): ChannelAdStruct {
    return {
        v: CHANNEL_AD_VERSION,
        kind: AdKind.JOIN,
        channelId: ethers.hexlify(ethers.randomBytes(32)),
        advertiser: ethers.ZeroAddress, // publishAd always overwrites this
        app: appNamespace,
        seq: 0n,
        expiresAtMs: BigInt(Date.now() + 60_000),
        capacity: 2,
        filled: 0,
        amount: 999n, // deliberately different from the coordinator's options.amount - ads are hints, never authority
        data: "0x",
        signature: "0x",
        ...overrides
    };
}

type TestLobbyPeer = {
    service: LobbyService;
    wallet: ethers.HDNodeWallet;
    address: string;
    events: EventBus;
};

/** Topic-agnostic pairing registry: resolves `remoteRpc.lobbyService` calls straight to the target peer's real LobbyService, and fires handshakeCompleted both ways on connect. */
class FakeLobbyNetwork {
    private readonly peersByAddress = new Map<string, TestLobbyPeer>();

    register(peer: TestLobbyPeer): void {
        this.peersByAddress.set(peer.address, peer);
    }

    resolve(address: string): TestLobbyPeer | undefined {
        return this.peersByAddress.get(getChecksumAddress(address));
    }

    /** Simulates the shared swarm's handshake completing between every pair in `peers`. */
    connect(...peers: TestLobbyPeer[]): void {
        for (const peer of peers) {
            for (const other of peers) {
                if (other === peer) continue;
                peer.events.emit("p2pEventHooks", "handshakeCompleted", [
                    other.address
                ]);
            }
        }
    }
}

function wireFakeLobbyRemoteRpc(
    selfAddress: string,
    network: FakeLobbyNetwork
) {
    return {
        lobbyService: {
            advertise: (encodedAd: string) => ({
                sendOne: (target: string) => {
                    network
                        .resolve(target)
                        ?.service.handleAdvertise(selfAddress, encodedAd);
                }
            }),
            withdraw: (adId: string) => ({
                sendOne: (target: string) => {
                    network
                        .resolve(target)
                        ?.service.handleWithdraw(selfAddress, adId);
                }
            }),
            requestIntent: (encodedAd: string, amount: string) => ({
                request: (target: string) => {
                    const targetPeer = network.resolve(target);
                    if (!targetPeer) {
                        return Promise.reject(
                            new Error(`no such lobby peer "${target}"`)
                        );
                    }
                    return targetPeer.service.handleRequestIntent(
                        selfAddress,
                        encodedAd,
                        amount
                    );
                }
            }),
            releaseIntent: (adId: string) => ({
                request: (target: string) => {
                    const targetPeer = network.resolve(target);
                    if (!targetPeer) {
                        return Promise.reject(
                            new Error(`no such lobby peer "${target}"`)
                        );
                    }
                    return targetPeer.service.handleReleaseIntent(
                        selfAddress,
                        adId
                    );
                }
            })
        }
    };
}

function createLobbyPeer(network: FakeLobbyNetwork): TestLobbyPeer {
    const wallet = ethers.Wallet.createRandom();
    const address = getChecksumAddress(wallet.address);
    const events = new EventBus();

    const p2pManager = {
        stateManager: {
            logger: createTestLogger(),
            signerAddress: address,
            events,
            signer: {
                provider: {
                    getNetwork: async () => ({ chainId: 1n }) as any
                }
            },
            stateChannelManagerContract: {
                getAddress: async () => stateChannelManagerAddress
            },
            diamondStateMachine: {
                getStateMachineAddress: () => stateChannelManagerAddress
            }
        },
        holepunch: {
            join: sinon.stub().resolves(),
            leave: sinon.stub().resolves()
        },
        profileManager: {
            getTransportByEvmAddress: () => undefined
        },
        // No pre-existing peers - `connectLobbyPeers`/`network.connect`
        // below drives discovery explicitly via the handshakeCompleted bus event.
        getHandshakeCompletedPeers: () => new Set<string>(),
        remoteRpc: wireFakeLobbyRemoteRpc(address, network),
        localRpc: {}
    } as unknown as LobbyP2PManager;

    const peer: TestLobbyPeer = {
        service: new LobbyService(p2pManager),
        wallet,
        address,
        events
    };
    network.register(peer);
    return peer;
}

/**
 * The commit-path stand-in: a real LocalP2pSigner + a real
 * OpenChannelNegotiationService, backed by a narrowly typed P2PManager cast
 * (mirrors negotiationTestFactory.ts's own justification for this exact
 * class). `advanceStatus` drives status transitions through the REAL
 * EventBus, exactly like StateManager.setStatus does in production.
 */
type FakeChannelHarness = {
    signer: LocalP2pSigner;
    events: EventBus;
    negotiationService?: OpenChannelNegotiationService;
    isChannelOpenStub: sinon.SinonStub;
    refreshStub: sinon.SinonStub;
    tryOpenConnectionStub: sinon.SinonStub;
    collectJoinChannelConfirmationStub: sinon.SinonStub;
    joinChannelStub: sinon.SinonStub;
    holepunchLeaveStub: sinon.SinonStub;
    blacklistSpy: sinon.SinonStub;
    blacklistByAddressSpy: sinon.SinonStub;
    negotiateRequestSpy: sinon.SinonStub;
    abortSpy: sinon.SinonStub;
    getStatus: () => Status;
    advanceStatus: (newStatus: Status) => void;
};

function makeFakeChannelHarness(
    wallet: ethers.HDNodeWallet,
    options: { includeNegotiationService?: boolean } = {}
): FakeChannelHarness {
    const includeNegotiationService = options.includeNegotiationService ?? true;
    let status = Status.NOT_OPENED;
    const events = new EventBus();

    const isChannelOpenStub = sinon.stub().resolves([false]);
    const refreshStub = sinon.stub().resolves();
    const tryOpenConnectionStub = sinon.stub().resolves();
    const setChannelIdStub = sinon.stub().resolves();
    const collectJoinChannelConfirmationStub = sinon.stub().resolves({
        confirmation: {
            signedJoinChannel: { encodedJoinChannel: "0x", signature: "0x" },
            signatures: []
        },
        expectedSnapshotHash: ethers.hexlify(new Uint8Array(32)),
        expectedForkId: ethers.hexlify(new Uint8Array(32))
    });
    const joinChannelStub = sinon.stub().resolves();
    const holepunchLeaveStub = sinon.stub().resolves();
    const blacklistSpy = sinon.stub();
    const blacklistByAddressSpy = sinon.stub();
    const abortSpy = sinon.stub();
    const abortSendOneSpy = sinon.stub();
    const negotiateRequestSpy = sinon.stub();
    const negotiateRequestSendOneSpy = sinon.stub();

    let negotiationService: OpenChannelNegotiationService | undefined;

    const localRpc: Record<string, unknown> = {
        joinChannelService: {
            collectJoinChannelConfirmation: collectJoinChannelConfirmationStub
        }
    };
    if (includeNegotiationService) {
        Object.defineProperty(localRpc, "openChannelNegotiationService", {
            get: () => negotiationService,
            enumerable: true
        });
    }

    const p2pManagerStub = {
        stateManager: {
            logger: createTestLogger(),
            signerAddress: wallet.address,
            signer: wallet,
            channelId: new Uint8Array(32),
            timeConfig: { agreementTime: 1 },
            diamondStateMachine: {
                localDiamondContract: { isChannelOpen: isChannelOpenStub }
            },
            refreshOpenedStatusFromChain: refreshStub,
            setChannelId: setChannelIdStub,
            // `LocalP2pSigner.getChannelStatus()` reads the StateManager
            // `status` getter, so this has to be a live getter over the
            // mutable local - a snapshot would freeze at NOT_OPENED and every
            // status wait would time out.
            get status() {
                return status;
            },
            getChannelStatus: () => Promise.resolve(status),
            // joinChannel moved off StateManager into MembershipService.
            membershipService: {
                joinChannel: joinChannelStub
            }
        },
        localRpc,
        remoteRpc: {
            openChannelNegotiationService: {
                abort: (reason: string) => {
                    abortSpy(reason);
                    return { sendOne: abortSendOneSpy };
                },
                negotiateRequest: (channelIdArg: string, amount: number) => {
                    negotiateRequestSpy(channelIdArg, amount);
                    return { sendOne: negotiateRequestSendOneSpy };
                }
            }
        },
        logger: createTestLogger(),
        tryOpenConnectionToChannel: tryOpenConnectionStub,
        holepunch: { leave: holepunchLeaveStub },
        disconnectAndBlacklistPeer: blacklistSpy,
        disconnectAndBlacklistPeerByEvmAddress: blacklistByAddressSpy
    };

    if (includeNegotiationService) {
        negotiationService = new OpenChannelNegotiationService(
            p2pManagerStub as unknown as OpenChannelNegotiationP2PManager
        );
    }

    const signer = new LocalP2pSigner(
        wallet,
        wallet.address,
        p2pManagerStub as unknown as P2PManager
    );
    // The coordinator reads `signer.p2pManager.*` directly for the pieces
    // above `stateManager`/`localRpc`/`remoteRpc` (holepunch, blacklist,
    // tryOpenConnectionToChannel) that LocalP2pSigner itself never exposes.
    // Nothing else on P2PManager is touched by the coordinator or by
    // LocalP2pSigner's own methods used here.

    return {
        signer,
        events,
        negotiationService,
        isChannelOpenStub,
        refreshStub,
        tryOpenConnectionStub,
        collectJoinChannelConfirmationStub,
        joinChannelStub,
        holepunchLeaveStub,
        blacklistSpy,
        blacklistByAddressSpy,
        negotiateRequestSpy,
        abortSpy,
        getStatus: () => status,
        advanceStatus: (newStatus: Status) => {
            const oldStatus = status;
            status = newStatus;
            events.emit("p2pEventHooks", "onStatusChanged", [
                oldStatus,
                newStatus
            ]);
        }
    };
}

describe("ChannelAcquisitionCoordinator", () => {
    let network: FakeLobbyNetwork;
    let originalTimeouts: {
        connect: number;
        sync: number;
        confirm: number;
    };

    before(async () => {
        // The JOIN commit path reads Clock.getBlockchainTime() to bound the
        // JoinChannelStruct deadline. A single-block synthetic provider is
        // enough to sync it without a real chain (mirrors
        // BenignDeclineNoBlacklist.test.ts's own justification).
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const fakeProvider = {
            getBlock: async () => ({ number: 0, timestamp: currentTimestamp })
        } as unknown as Provider;
        await Clock.init(fakeProvider);
    });

    after(() => {
        // Clock is a process-wide singleton - force a fresh uninitialized
        // state so a later test file's real Clock.init() re-syncs against
        // its own provider instead of silently reusing this stub.
        (Clock as unknown as { instance?: unknown }).instance = undefined;
        (Clock as unknown as { initialization?: unknown }).initialization =
            undefined;
    });

    beforeEach(() => {
        network = new FakeLobbyNetwork();
        originalTimeouts = {
            connect: config.LOBBY_COMMIT_CONNECT_TIMEOUT_MS,
            sync: config.LOBBY_COMMIT_SYNC_TIMEOUT_MS,
            confirm: config.LOBBY_COMMIT_CONFIRM_TIMEOUT_MS
        };
    });

    afterEach(async () => {
        config.LOBBY_COMMIT_CONNECT_TIMEOUT_MS = originalTimeouts.connect;
        config.LOBBY_COMMIT_SYNC_TIMEOUT_MS = originalTimeouts.sync;
        config.LOBBY_COMMIT_CONFIRM_TIMEOUT_MS = originalTimeouts.confirm;
    });

    /** Joins every peer's lobby and wires the full mesh (mirrors joining the SAME shared-swarm topic in production). */
    async function connectLobbyPeers(...peers: TestLobbyPeer[]): Promise<void> {
        for (const peer of peers) await peer.service.joinLobby(appNamespace);
        network.connect(...peers);
    }

    function makeCoordinator(
        harness: FakeChannelHarness,
        lobby: LobbyService,
        chain?: {
            channelIndex?: ChannelEnumerator;
        }
    ): ChannelAcquisitionCoordinator {
        return new ChannelAcquisitionCoordinator({
            lobby,
            signer: harness.signer,
            logger: createTestLogger(),
            events: harness.events,
            channelIndex: chain?.channelIndex
        });
    }

    /** Enumerator returning a fixed id list; records how many times it ran. */
    function fakeEnumerator(ids: string[]): ChannelEnumerator & {
        calls: number;
    } {
        return {
            calls: 0,
            async listOpenChannels() {
                this.calls++;
                return ids;
            }
        };
    }

    describe("chain-first ordering", () => {
        it("a usable chain candidate is joined without the lobby being consulted at all", async () => {
            const requester = createLobbyPeer(network);
            await requester.service.joinLobby(appNamespace);
            const harness = makeFakeChannelHarness(
                ethers.Wallet.createRandom()
            );
            const channelId = ethers.hexlify(ethers.randomBytes(32));
            // These cases assert WHICH source is consulted and in what order.
            // The commit machinery itself is covered by the JOIN/OPEN cases
            // below and end-to-end on a live chain, so the harness starts
            // already PARTICIPATING and the commit stages resolve instantly.
            harness.advanceStatus(Status.PARTICIPATING);
            const peerAddress = ethers.Wallet.createRandom().address;
            const enumerator = fakeEnumerator([channelId]);
            const listAdsSpy = sinon.spy(requester.service, "listAds");
            const requestIntentSpy = sinon.spy(
                requester.service,
                "requestIntent"
            );

            const coordinator = makeCoordinator(harness, requester.service, {
                channelIndex: enumerator,
            });
            const result = await coordinator.acquireChannel({ amount: "500" });

            expect(result.status).to.equal("acquired");
            expect(
                result.status === "acquired" ? result.channelId : undefined
            ).to.equal(channelId);
            expect(enumerator.calls).to.equal(1);
            // The whole point of chain-first: no intent is ever requested,
            // because no advertiser was involved.
            expect(requestIntentSpy.called).to.equal(false);
            expect(listAdsSpy.called).to.equal(false);
        });

        it("the attempt log identifies a chain candidate by its channelId rather than an invented ad", async () => {
            const requester = createLobbyPeer(network);
            await requester.service.joinLobby(appNamespace);
            const harness = makeFakeChannelHarness(
                ethers.Wallet.createRandom()
            );
            const channelId = ethers.hexlify(ethers.randomBytes(32));
            // These cases assert WHICH source is consulted and in what order.
            // The commit machinery itself is covered by the JOIN/OPEN cases
            // below and end-to-end on a live chain, so the harness starts
            // already PARTICIPATING and the commit stages resolve instantly.
            harness.advanceStatus(Status.PARTICIPATING);

            const coordinator = makeCoordinator(harness, requester.service, {
                channelIndex: fakeEnumerator([channelId])
            });
            const result = await coordinator.acquireChannel({ amount: "500" });

            // A chain-discovered candidate has no ad and no advertiser - it
            // is a channelId we found on chain and tried to join. Both label
            // slots carry the channelId rather than a fabricated ad, so
            // nothing on a fund-relevant path is made up.
            expect(result.attempts.length).to.be.greaterThan(0);
            for (const attempt of result.attempts) {
                expect(attempt.adId).to.equal(channelId);
                expect(attempt.advertiser).to.equal(channelId);
            }
        });

        it("when every chain candidate is rejected, the lobby is used as the fallback", async () => {
            const advertiser = createLobbyPeer(network);
            const requester = createLobbyPeer(network);
            await connectLobbyPeers(advertiser, requester);
            const harness = makeFakeChannelHarness(
                ethers.Wallet.createRandom()
            );
            const channelId = ethers.hexlify(ethers.randomBytes(32));
            // These cases assert WHICH source is consulted and in what order.
            // The commit machinery itself is covered by the JOIN/OPEN cases
            // below and end-to-end on a live chain, so the harness starts
            // already PARTICIPATING and the commit stages resolve instantly.
            harness.advanceStatus(Status.PARTICIPATING);
            const ad = baseAd({
                advertiser: advertiser.address,
                channelId: channelId
            });
            await advertiser.service.publishAd(ad);

            const enumerator = fakeEnumerator([]);
            const coordinator = makeCoordinator(harness, requester.service, {
                channelIndex: enumerator,
            });

            const result = await coordinator.acquireChannel({
                candidates: [ad],
                amount: "500"
            });

            // Explicit candidates mean the caller already has ads, so the
            // chain phase is skipped entirely.
            expect(enumerator.calls).to.equal(0);
            expect(result.status).to.equal("acquired");
        });

        it("chain exhaustion falls through to ads this peer already heard on the lobby topic", async () => {
            const advertiser = createLobbyPeer(network);
            const requester = createLobbyPeer(network);
            await connectLobbyPeers(advertiser, requester);
            const harness = makeFakeChannelHarness(
                ethers.Wallet.createRandom()
            );
            const channelId = ethers.hexlify(ethers.randomBytes(32));
            // These cases assert WHICH source is consulted and in what order.
            // The commit machinery itself is covered by the JOIN/OPEN cases
            // below and end-to-end on a live chain, so the harness starts
            // already PARTICIPATING and the commit stages resolve instantly.
            harness.advanceStatus(Status.PARTICIPATING);
            await advertiser.service.publishAd(
                baseAd({
                    advertiser: advertiser.address,
                    channelId: channelId
                })
            );

            const enumerator = fakeEnumerator([]);
            const coordinator = makeCoordinator(harness, requester.service, {
                channelIndex: enumerator,
            });

            // No explicit candidates: chain runs first, fails, and the lobby
            // ad is picked up without the caller passing it in.
            const result = await coordinator.acquireChannel({ amount: "500" });

            expect(enumerator.calls).to.equal(1);
            expect(result.status).to.equal("acquired");
        });

        it("lobbyOnly skips the chain phase entirely", async () => {
            const advertiser = createLobbyPeer(network);
            const requester = createLobbyPeer(network);
            await connectLobbyPeers(advertiser, requester);
            const harness = makeFakeChannelHarness(
                ethers.Wallet.createRandom()
            );
            const channelId = ethers.hexlify(ethers.randomBytes(32));
            // These cases assert WHICH source is consulted and in what order.
            // The commit machinery itself is covered by the JOIN/OPEN cases
            // below and end-to-end on a live chain, so the harness starts
            // already PARTICIPATING and the commit stages resolve instantly.
            harness.advanceStatus(Status.PARTICIPATING);
            await advertiser.service.publishAd(
                baseAd({
                    advertiser: advertiser.address,
                    channelId: channelId
                })
            );
            const enumerator = fakeEnumerator([channelId]);

            const coordinator = makeCoordinator(harness, requester.service, {
                channelIndex: enumerator,
            });
            const result = await coordinator.acquireChannel({
                lobbyOnly: true,
                amount: "500"
            });

            expect(enumerator.calls).to.equal(0);
            expect(result.status).to.equal("acquired");
        });

        it("a provider that cannot serve logs degrades to the lobby instead of failing the acquire", async () => {
            const advertiser = createLobbyPeer(network);
            const requester = createLobbyPeer(network);
            await connectLobbyPeers(advertiser, requester);
            const harness = makeFakeChannelHarness(
                ethers.Wallet.createRandom()
            );
            const channelId = ethers.hexlify(ethers.randomBytes(32));
            // These cases assert WHICH source is consulted and in what order.
            // The commit machinery itself is covered by the JOIN/OPEN cases
            // below and end-to-end on a live chain, so the harness starts
            // already PARTICIPATING and the commit stages resolve instantly.
            harness.advanceStatus(Status.PARTICIPATING);
            await advertiser.service.publishAd(
                baseAd({
                    advertiser: advertiser.address,
                    channelId: channelId
                })
            );

            const coordinator = makeCoordinator(harness, requester.service, {
                channelIndex: {
                    async listOpenChannels() {
                        throw new Error("provider refused eth_getLogs");
                    }
                },
            });

            const result = await coordinator.acquireChannel({ amount: "500" });

            expect(result.status).to.equal("acquired");
        });

        it("an empty chain is not an error - it simply falls through to the lobby", async () => {
            const advertiser = createLobbyPeer(network);
            const requester = createLobbyPeer(network);
            await connectLobbyPeers(advertiser, requester);
            const harness = makeFakeChannelHarness(
                ethers.Wallet.createRandom()
            );
            const channelId = ethers.hexlify(ethers.randomBytes(32));
            // These cases assert WHICH source is consulted and in what order.
            // The commit machinery itself is covered by the JOIN/OPEN cases
            // below and end-to-end on a live chain, so the harness starts
            // already PARTICIPATING and the commit stages resolve instantly.
            harness.advanceStatus(Status.PARTICIPATING);
            await advertiser.service.publishAd(
                baseAd({
                    advertiser: advertiser.address,
                    channelId: channelId
                })
            );

            const coordinator = makeCoordinator(harness, requester.service, {
                channelIndex: fakeEnumerator([]),
            });
            const result = await coordinator.acquireChannel({ amount: "500" });

            expect(result.status).to.equal("acquired");
        });
    });

    it("K>1: parallelism:2 returns unsupported with zero wire calls", async () => {
        const requester = createLobbyPeer(network);
        await requester.service.joinLobby(appNamespace);
        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, requester.service);
        const requestIntentSpy = sinon.spy(requester.service, "requestIntent");

        const ad = baseAd({ advertiser: ethers.Wallet.createRandom().address });
        const result = await coordinator.acquireChannel({
            candidates: [ad],
            parallelism: 2,
            amount: "500"
        });

        expect(result).to.deep.equal({
            status: "unsupported",
            reason: "parallelism>1",
            attempts: []
        });
        expect(requestIntentSpy.called).to.equal(false);
    });

    it("maxWinners:2 returns unsupported with zero wire calls", async () => {
        const requester = createLobbyPeer(network);
        await requester.service.joinLobby(appNamespace);
        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, requester.service);
        const requestIntentSpy = sinon.spy(requester.service, "requestIntent");

        const ad = baseAd({ advertiser: ethers.Wallet.createRandom().address });
        const result = await coordinator.acquireChannel({
            candidates: [ad],
            maxWinners: 2,
            amount: "500"
        });

        expect(result).to.deep.equal({
            status: "unsupported",
            reason: "maxWinners>1",
            attempts: []
        });
        expect(requestIntentSpy.called).to.equal(false);
    });

    it("negotiation service absent: an OPEN candidate is unsupported, a JOIN candidate in the same configuration still succeeds", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom(), {
            includeNegotiationService: false
        });
        const coordinator = makeCoordinator(harness, a.service);

        const { adId: openAdId } = await b.service.publishAd(
            baseAd({ kind: AdKind.OPEN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const openAd = a.service.listAds().find((s) => s.adId === openAdId)!.ad;

        const openResult = await coordinator.acquireChannel({
            candidates: [openAd],
            amount: "500"
        });
        expect(openResult.status).to.equal("unsupported");
        expect(
            openResult.status === "unsupported" ? openResult.reason : undefined
        ).to.equal("negotiation-service-absent");
        // A single all-OPEN pool with no service still gets a per-candidate
        // attempt recorded (the SKIP), not a silent zero-attempt abort.
        expect(openResult.attempts.length).to.equal(1);
        expect(openResult.attempts[0]).to.include({
            stage: "negotiate",
            outcome: "error",
            reason: "negotiation-service-absent"
        });

        const { adId: joinAdId } = await b.service.publishAd(
            baseAd({ kind: AdKind.JOIN, channelId: openAd.channelId })
        );
        await waitFor(() =>
            a.service.listAds().some((s) => s.adId === joinAdId)
        );
        const joinAd = a.service.listAds().find((s) => s.adId === joinAdId)!.ad;

        const commitPromise = coordinator.acquireChannel({
            candidates: [joinAd],
            amount: "500"
        });
        await waitFor(() => harness.tryOpenConnectionStub.called);
        harness.advanceStatus(Status.SYNCED);
        await waitFor(() => harness.joinChannelStub.called);
        harness.advanceStatus(Status.PENDING_PARTICIPANT);
        harness.advanceStatus(Status.PARTICIPATING);

        const joinResult = await commitPromise;
        expect(joinResult.status).to.equal("acquired");
    });

    it("mixed pool, no negotiation service: an OPEN candidate sorted FIRST is skipped (not a whole-acquire abort), and the JOIN candidate after it is still acquired", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        const c = createLobbyPeer(network);
        await connectLobbyPeers(a, b, c);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom(), {
            includeNegotiationService: false
        });
        const coordinator = makeCoordinator(harness, a.service);

        const { adId: openAdId } = await b.service.publishAd(
            baseAd({ kind: AdKind.OPEN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const openAd = a.service.listAds().find((s) => s.adId === openAdId)!.ad;

        const { adId: joinAdId } = await c.service.publishAd(
            baseAd({ kind: AdKind.JOIN })
        );
        await waitFor(() => a.service.listAds().length === 2);
        const joinAd = a.service.listAds().find((s) => s.adId === joinAdId)!.ad;

        // OPEN sorted first: the capability skip must not abort the whole
        // acquire - the JOIN candidate right after it still gets tried.
        const resultPromise = coordinator.acquireChannel({
            candidates: [openAd, joinAd],
            amount: "500"
        });

        await waitFor(() => harness.tryOpenConnectionStub.called);
        harness.advanceStatus(Status.SYNCED);
        await waitFor(() => harness.joinChannelStub.called);
        harness.advanceStatus(Status.PARTICIPATING);

        const result = await resultPromise;
        expect(result.status).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(joinAd.channelId);
        }
        expect(
            result.attempts.some(
                (att) =>
                    att.advertiser === b.wallet.address &&
                    att.outcome === "error" &&
                    att.reason === "negotiation-service-absent"
            )
        ).to.equal(true);
        expect(
            result.attempts.some(
                (att) =>
                    att.advertiser === c.wallet.address &&
                    att.outcome === "accepted"
            )
        ).to.equal(true);
        // Never even attempted the DHT rendezvous for the skipped OPEN ad.
        expect(harness.tryOpenConnectionStub.callCount).to.equal(1);
    });

    it("mixed pool, no negotiation service: an ALL-OPEN pool with nothing committable returns {status:'unsupported'}, not 'exhausted'", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom(), {
            includeNegotiationService: false
        });
        const coordinator = makeCoordinator(harness, a.service);

        const { adId } = await b.service.publishAd(
            baseAd({ kind: AdKind.OPEN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const ad = a.service.listAds().find((s) => s.adId === adId)!.ad;

        const result = await coordinator.acquireChannel({
            candidates: [ad],
            amount: "500"
        });

        expect(result.status).to.equal("unsupported");
        expect(
            result.status === "unsupported" ? result.reason : undefined
        ).to.equal("negotiation-service-absent");
    });

    it("stale/lying ad: an OPEN candidate whose channelId is already open fails the on-chain precheck -> exhausted, zero blacklist/ban", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        harness.isChannelOpenStub.resolves([true]); // the chain says it's already open, regardless of what the ad claims
        const coordinator = makeCoordinator(harness, a.service);

        const { adId } = await b.service.publishAd(
            baseAd({ kind: AdKind.OPEN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const ad = a.service.listAds()[0].ad;

        const result = await coordinator.acquireChannel({
            candidates: [ad],
            amount: "500"
        });

        expect(result.status).to.equal("exhausted");
        const attempts = (result as { attempts: unknown[] }).attempts;
        expect(attempts.length).to.be.greaterThan(0);
        expect(
            attempts.some(
                (att) =>
                    (att as { outcome: string; reason?: string }).outcome ===
                        "declined" &&
                    (att as { reason?: string }).reason ===
                        "channel-already-open"
            )
        ).to.equal(true);
        expect(harness.blacklistSpy.called).to.equal(false);
        expect(harness.blacklistByAddressSpy.called).to.equal(false);
        // Never even attempted the DHT rendezvous for a stale ad.
        expect(harness.tryOpenConnectionStub.called).to.equal(false);
    });

    it("per-stage timeout: a hung connect stage times out within its own budget, not the overall deadline", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        config.LOBBY_COMMIT_CONNECT_TIMEOUT_MS = 100;

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        harness.tryOpenConnectionStub.returns(new Promise(() => {})); // never resolves
        const coordinator = makeCoordinator(harness, a.service);

        const { adId } = await b.service.publishAd(
            baseAd({ kind: AdKind.JOIN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const ad = a.service.listAds()[0].ad;

        const startedAtMs = Date.now();
        const result = await coordinator.acquireChannel({
            candidates: [ad],
            amount: "500",
            deadlineMs: 5000
        });
        const elapsedMs = Date.now() - startedAtMs;

        expect(result.status).to.equal("exhausted"); // the deadline (5s) was nowhere near exhausted
        expect(elapsedMs).to.be.lessThan(2000); // bounded by the 100ms stage budget, not the 5s deadline
        const attempts = (result as { attempts: unknown[] }).attempts;
        expect(
            attempts.some(
                (att) =>
                    (att as { stage: string; outcome: string }).stage ===
                        "connect" &&
                    (att as { outcome: string }).outcome === "timeout"
            )
        ).to.equal(true);
    });

    it("deadline: exceeding deadlineMs returns {status:'deadline'} with the attempts made so far", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        harness.tryOpenConnectionStub.returns(new Promise(() => {})); // never resolves
        const coordinator = makeCoordinator(harness, a.service);

        const { adId } = await b.service.publishAd(
            baseAd({ kind: AdKind.JOIN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const ad = a.service.listAds()[0].ad;

        const result = await coordinator.acquireChannel({
            candidates: [ad],
            amount: "500",
            deadlineMs: 100
        });

        expect(result.status).to.equal("deadline");
        const attempts = (result as { attempts: unknown[] }).attempts;
        expect(attempts.length).to.be.greaterThan(0);
    });

    it("fallback/re-arm: a stale channelOpened latch fails the first OPEN candidate, resetForNewChannel clears it, and a second candidate on the SAME coordinator instance succeeds", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        const c = createLobbyPeer(network);
        await connectLobbyPeers(a, b, c);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, a.service);

        // Simulate a leftover latch from an earlier round: beginNegotiation
        // silently no-ops while this is true (OpenChannelNegotiationService.ts),
        // so candidate #1's negotiateRequest is never actually sent.
        harness.negotiationService!.state.channelOpened = true;

        // Two DIFFERENT advertisers (config.LOBBY_MAX_OPEN_ADS_PER_PEER
        // caps one OPEN ad per peer) so both candidates can be live at once.
        const { adId: adId1 } = await b.service.publishAd(
            baseAd({ kind: AdKind.OPEN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const ad1 = a.service.listAds().find((s) => s.adId === adId1)!.ad;

        config.LOBBY_COMMIT_CONFIRM_TIMEOUT_MS = 200;
        const { adId: adId2 } = await c.service.publishAd(
            baseAd({ kind: AdKind.OPEN })
        );
        await waitFor(() => a.service.listAds().length === 2);
        const ad2 = a.service.listAds().find((s) => s.adId === adId2)!.ad;

        const resultPromise = coordinator.acquireChannel({
            candidates: [ad1, ad2],
            amount: "500"
        });

        // Candidate #1: well before its 200ms negotiate-stage budget expires,
        // negotiateRequest has NOT been sent (the latch silently no-ops
        // beginNegotiation).
        await sleep(50);
        expect(harness.negotiateRequestSpy.callCount).to.equal(0);

        // Candidate #1 times out, resetForNewChannel clears the latch before
        // candidate #2 is attempted.
        await waitFor(
            () => harness.negotiationService!.state.channelOpened === false
        );

        // Candidate #2 proceeds for real: negotiateRequest is sent this time.
        await waitFor(() => harness.negotiateRequestSpy.callCount === 1);
        harness.advanceStatus(Status.PARTICIPATING);

        const result = await resultPromise;
        expect(result.status).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(ad2.channelId);
        }
    });

    it("loser release: releaseIntent is sent and acknowledged for an abandoned candidate - zero transport closes/blacklist attributable to the coordinator", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        const c = createLobbyPeer(network);
        await connectLobbyPeers(a, b, c);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        harness.tryOpenConnectionStub.rejects(new Error("connect failed"));
        const coordinator = makeCoordinator(harness, a.service);

        const { adId } = await b.service.publishAd(
            baseAd({ kind: AdKind.JOIN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        await waitFor(() => c.service.listAds().length === 1);
        const ad = a.service.listAds()[0].ad;

        const result = await coordinator.acquireChannel({
            candidates: [ad],
            amount: "500"
        });
        expect(result.status).to.equal("exhausted");

        // The hold was actually released and acknowledged: a competing peer
        // (C) can now win the SAME ad, proving a real round trip - not a
        // local no-op.
        const secondIntent = await c.service.requestIntent({
            peerAddress: b.wallet.address,
            adId,
            amount: "500"
        });
        expect(secondIntent.accepted).to.equal(true);

        expect(harness.blacklistSpy.called).to.equal(false);
        expect(harness.blacklistByAddressSpy.called).to.equal(false);
    });

    it("multi-candidate fallback: an explicit 2-element array falls back from a declining candidate to a fresh, untried candidate", async () => {
        const requester = createLobbyPeer(network);
        const badPeer = createLobbyPeer(network);
        const goodPeer = createLobbyPeer(network);
        await connectLobbyPeers(requester, badPeer, goodPeer);

        badPeer.service.setAdmissionPolicy({ mode: "denyAll" });

        await badPeer.service.publishAd(baseAd({ kind: AdKind.JOIN }));
        await waitFor(() => requester.service.listAds().length === 1);
        await goodPeer.service.publishAd(baseAd({ kind: AdKind.JOIN }));
        await waitFor(() => requester.service.listAds().length === 2);

        const badAd = requester.service
            .listAds()
            .find((s) => s.ad.advertiser === badPeer.wallet.address)!.ad;
        const goodAd = requester.service
            .listAds()
            .find((s) => s.ad.advertiser === goodPeer.wallet.address)!.ad;

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, requester.service);

        const commitPromise = coordinator.acquireChannel({
            candidates: [badAd, goodAd],
            amount: "500"
        });

        await waitFor(() => harness.getStatus() === Status.NOT_OPENED);
        harness.advanceStatus(Status.SYNCED);
        await waitFor(() => harness.joinChannelStub.called);
        harness.advanceStatus(Status.PARTICIPATING);

        const result = await commitPromise;
        expect(result.status).to.equal("acquired");
        expect(
            result.status === "acquired" && harness.joinChannelStub.calledOnce
        ).to.equal(true);
        // Exactly one intent attempt per candidate - the declined bad peer
        // is never retried, and the good peer is only tried once.
        const attempts = (result as { attempts: { advertiser: string }[] })
            .attempts;
        const intentAttempts = attempts.filter(
            (att) => (att as unknown as { stage: string }).stage === "intent"
        );
        expect(
            intentAttempts.filter(
                (att) => att.advertiser === badPeer.wallet.address
            ).length
        ).to.equal(1);
        expect(
            intentAttempts.filter(
                (att) => att.advertiser === goodPeer.wallet.address
            ).length
        ).to.equal(1);
    });

    it("JOIN commit: connect -> sync -> confirm reaches PARTICIPATING; result acquired with an attempt per stage", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, a.service);

        const { adId } = await b.service.publishAd(
            baseAd({ kind: AdKind.JOIN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const ad = a.service.listAds()[0].ad;

        const resultPromise = coordinator.acquireChannel({
            candidates: [ad],
            amount: "500"
        });

        await waitFor(() => harness.tryOpenConnectionStub.called);
        harness.advanceStatus(Status.SYNCED);
        await waitFor(() => harness.joinChannelStub.called);
        harness.advanceStatus(Status.PENDING_PARTICIPANT);
        harness.advanceStatus(Status.PARTICIPATING);

        const result = await resultPromise;
        expect(result.status).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(ad.channelId);
        }

        // SECURITY: the balance amount actually committed is what WE set
        // (options.amount), never the ad's own (different) amount field.
        const joinChannelArg =
            harness.collectJoinChannelConfirmationStub.firstCall.args[0];
        expect(joinChannelArg.balance.amount).to.equal(500n);
    });

    it("OPEN commit: isChannelOpen precheck passes -> connect -> setStakeAmount -> beginNegotiation; result acquired", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, a.service);

        const { adId } = await b.service.publishAd(
            baseAd({ kind: AdKind.OPEN })
        );
        await waitFor(() => a.service.listAds().length === 1);
        const ad = a.service.listAds()[0].ad;

        const resultPromise = coordinator.acquireChannel({
            candidates: [ad],
            amount: "500"
        });

        await waitFor(() => harness.negotiateRequestSpy.called);
        expect(harness.isChannelOpenStub.called).to.equal(true);
        expect(harness.negotiationService!.state.myAmount).to.equal(500);
        expect(harness.negotiationService!.state.negotiatingWith).to.equal(
            ethers.getAddress(b.wallet.address)
        );
        // The negotiated amount is what WE set, never the (different) ad amount.
        expect(harness.negotiateRequestSpy.firstCall.args[1]).to.equal(500);

        harness.advanceStatus(Status.PARTICIPATING);

        const result = await resultPromise;
        expect(result.status).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(ad.channelId);
        }
    });

    it("requestIntent rejection (bounded client-side timeout) is treated as a decline and falls back to the next candidate", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        const c = createLobbyPeer(network);
        await connectLobbyPeers(a, b, c);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, a.service);

        sinon.stub(a.service, "requestIntent").callsFake(async (args) => {
            if (args.peerAddress === b.wallet.address) {
                throw new Error(
                    "lobby requestIntent request timed out after 5000ms"
                );
            }
            return LobbyService.prototype.requestIntent.call(a.service, args);
        });

        const { adId: adB } = await b.service.publishAd(
            baseAd({ kind: AdKind.JOIN })
        );
        const { adId: adC } = await c.service.publishAd(
            baseAd({ kind: AdKind.JOIN })
        );
        await waitFor(() => a.service.listAds().length === 2);
        const stored = a.service.listAds();
        const adFromB = stored.find((s) => s.adId === adB)!.ad;
        const adFromC = stored.find((s) => s.adId === adC)!.ad;

        const resultPromise = coordinator.acquireChannel({
            candidates: [adFromB, adFromC],
            amount: "500"
        });

        await waitFor(() => harness.tryOpenConnectionStub.called);
        harness.advanceStatus(Status.SYNCED);
        await waitFor(() => harness.joinChannelStub.called);
        harness.advanceStatus(Status.PARTICIPATING);

        const result = await resultPromise;
        expect(result.status).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(adFromC.channelId);
        }
        const attempts = (
            result as { attempts: { stage: string; outcome: string }[] }
        ).attempts;
        expect(
            attempts.some(
                (att) => att.stage === "intent" && att.outcome === "timeout"
            )
        ).to.equal(true);
    });

    it("canonical amount validation: non-canonical decimal strings ('5e2', '500.0') are rejected up front, before any wire call", async () => {
        const requester = createLobbyPeer(network);
        await requester.service.joinLobby(appNamespace);
        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, requester.service);
        const requestIntentSpy = sinon.spy(requester.service, "requestIntent");

        const ad = baseAd({ advertiser: ethers.Wallet.createRandom().address });

        for (const badAmount of ["5e2", "500.0", "-1", "", "0x1f4", " 500"]) {
            let rejected = false;
            try {
                await coordinator.acquireChannel({
                    candidates: [ad],
                    amount: badAmount
                });
            } catch {
                rejected = true;
            }
            expect(
                rejected,
                `amount "${badAmount}" should be rejected`
            ).to.equal(true);
        }
        expect(requestIntentSpy.called).to.equal(false);
    });

    it("the intent accept's channelId is authoritative over the ad's own hint - the precheck, connect, and returned channelId all use the accept's value", async () => {
        const a = createLobbyPeer(network);
        const b = createLobbyPeer(network);
        await connectLobbyPeers(a, b);

        const harness = makeFakeChannelHarness(ethers.Wallet.createRandom());
        const coordinator = makeCoordinator(harness, a.service);

        const adHintChannelId = ethers.hexlify(ethers.randomBytes(32));
        const acceptedChannelId = ethers.hexlify(ethers.randomBytes(32));
        const ad = baseAd({ kind: AdKind.JOIN, channelId: adHintChannelId });
        sinon.stub(a.service, "requestIntent").resolves({
            accepted: true,
            holdMs: 5000,
            channelId: acceptedChannelId
        });

        const resultPromise = coordinator.acquireChannel({
            candidates: [ad],
            amount: "500"
        });

        await waitFor(() => harness.tryOpenConnectionStub.called);
        expect(harness.tryOpenConnectionStub.firstCall.args[0]).to.equal(
            acceptedChannelId
        );
        harness.advanceStatus(Status.SYNCED);
        await waitFor(() => harness.joinChannelStub.called);
        harness.advanceStatus(Status.PARTICIPATING);

        const result = await resultPromise;
        expect(result.status).to.equal("acquired");
        if (result.status === "acquired") {
            expect(result.channelId).to.equal(acceptedChannelId);
            expect(result.channelId).to.not.equal(adHintChannelId);
        }
        const joinChannelArg =
            harness.collectJoinChannelConfirmationStub.firstCall.args[0];
        expect(joinChannelArg.channelId).to.equal(acceptedChannelId);
    });
});
