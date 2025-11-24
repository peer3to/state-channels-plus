import { expect } from "chai";
import {
    PeerTestHarness,
    TestPeer,
    sleep
} from "@test/fixtures/PeerTestHarness";
import { AStateMachine, MathStateMachine } from "@typechain-types/index";
import { ForkId } from "@/types/types";
import { hash } from "../factory";
import { ATransport } from "@/transport";
import { ethers } from "ethers";
import Clock from "@/Clock";

describe("E2E: RPC Services", function () {
    let harness: PeerTestHarness<MathStateMachine>;

    afterEach(async function () {
        if (harness) {
            await harness.cleanup();
        }
    });

    describe("IsForkDisputed RPC", function () {
        let byzantinePeer: TestPeer<MathStateMachine>;
        let nonByzantinePeers: TestPeer<MathStateMachine>[];

        beforeEach(async function () {
            harness = new PeerTestHarness<MathStateMachine>();
            await harness.setup(3);
            await harness.openChannel();
            await harness.submitNextTransaction((contract) => contract.add(1));
            harness.assertAllPeersInSync();
            harness.resetEventSpies();

            byzantinePeer = harness.peers[0];

            // Create double-sign scenario to trigger dispute
            await harness.submitDoubleSignBlock(byzantinePeer.index);

            nonByzantinePeers = [harness.peers[1], harness.peers[2]];

            // Wait for honest peers to detect fraud and initiate dispute
            const fraudDetected = await harness.waitForEventCounts(
                "onInitiatingDispute",
                [
                    { peerId: nonByzantinePeers[0].index, expectedCount: 1 },
                    { peerId: nonByzantinePeers[1].index, expectedCount: 1 },
                    { peerId: byzantinePeer.index, expectedCount: 0 }
                ],
                10000
            );
            if (!fraudDetected) {
                throw new Error("Fraud was not detected");
            }

            // Wait for dispute to be committed on-chain
            const disputeCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                [
                    { peerId: 0, expectedCount: 2 },
                    { peerId: 1, expectedCount: 2 },
                    { peerId: 2, expectedCount: 2 }
                ],
                10000
            );
            if (!disputeCommitted) {
                throw new Error("Dispute was not committed");
            }
        });

        // =================================================================
        // Helper Functions
        // =================================================================

        const requestAcknowledgment = (
            peer: TestPeer<MathStateMachine>,
            forkId: ForkId
        ) => {
            const service =
                peer.stateManager.p2pManager.localRpc.isForkDisputedService;
            service.requestDisputeAcknowledgment(
                peer.stateManager.channelId,
                forkId
            );
            return service;
        };

        const getIsForkDisputedService = (peer: TestPeer<AStateMachine>) =>
            peer.stateManager.p2pManager.localRpc.isForkDisputedService;

        // Arrange: Setup channel with dispute committed on-chain
        // Act: One peer broadcasts acknowledgment request to all connected peers
        // Assert: All non-malicious peers acknowledge the disputed fork within timeout
        it("should broadcast acknowledgment request and receive responses from all peers", async function () {
            // Arrange
            const requestingPeer = nonByzantinePeers[0];
            const requestingPeerService =
                getIsForkDisputedService(requestingPeer);

            // Act

            requestAcknowledgment(requestingPeer, harness.activeForkId!);

            // Wait for the disputed fork to be registered
            const forkRegistered = await harness.waitForCondition(
                () =>
                    requestingPeerService.disputedForks.has(
                        harness.activeForkId!
                    ),
                5000
            );
            expect(forkRegistered).to.be.true;

            // Assert

            const allAcknowledged = await harness.verifyAllPeersAcknowledged(
                requestingPeer.index,
                harness.activeForkId!,
                5000,
                [byzantinePeer.index]
            );
            expect(allAcknowledged).to.be.true;
        });

        // Arrange: Setup channel with disputed fork, all peers acknowledge dispute
        // Act: Peer attempts to produce block on acknowledged disputed fork
        // Assert: Block validation triggers immediate disconnection of the offending peer
        it("should disconnect peer building on acknowledged disputed fork", async function () {
            // Arrange
            const requestingPeer = nonByzantinePeers[0];
            const requestingPeerService =
                getIsForkDisputedService(requestingPeer);
            requestAcknowledgment(requestingPeer, harness.activeForkId!);

            const allAcknowledged = await harness.verifyAllPeersAcknowledged(
                requestingPeer.index,
                harness.activeForkId!,
                5000,
                [byzantinePeer.index]
            );
            expect(allAcknowledged).to.be.true;

            const buildingPeer = nonByzantinePeers[1];
            const buildingPeerTransport = harness.getPeerTransport(
                requestingPeer.index,
                buildingPeer.index
            );
            expect(buildingPeerTransport).to.not.be.undefined;

            expect(
                requestingPeerService.didPeerAcknowledgeDisputedFork(
                    buildingPeerTransport!,
                    harness.activeForkId!
                )
            ).to.be.true;

            // Act
            const connectionsBefore = harness.getConnectionCount(
                requestingPeer.index
            );

            const buildingLatestBlock =
                buildingPeer.stateManager.storage.blocks.getLatestBlock(
                    harness.activeForkId!
                );

            await requestingPeer.stateManager.blockValidationStrategy.blockForkIsDisputed(
                buildingLatestBlock!,
                buildingPeerTransport
            );
            // Assert - 1 connection should be dropped
            const assertion = await harness.waitForCondition(
                () =>
                    connectionsBefore -
                        harness.getConnectionCount(requestingPeer.index) ===
                    1,
                5000
            );

            expect(assertion).to.be.true;
        });

        // Arrange: Setup channel with fork that is not disputed
        // Act: Malicious peer requests acknowledgment for non-disputed fork
        // Assert: Receiving peer detects fraud and disconnects the malicious requester
        it("should disconnect peer requesting acknowledgment of non-disputed fork", async function () {
            // Arrange - Use two honest peers, one will simulate malicious behavior
            const requestingPeer = nonByzantinePeers[0]; // Will request acknowledgment of a non-disputed fork
            const receivingPeer = nonByzantinePeers[1];
            const fakeForkId = hash() as ForkId;
            const connectionsBefore = harness.getConnectionCount(
                receivingPeer.index
            );

            // Act
            const receivingPeerService =
                getIsForkDisputedService(receivingPeer);
            const transport = harness.getPeerTransport(
                receivingPeer.index,
                requestingPeer.index
            );

            await receivingPeerService
                .createRPCMethods(transport!)
                .onDisputeAcknowledgmentRequest(
                    requestingPeer.stateManager.channelId,
                    fakeForkId
                );

            // Assert
            const assertion = await harness.waitForCondition(
                () =>
                    connectionsBefore -
                        harness.getConnectionCount(receivingPeer.index) ===
                    1,
                5000
            );

            expect(assertion).to.be.true;
        });

        // Arrange: Setup channel with disputed fork
        // Act: Peer sends multiple acknowledgment requests for same fork ID
        // Assert: Service ignores duplicate requests, maintains idempotency and doesn't send duplicate broadcasts
        it("should ignore duplicate dispute acknowledgment requests", async function () {
            // Arrange
            const requestingPeer = nonByzantinePeers[0];
            const receivingPeer = nonByzantinePeers[1];
            const requestingPeerService =
                getIsForkDisputedService(requestingPeer);

            // Get transport from requesting peer's perspective
            const requestingTransport = harness.getPeerTransport(
                requestingPeer.index,
                receivingPeer.index
            )!;

            const initiallyAcknowledged =
                requestingPeerService.didPeerAcknowledgeDisputedFork(
                    requestingTransport,
                    harness.activeForkId!
                );
            expect(initiallyAcknowledged).to.be.false;

            // Act - First request
            requestAcknowledgment(requestingPeer, harness.activeForkId!);
            const disputedForksAfterFirst =
                requestingPeerService.disputedForks.size;

            // Wait for receiving peer to acknowledge back
            await harness.waitForCondition(() => {
                return requestingPeerService.didPeerAcknowledgeDisputedFork(
                    requestingTransport,
                    harness.activeForkId!
                );
            }, 5000);

            // Act - Second request (should be ignored, no duplicate broadcast)
            requestAcknowledgment(requestingPeer, harness.activeForkId!);
            const disputedForksAfterSecond =
                requestingPeerService.disputedForks.size;

            // Assert - Service maintains idempotency
            expect(disputedForksAfterSecond).to.equal(disputedForksAfterFirst);
            expect(disputedForksAfterSecond).to.equal(1);

            // Assert - Receiving peer still acknowledges (no duplicate processing issues)
            expect(
                requestingPeerService.didPeerAcknowledgeDisputedFork(
                    requestingTransport,
                    harness.activeForkId!
                )
            ).to.be.true;
        });

        // Arrange: Setup channel with disputed fork, establish peer connection
        // Act: Peer sends acknowledgment response twice for same fork
        // Assert: Second response triggers disconnection as malicious behavior
        it("should disconnect peer sending duplicate acknowledgment responses", async function () {
            // Arrange - Use two honest peers
            const respondingPeer = nonByzantinePeers[0];
            const requestingPeer = nonByzantinePeers[1];
            const respondingPeerService =
                getIsForkDisputedService(respondingPeer);

            const transport = harness.getPeerTransport(
                respondingPeer.index,
                requestingPeer.index
            )!;

            expect(
                respondingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                )
            ).to.be.false;

            // Act - First response
            await respondingPeerService.respondToDisputeAcknowledgment(
                transport,
                requestingPeer.stateManager.channelId,
                harness.activeForkId!
            );

            expect(
                respondingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                )
            ).to.be.true;

            const connectionsBefore = harness.getConnectionCount(
                respondingPeer.index
            );

            // Act - Second response (duplicate, should trigger disconnection)
            await respondingPeerService.respondToDisputeAcknowledgment(
                transport,
                requestingPeer.stateManager.channelId,
                harness.activeForkId!
            );

            // Assert - Responding peer should disconnect requesting peer
            const assertion = await harness.waitForCondition(
                () =>
                    connectionsBefore -
                        harness.getConnectionCount(respondingPeer.index) ===
                    1,
                5000
            );
            expect(assertion).to.be.true;
        });

        // Arrange: Setup channel, use spy to prevent peers from disconnecting requester for fake dispute
        // Act: Request acknowledgment for non-existent disputed fork, peers don't respond
        // Assert: Non-responding peers are disconnected after timeout (2x agreementTime)
        it("should disconnect non-responding peers after acknowledgment timeout", async function () {
            // Arrange - Re-setup harness with short agreementTime for faster test
            await harness.cleanup();
            await harness.setup(3, {
                timeConfig: {
                    agreementTime: 1
                }
            });
            await harness.openChannel();

            const nonDisputedForkId = hash() as ForkId;
            const requestingPeer = harness.peers[0];

            // Spy to prevent peers from disconnecting the requester when they receive invalid request
            const disconnectSpies: Array<{ restore: () => void }> = [];
            for (let i = 1; i < 3; i++) {
                const peer = harness.peers[i];
                const originalDisconnect =
                    peer.stateManager.p2pManager.disconnectAndBlacklistPeer.bind(
                        peer.stateManager.p2pManager
                    );
                const spy = (transport: ATransport) => {
                    const profile =
                        peer.stateManager.p2pManager.profileManager.getProfileByTransport(
                            transport
                        );
                    if (profile?.evmAddress === requestingPeer.address) {
                        return;
                    }
                    return originalDisconnect(transport);
                };
                peer.stateManager.p2pManager.disconnectAndBlacklistPeer = spy;
                disconnectSpies.push({
                    restore: () => {
                        peer.stateManager.p2pManager.disconnectAndBlacklistPeer =
                            originalDisconnect;
                    }
                });
            }

            const connectionsBefore = harness.getConnectionCount(
                requestingPeer.index
            );

            // Act
            requestAcknowledgment(requestingPeer, nonDisputedForkId);

            // Timeout is 2 * agreementTime (1 second) = 2 seconds
            const timeoutMs =
                2 * requestingPeer.stateManager.timeConfig.agreementTime * 1000;
            await harness.waitForCondition(() => {
                return (
                    harness.getConnectionCount(requestingPeer.index) <
                    connectionsBefore
                );
            }, timeoutMs + 1000);

            disconnectSpies.forEach((spy) => spy.restore());

            // Assert
            const connectionsAfter = harness.getConnectionCount(
                requestingPeer.index
            );
            expect(connectionsAfter).to.be.lessThan(connectionsBefore);
        });

        // Arrange: Setup channel with disputed fork committed on-chain
        // Act: Request acknowledgment for the genuinely disputed fork
        // Assert: All peers verify dispute status and acknowledge successfully
        it("should successfully acknowledge genuinely disputed fork", async function () {
            // Arrange
            const requestingPeer = nonByzantinePeers[0];
            const forkId = harness.activeForkId!;

            // Act
            requestAcknowledgment(requestingPeer, forkId);

            // Assert
            const requestingPeerService =
                getIsForkDisputedService(requestingPeer);
            expect(requestingPeerService.disputedForks.has(forkId)).to.be.true;
            expect(requestingPeerService.disputedForks.size).to.equal(1);

            const allAcknowledged = await harness.verifyAllPeersAcknowledged(
                requestingPeer.index,
                forkId,
                5000,
                [byzantinePeer.index]
            );
            expect(allAcknowledged).to.be.true;
        });

        // Arrange: Setup channel with disputed fork, verify local diamond contract shows disputed status
        // Act: Receiving peer gets acknowledgment request and checks local diamond state
        // Assert: Peer successfully acknowledges after verifying local dispute status
        it("should acknowledge when local diamond contract confirms dispute", async function () {
            // Arrange - Use two honest peers (1 and 2)
            const requestingPeer = nonByzantinePeers[1];
            const receivingPeer = nonByzantinePeers[0];

            const isDisputedLocal =
                await receivingPeer.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                    requestingPeer.stateManager.channelId,
                    harness.activeForkId!
                );
            expect(isDisputedLocal).to.be.true;

            const transport = harness.getPeerTransport(
                requestingPeer.index,
                receivingPeer.index
            )!;

            const receivingPeerService =
                getIsForkDisputedService(receivingPeer);

            expect(
                receivingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                )
            ).to.be.false;

            // Act
            await receivingPeerService
                .createRPCMethods(transport)
                .onDisputeAcknowledgmentRequest(
                    requestingPeer.stateManager.channelId,
                    harness.activeForkId!
                );

            await harness.waitForCondition(() => {
                return receivingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                );
            }, 5000);

            // Assert
            expect(
                receivingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                )
            ).to.be.true;
        });

        // Arrange: Setup channel with disputed fork, wait for on-chain dispute commitment
        // Act: Receiving peer gets acknowledgment request and checks on-chain state
        // Assert: Peer successfully acknowledges after verifying on-chain dispute status
        it("should acknowledge when on-chain contract confirms dispute", async function () {
            // Arrange - Use two honest peers (1 and 2)
            const requestingPeer = nonByzantinePeers[1];
            const receivingPeer = nonByzantinePeers[0];

            await harness.waitForCondition(async () => {
                const isDisputedOnChain =
                    await receivingPeer.stateManager.stateChannelManagerContract.isForkDisputed(
                        requestingPeer.stateManager.channelId,
                        harness.activeForkId!
                    );
                return isDisputedOnChain;
            }, 5000);

            const isDisputedOnChain =
                await receivingPeer.stateManager.stateChannelManagerContract.isForkDisputed(
                    requestingPeer.stateManager.channelId,
                    harness.activeForkId!
                );

            expect(isDisputedOnChain).to.be.true;

            const transport = harness.getPeerTransport(
                requestingPeer.index,
                receivingPeer.index
            )!;

            const receivingPeerService =
                getIsForkDisputedService(receivingPeer);

            expect(
                receivingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                )
            ).to.be.false;

            // Act
            await receivingPeerService
                .createRPCMethods(transport)
                .onDisputeAcknowledgmentRequest(
                    requestingPeer.stateManager.channelId,
                    harness.activeForkId!
                );

            await harness.waitForCondition(() => {
                return receivingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                );
            }, 5000);

            // Assert
            expect(
                receivingPeerService.didIAcknowledgeDisputedFork(
                    transport,
                    harness.activeForkId!
                )
            ).to.be.true;
        });
    });

    describe("InitHandshake RPC", function () {
        let LocalDiscoveryServer: (typeof import("@/utils/LocalDiscoveryServer"))["LocalDiscoveryServer"];

        beforeEach(async function () {
            harness = new PeerTestHarness<MathStateMachine>();
            LocalDiscoveryServer = (
                await import("@/utils/LocalDiscoveryServer")
            ).LocalDiscoveryServer;
            await harness.setup(3, { autoConnect: false });
            await harness.openChannel();
        });

        afterEach(async function () {
            await sleep(100);
        });

        // =================================================================
        // Helper Functions
        // =================================================================

        const getInitHandshakeService = (peer: TestPeer<AStateMachine>) =>
            peer.stateManager.p2pManager.localRpc.initHandshakeService;

        const isHandshakeCompleted = (
            peer: TestPeer<AStateMachine>,
            evmAddress: string
        ): boolean => {
            const profile = harness.getProfile(peer.index, evmAddress);
            return profile?.getIsHandshakeCompleted() ?? false;
        };

        // Arrange: Setup 3 peers but connect only the first 2
        // Act: New peer connects and completes handshake
        // Assert: Handshake completes successfully, profile is created
        it("should complete handshake successfully and create peer profile", async function () {
            // Arrange
            const initiatingPeer = harness.peers[0];
            const peer1 = harness.peers[1];
            LocalDiscoveryServer.connectToPeers(
                initiatingPeer.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            LocalDiscoveryServer.connectToPeers(
                peer1.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            await harness.waitForP2PConnections();

            expect(isHandshakeCompleted(initiatingPeer, peer1.address)).to.be
                .true;

            const newPeer = harness.peers[2];
            LocalDiscoveryServer.connectToPeers(
                newPeer.stateManager.p2pManager,
                harness.channelId?.toString()
            );

            await harness.waitForCondition(() => {
                return (
                    harness.getPeerTransport(
                        initiatingPeer.index,
                        newPeer.index
                    ) !== undefined
                );
            }, 5000);

            await harness.waitForCondition(() => {
                return isHandshakeCompleted(initiatingPeer, newPeer.address);
            }, 5000);

            // Assert
            const profileAfter = harness.getProfile(
                initiatingPeer.index,
                newPeer.address
            );
            expect(profileAfter).to.not.be.undefined;
            expect(profileAfter?.getEvmAddress().toString()).to.equal(
                newPeer.address
            );
            expect(isHandshakeCompleted(initiatingPeer, newPeer.address)).to.be
                .true;
        });

        // Arrange: Setup 3 peers but connect only the first 2
        // Act: New peer sends handshake request with time difference exceeding agreementTime
        // Assert: Receiving peer disconnects the requesting peer
        it("should disconnect peer when handshake request time difference exceeds agreementTime", async function () {
            // Arrange
            const peer0 = harness.peers[0];
            const peer1 = harness.peers[1];
            const receivingPeer = peer1;
            LocalDiscoveryServer.connectToPeers(
                peer0.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            LocalDiscoveryServer.connectToPeers(
                peer1.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            await harness.waitForP2PConnections();

            const connectionsBefore = harness.getConnectionCount(
                receivingPeer.index
            );

            const newPeer = harness.peers[2];
            LocalDiscoveryServer.connectToPeers(
                newPeer.stateManager.p2pManager,
                harness.channelId?.toString()
            );

            await harness.waitForCondition(() => {
                return (
                    harness.getPeerTransport(
                        receivingPeer.index,
                        newPeer.index
                    ) !== undefined
                );
            }, 5000);

            const transportFromReceiver = harness.getPeerTransport(
                receivingPeer.index,
                newPeer.index
            )!;

            const agreementTime =
                receivingPeer.stateManager.timeConfig.agreementTime;
            const invalidTime = Clock.getTimeInSeconds() + agreementTime + 2000;
            const challengeHash = ethers.keccak256(ethers.randomBytes(32));

            // Act
            const receivingPeerService = getInitHandshakeService(receivingPeer);
            await receivingPeerService
                .createRPCMethods(transportFromReceiver)
                .onInitHandshakeRequest(challengeHash, invalidTime);

            // Assert
            expect(
                await harness.waitForCondition(
                    () =>
                        connectionsBefore -
                            harness.getConnectionCount(receivingPeer.index) ===
                        1,
                    5000
                )
            ).to.be.true;
        });

        // Arrange: Setup 3 peers, connect first 2
        // Act: New peer sends handshake response with RTT exceeding agreementTime
        // Assert: Initiating peer disconnects the responding peer
        it("should disconnect peer when handshake response RTT exceeds agreementTime", async function () {
            // Arrange
            const initiatingPeer = harness.peers[0];
            const peer1 = harness.peers[1];
            LocalDiscoveryServer.connectToPeers(
                initiatingPeer.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            LocalDiscoveryServer.connectToPeers(
                peer1.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            await harness.waitForP2PConnections();

            const connectionsBefore = harness.getConnectionCount(
                initiatingPeer.index
            );

            const newPeer = harness.peers[2];
            LocalDiscoveryServer.connectToPeers(
                newPeer.stateManager.p2pManager,
                harness.channelId?.toString()
            );

            await harness.waitForCondition(() => {
                return (
                    harness.getPeerTransport(
                        initiatingPeer.index,
                        newPeer.index
                    ) !== undefined
                );
            }, 5000);

            const transport = harness.getPeerTransport(
                initiatingPeer.index,
                newPeer.index
            )!;

            const initHandshakeService =
                getInitHandshakeService(initiatingPeer);
            initHandshakeService.initHandshake(transport);

            await harness.waitForCondition(() => {
                return (
                    initHandshakeService.getChallenge(transport) !== undefined
                );
            }, 1000);

            const challenge = initHandshakeService.getChallenge(transport)!;
            expect(initHandshakeService.getChallenge(transport)!).to.not.be
                .undefined;

            const agreementTime =
                initiatingPeer.stateManager.timeConfig.agreementTime;
            const slowResponseTime = challenge.initTime + agreementTime + 1;

            const challengeHashBytes = ethers.getBytes(
                challenge.randomChallengeHash
            );
            const signature =
                await newPeer.stateManager.p2pManager.p2pSigner.signMessage(
                    challengeHashBytes
                );

            // Act
            await initHandshakeService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    signature,
                    slowResponseTime,
                    newPeer.stateManager.p2pManager.preferredTransport
                );

            // Assert
            expect(
                await harness.waitForCondition(
                    () =>
                        connectionsBefore -
                            harness.getConnectionCount(initiatingPeer.index) ===
                        1,
                    5000
                )
            ).to.be.true;
        });

        // Arrange: Setup channel, connect peers, initiate handshake
        // Act: Peer sends handshake response with responseTime not matching initTime
        // Assert: Initiating peer disconnects the responding peer
        it("should disconnect peer when handshake response time doesn't match init time", async function () {
            // Arrange
            const initiatingPeer = harness.peers[0];
            const respondingPeer = harness.peers[1];
            const transport = harness.getPeerTransport(
                initiatingPeer.index,
                respondingPeer.index
            )!;

            const initHandshakeService =
                getInitHandshakeService(initiatingPeer);
            initHandshakeService.mapTransportToChallenge.delete(transport);
            initHandshakeService.initHandshake(transport);

            expect(
                await harness.waitForCondition(() => {
                    return (
                        initHandshakeService.getChallenge(transport) !==
                        undefined
                    );
                }, 5000)
            ).to.be.true;
            const challenge = initHandshakeService.getChallenge(transport)!;
            const connectionsBefore = harness.getConnectionCount(
                initiatingPeer.index
            );

            const agreementTime =
                initiatingPeer.stateManager.timeConfig.agreementTime;
            const mismatchedResponseTime =
                challenge.initTime + agreementTime + 1;

            const challengeHashBytes = ethers.getBytes(
                challenge.randomChallengeHash
            );
            const signature =
                await respondingPeer.stateManager.p2pManager.p2pSigner.signMessage(
                    challengeHashBytes
                );

            // Act
            await initHandshakeService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    signature,
                    mismatchedResponseTime,
                    respondingPeer.stateManager.p2pManager.preferredTransport
                );

            // Assert
            expect(
                await harness.waitForCondition(
                    () =>
                        connectionsBefore -
                            harness.getConnectionCount(initiatingPeer.index) ===
                        1,
                    5000
                )
            ).to.be.true;
        });

        // Arrange: Setup channel, connect peers, initiate handshake
        // Act: Peer sends handshake response with invalid signature
        // Assert: Handshake fails or peer is disconnected
        it("should disconnect peer when handshake response has invalid signature", async function () {
            // Arrange
            const initiatingPeer = harness.peers[0];
            const respondingPeer = harness.peers[1];
            const transport = harness.getPeerTransport(
                initiatingPeer.index,
                respondingPeer.index
            )!;

            const initHandshakeService =
                getInitHandshakeService(initiatingPeer);
            initHandshakeService.mapTransportToChallenge.delete(transport);
            initHandshakeService.initHandshake(transport);

            expect(
                await harness.waitForCondition(() => {
                    return (
                        initHandshakeService.getChallenge(transport) !==
                        undefined
                    );
                }, 5000)
            ).to.be.true;

            const connectionsBefore = harness.getConnectionCount(
                initiatingPeer.index
            );

            const wrongMessage = ethers.randomBytes(32);
            const invalidSignature =
                await respondingPeer.signer.signMessage(wrongMessage);

            const localTime = Clock.getTimeInSeconds();

            // Act
            await initHandshakeService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    invalidSignature,
                    localTime,
                    respondingPeer.stateManager.p2pManager.preferredTransport
                );

            // Assert
            await harness.waitForCondition(() => {
                return (
                    !isHandshakeCompleted(
                        initiatingPeer,
                        respondingPeer.address
                    ) ||
                    harness.getConnectionCount(initiatingPeer.index) <
                        connectionsBefore
                );
            }, 5000);

            const handshakeCompleted = isHandshakeCompleted(
                initiatingPeer,
                respondingPeer.address
            );
            const connectionsAfter = harness.getConnectionCount(
                initiatingPeer.index
            );

            expect(!handshakeCompleted || connectionsAfter < connectionsBefore)
                .to.be.true;
        });

        // Arrange: Setup channel, connect 2 peers, add a new peer
        // Act: New peer sends unsolicited handshake response (no prior handshake request)
        // Assert: Initiating peer disconnects the new peer (no challenge exists)
        it("should disconnect peer sending unsolicited handshake response", async function () {
            // Arrange
            const initiatingPeer = harness.peers[0];
            const newPeer = harness.peers[2];

            const transport = harness.getPeerTransport(
                initiatingPeer.index,
                newPeer.index
            )!;

            const initHandshakeService =
                getInitHandshakeService(initiatingPeer);

            expect(initHandshakeService.getChallenge(transport)).to.be
                .undefined;

            const connectionsBefore = harness.getConnectionCount(
                initiatingPeer.index
            );
            expect(connectionsBefore).to.be.greaterThan(0);

            const fakeChallengeHash = ethers.keccak256(ethers.randomBytes(32));
            const fakeChallengeHashBytes = ethers.getBytes(fakeChallengeHash);
            const signature =
                await newPeer.stateManager.p2pManager.p2pSigner.signMessage(
                    fakeChallengeHashBytes
                );

            // Act
            await initHandshakeService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    signature,
                    Clock.getTimeInSeconds(),
                    newPeer.stateManager.p2pManager.preferredTransport
                );

            // Assert
            const connectionsAfter = harness.getConnectionCount(
                initiatingPeer.index
            );
            expect(connectionsAfter).to.equal(connectionsBefore - 1);
        });

        // Arrange: Setup channel, connect peers, blacklist a peer
        // Act: Blacklisted peer attempts handshake
        // Assert: Initiating peer rejects handshake and disconnects blacklisted peer
        it("should reject handshake from blacklisted peer", async function () {
            // Arrange
            const initiatingPeer = harness.peers[0];
            const respondingPeer = harness.peers[1];
            const transport = harness.getPeerTransport(
                initiatingPeer.index,
                respondingPeer.index
            )!;

            const profile = harness.getProfile(
                initiatingPeer.index,
                respondingPeer.address
            );
            if (profile) {
                profile.blacklist();
            }

            const isBlacklisted =
                initiatingPeer.stateManager.p2pManager.isBlacklisted(
                    respondingPeer.address
                );
            expect(isBlacklisted).to.be.true;

            const initHandshakeService =
                getInitHandshakeService(initiatingPeer);
            initHandshakeService.mapTransportToChallenge.delete(transport);
            initHandshakeService.initHandshake(transport);

            expect(
                await harness.waitForCondition(() => {
                    return (
                        initHandshakeService.getChallenge(transport) !==
                        undefined
                    );
                }, 5000)
            ).to.be.true;
            const challenge = initHandshakeService.getChallenge(transport)!;
            const connectionsBefore = harness.getConnectionCount(
                initiatingPeer.index
            );

            const challengeHashBytes = ethers.getBytes(
                challenge.randomChallengeHash
            );
            const signature =
                await respondingPeer.stateManager.p2pManager.p2pSigner.signMessage(
                    challengeHashBytes
                );

            // Act
            await initHandshakeService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    signature,
                    Clock.getTimeInSeconds(),
                    respondingPeer.stateManager.p2pManager.preferredTransport
                );

            // Assert
            expect(
                await harness.waitForCondition(
                    () =>
                        connectionsBefore -
                            harness.getConnectionCount(initiatingPeer.index) ===
                        1,
                    5000
                )
            ).to.be.true;
        });

        // Arrange: Setup channel, connect peers, initiate handshake
        // Act: Peer doesn't respond within agreementTime
        // Assert: Initiating peer disconnects non-responding peer after timeout
        it("should disconnect peer that doesn't respond within agreementTime", async function () {
            // Arrange
            await harness.cleanup();
            await harness.setup(3, {
                autoConnect: false,
                timeConfig: {
                    agreementTime: 1
                }
            });
            await harness.openChannel();

            const initiatingPeer = harness.peers[0];
            const respondingPeer = harness.peers[1];
            const transport = harness.getPeerTransport(
                initiatingPeer.index,
                respondingPeer.index
            )!;
            initiatingPeer.stateManager.p2pManager.disconnectConnection(
                transport
            );
            initiatingPeer.stateManager.p2pManager.openConnections.push(
                transport
            );

            const connectionsBefore = harness.getConnectionCount(
                initiatingPeer.index
            );

            // Act
            const initHandshakeService =
                getInitHandshakeService(initiatingPeer);
            initHandshakeService.initHandshake(transport);

            respondingPeer.stateManager.p2pManager.disconnectConnection(
                transport
            );

            const timeoutMs =
                initiatingPeer.stateManager.timeConfig.agreementTime * 1000;
            await harness.waitForCondition(() => {
                return (
                    harness.getConnectionCount(initiatingPeer.index) <
                    connectionsBefore
                );
            }, timeoutMs + 1000);

            // Assert
            const connectionsAfter = harness.getConnectionCount(
                initiatingPeer.index
            );
            expect(connectionsAfter).to.be.lessThan(connectionsBefore);
        });

        // Arrange: Setup channel, connect peers, complete initial handshake
        // Act: Peer initiates handshake again with existing profile
        // Assert: Profile transport is updated, handshake completes successfully
        it("should update existing profile transport on successful handshake", async function () {
            // Arrange
            const initiatingPeer = harness.peers[0];
            const respondingPeer = harness.peers[1];
            LocalDiscoveryServer.connectToPeers(
                initiatingPeer.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            LocalDiscoveryServer.connectToPeers(
                respondingPeer.stateManager.p2pManager,
                harness.channelId?.toString()
            );
            await harness.waitForP2PConnections();

            await harness.waitForCondition(() => {
                return isHandshakeCompleted(
                    initiatingPeer,
                    respondingPeer.address
                );
            }, 5000);

            const transport = harness.getPeerTransport(
                initiatingPeer.index,
                respondingPeer.index
            )!;

            const initHandshakeService =
                getInitHandshakeService(initiatingPeer);
            initHandshakeService.initHandshake(transport);

            await harness.waitForCondition(() => {
                return (
                    initHandshakeService.getChallenge(transport) !== undefined
                );
            }, 1000);

            const challenge = initHandshakeService.getChallenge(transport)!;
            const challengeHashBytes = ethers.getBytes(
                challenge.randomChallengeHash
            );
            const signature =
                await respondingPeer.stateManager.p2pManager.p2pSigner.signMessage(
                    challengeHashBytes
                );

            await initHandshakeService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    signature,
                    Clock.getTimeInSeconds(),
                    respondingPeer.stateManager.p2pManager.preferredTransport
                );

            await harness.waitForCondition(() => {
                return isHandshakeCompleted(
                    initiatingPeer,
                    respondingPeer.address
                );
            }, 5000);

            const profileBefore = harness.getProfile(
                initiatingPeer.index,
                respondingPeer.address
            );
            expect(profileBefore).to.not.be.undefined;

            // Act
            initHandshakeService.initHandshake(transport);

            await harness.waitForCondition(() => {
                return (
                    initHandshakeService.getChallenge(transport) !== undefined
                );
            }, 1000);

            const challenge2 = initHandshakeService.getChallenge(transport)!;
            const challengeHashBytes2 = ethers.getBytes(
                challenge2.randomChallengeHash
            );
            const signature2 =
                await respondingPeer.stateManager.p2pManager.p2pSigner.signMessage(
                    challengeHashBytes2
                );

            await initHandshakeService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    signature2,
                    Clock.getTimeInSeconds(),
                    respondingPeer.stateManager.p2pManager.preferredTransport
                );

            await harness.waitForCondition(() => {
                return isHandshakeCompleted(
                    initiatingPeer,
                    respondingPeer.address
                );
            }, 5000);

            // Assert
            const profileAfter = harness.getProfile(
                initiatingPeer.index,
                respondingPeer.address
            );
            expect(profileAfter).to.not.be.undefined;
            expect(profileAfter?.getEvmAddress().toString()).to.equal(
                respondingPeer.address
            );
            expect(profileAfter).to.equal(profileBefore);
        });
    });

    describe("Spectate RPC", function () {
        // Arrange: Setup channel with participants, new peer wants to spectate
        // Act: Spectate sync request is sent to existing participants
        // Assert: Spectate sync response is generated with latest canonical state
        it(
            "should generate spectate sync response with latest canonical state"
        );

        // Arrange: Setup channel with fork situation, spectate request received
        // Act: Spectate sync request is processed during active fork scenario
        // Assert: Spectate sync correctly identifies and provides canonical fork state
        it("should handle spectate sync during active fork scenario");

        // Arrange: Setup channel with dispute windows, spectate request received
        // Act: Spectate sync request is processed with multiple dispute windows
        // Assert: Spectate sync correctly verifies all dispute windows and provides final state
        it("should handle spectate sync with multiple dispute windows");

        // Arrange: Setup channel with spectate request, invalid canonical fork
        // Act: Spectate sync request is processed but canonical fork verification fails
        // Assert: Spectate sync fails gracefully and peer is disconnected
        it("should reject spectate sync with invalid canonical fork");

        // Arrange: Setup channel with spectate request timeout
        // Act: Spectate sync request is sent but no response within agreement time
        // Assert: Spectate request times out and peer is disconnected
        it("should handle spectate sync request timeout");

        // Arrange: Setup channel with spectate request, peer has outdated state
        // Act: Spectate sync request is processed with peer having stale state
        // Assert: Spectate sync provides updated state and peer synchronizes
        it("should handle spectate sync with outdated peer state");

        // Arrange: Setup channel with spectate request, complex dispute resolution
        // Act: Spectate sync request is processed during complex dispute resolution
        // Assert: Spectate sync correctly handles dispute resolution and provides final state
        it("should handle spectate sync during complex dispute resolution");

        // Arrange: Setup channel with spectate request, milestone verification
        // Act: Spectate sync request is processed with milestone verification
        // Assert: Spectate sync correctly verifies milestones and provides valid state
        it("should verify milestones in spectate sync response");

        // Arrange: Setup channel with spectate request, genesis snapshot verification
        // Act: Spectate sync request is processed with genesis snapshot verification
        // Assert: Spectate sync correctly verifies genesis snapshot and provides valid state
        it("should verify genesis snapshot in spectate sync response");

        // Arrange: Setup channel with spectate request, fork dispute verification
        // Act: Spectate sync request is processed with fork dispute status verification
        // Assert: Spectate sync correctly verifies fork dispute status and provides canonical state
        it("should verify fork dispute status in spectate sync response");
    });
});
