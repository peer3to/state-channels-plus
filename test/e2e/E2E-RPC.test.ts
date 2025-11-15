import { expect } from "chai";
import { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";
import { ForkId } from "@/types/types";

describe("E2E: RPC Services", function () {
    let harness: PeerTestHarness<MathStateMachine> | null = null;

    beforeEach(async function () {
        harness = new PeerTestHarness<MathStateMachine>();
    });

    afterEach(async function () {
        if (harness) {
            await harness.cleanup();
            harness = null;
        }
    });

    describe("IsForkDisputed RPC", function () {
        let authorPeer: TestPeer<MathStateMachine>;

        beforeEach(async function () {
            harness = new PeerTestHarness<MathStateMachine>();
            await harness.setup(3);
            await harness.openChannel();

            await harness.submitNextTransaction((contract) => contract.add(1));

            harness.assertAllPeersInSync();
            harness.resetEventSpies();

            const targetForkId = harness.activeForkId!;
            const latestBlock =
                harness.peers[0].stateManager.storage.blocks.getLatestBlock(
                    targetForkId
                );
            if (!latestBlock) {
                throw new Error("No latest block found");
            }
            const foundAuthorPeer = harness.peers.find(
                (p) => p.address === latestBlock.author
            );
            if (!foundAuthorPeer) {
                throw new Error(
                    `No peer found for author ${latestBlock.author}`
                );
            }
            authorPeer = foundAuthorPeer;

            const authorPeerLatestBlock =
                authorPeer.stateManager.storage.blocks.getLatestBlock(
                    targetForkId
                );
            if (
                !authorPeerLatestBlock ||
                authorPeerLatestBlock.height !== latestBlock.height
            ) {
                throw new Error(
                    `Author peer ${authorPeer.index} doesn't have the latest block`
                );
            }

            await harness.submitDoubleSignBlock(authorPeer.index, {
                forkId: targetForkId
            });

            const otherPeers = [0, 1, 2].filter((i) => i !== authorPeer.index);
            const fraudDetected = await harness.waitForEventCounts(
                "onInitiatingDispute",
                [
                    { peerId: otherPeers[0], expectedCount: 1 },
                    { peerId: authorPeer.index, expectedCount: 0 }
                ],
                10000
            );
            if (!fraudDetected) {
                throw new Error("Fraud was not detected");
            }

            const disputeCommitted = await harness.waitForCondition(() => {
                for (let i = 0; i < 3; i++) {
                    const count = harness!.getEventCallCount(
                        i,
                        "onDisputeCommitted"
                    );
                    if (count < 1) {
                        return false;
                    }
                }
                return true;
            }, 10000);
            if (!disputeCommitted) {
                throw new Error("Dispute was not committed");
            }
        });

        // Arrange: Setup channel with dispute window created on-chain
        // Act: Dispute acknowledgment request is broadcast to all peers
        // Assert: All peers acknowledge disputed fork and mark it as disputed
        it("should broadcast dispute acknowledgment to all peers on dispute creation", async function () {
            // Arrange
            const nonMaliciousPeers = [0, 1, 2].filter(
                (i) => i !== authorPeer.index
            );
            const requestingPeerIndex = nonMaliciousPeers[0];
            const requestingPeer = harness!.peers[requestingPeerIndex];
            const requestingPeerService =
                requestingPeer.stateManager.p2pManager.localRpc
                    .isForkDisputedService;

            const alreadyRequested = requestingPeerService.disputedForks.has(
                harness!.activeForkId!
            );

            // Act
            if (!alreadyRequested) {
                requestingPeerService.requestDisputeAcknowledgment(
                    requestingPeer.stateManager.channelId,
                    harness!.activeForkId!
                );
            }

            // Assert
            expect(
                requestingPeerService.disputedForks.has(harness!.activeForkId!)
            ).to.be.true;

            await new Promise((resolve) => setTimeout(resolve, 200));

            const allAcknowledged = await harness!.verifyAllPeersAcknowledged(
                requestingPeerIndex,
                harness!.activeForkId!,
                5000,
                [authorPeer.index]
            );
            expect(allAcknowledged).to.be.true;
        });

        // Arrange: Setup channel with disputed fork, request acknowledgment and verify all peers acknowledged
        // Act: Check if peer is building on acknowledged disputed fork
        // Assert: Peer is immediately disconnected for building on acknowledged disputed fork
        it("should disconnect peer building on acknowledged disputed fork", async function () {
            // Arrange
            const nonMaliciousPeers = [0, 1, 2].filter(
                (i) => i !== authorPeer.index
            );
            const requestingPeerIndex = nonMaliciousPeers[0];
            const requestingPeer = harness!.peers[requestingPeerIndex];
            const requestingPeerService =
                requestingPeer.stateManager.p2pManager.localRpc
                    .isForkDisputedService;

            requestingPeerService.requestDisputeAcknowledgment(
                requestingPeer.stateManager.channelId,
                harness!.activeForkId!
            );

            const allAcknowledged = await harness!.verifyAllPeersAcknowledged(
                requestingPeerIndex,
                harness!.activeForkId!,
                5000,
                [authorPeer.index]
            );
            expect(allAcknowledged).to.be.true;

            // Act
            const buildingPeerIndex = nonMaliciousPeers[1];
            const buildingPeer = harness!.peers[buildingPeerIndex];
            const buildingPeerTransport = harness!.getPeerTransport(
                requestingPeerIndex,
                buildingPeerIndex
            );

            expect(buildingPeerTransport).to.not.be.undefined;

            expect(
                requestingPeerService.didPeerAcknowledgeDisputedFork(
                    buildingPeerTransport!,
                    harness!.activeForkId!
                )
            ).to.be.true;

            const connectionsBefore =
                requestingPeer.stateManager.p2pManager.openConnections.length;

            const buildingPeerStateManager = buildingPeer.stateManager;
            const buildingLatestBlock =
                buildingPeerStateManager.storage.blocks.getLatestBlock(
                    harness!.activeForkId!
                );

            if (buildingLatestBlock) {
                const blockValidationStrategy =
                    requestingPeer.stateManager.blockValidationStrategy;

                await blockValidationStrategy.blockForkIsDisputed(
                    buildingLatestBlock,
                    buildingPeerTransport
                );
            }

            await harness!.waitForCondition(() => {
                const connectionsAfter =
                    requestingPeer.stateManager.p2pManager.openConnections
                        .length;
                return connectionsAfter < connectionsBefore;
            }, 5000);

            // Assert
            const connectionsAfter =
                requestingPeer.stateManager.p2pManager.openConnections.length;
            expect(connectionsAfter).to.be.lessThan(connectionsBefore);
        });

        // Arrange: Setup channel with fork that is not disputed locally or on-chain
        // Act: Dispute acknowledgment request is sent for non-disputed fork
        // Assert: Peer disconnects sender for requesting acknowledgment of non-disputed fork
        it("should disconnect peer requesting acknowledgment of non-disputed fork", async function () {
            // Arrange
            const fakeForkId = ("0x" + "1".repeat(64)) as ForkId;

            // Act
            const requestingPeer = harness!.peers[0];
            const receivingPeer = harness!.peers[1];

            const connectionsBefore =
                requestingPeer.stateManager.p2pManager.openConnections.length;

            const receivingPeerService =
                harness!.peers[1].stateManager.p2pManager.localRpc
                    .isForkDisputedService;
            const requestingPeerTransport = harness!.getPeerTransport(1, 0);

            if (requestingPeerTransport) {
                await receivingPeerService
                    .createRPCMethods(requestingPeerTransport)
                    .onDisputeAcknowledgmentRequest(
                        harness!.peers[0].stateManager.channelId,
                        fakeForkId
                    );
            }

            await harness!.waitForCondition(() => {
                const connectionsAfter =
                    receivingPeer.stateManager.p2pManager.openConnections
                        .length;
                return connectionsAfter < connectionsBefore;
            }, 5000);

            // Assert: Requesting peer should be disconnected
            const connectionsAfter =
                receivingPeer.stateManager.p2pManager.openConnections.length;
            expect(connectionsAfter).to.be.lessThan(connectionsBefore);
        });

        // Arrange: Setup channel with disputed fork
        // Act: Peer sends multiple acknowledgment requests for same fork ID
        // Assert: Subsequent requests are rejected
        it("should reject duplicate dispute acknowledgment requests", async function () {
            // Act
            const requestingPeer = harness!.peers[0];
            const requestingPeerService =
                harness!.peers[0].stateManager.p2pManager.localRpc
                    .isForkDisputedService;
            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                harness!.activeForkId!
            );

            const disputedForksBefore =
                requestingPeerService.disputedForks.size;
            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                harness!.activeForkId!
            );
            const disputedForksAfter = requestingPeerService.disputedForks.size;

            // Assert
            expect(disputedForksAfter).to.equal(disputedForksBefore);
        });

        // Arrange: Setup channel with disputed fork, get transport between peers
        // Act: Peer sends multiple responses to same dispute acknowledgment request
        // Assert: Duplicate responses are rejected and peer is disconnected
        it("should reject duplicate dispute acknowledgment responses", async function () {
            // Arrange
            const requestingPeer = harness!.peers[0];
            const respondingPeer = harness!.peers[1];
            const respondingPeerService =
                harness!.peers[1].stateManager.p2pManager.localRpc
                    .isForkDisputedService;

            const requestingPeerTransport = harness!.getPeerTransport(1, 0);

            if (requestingPeerTransport) {
                expect(
                    respondingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.false;

                // Act
                await respondingPeerService.respondToDisputeAcknowledgment(
                    requestingPeerTransport,
                    harness!.peers[0].stateManager.channelId,
                    harness!.activeForkId!
                );

                expect(
                    respondingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.true;

                const connectionsBefore =
                    respondingPeer.stateManager.p2pManager.openConnections
                        .length;

                await respondingPeerService.respondToDisputeAcknowledgment(
                    requestingPeerTransport,
                    harness!.peers[0].stateManager.channelId,
                    harness!.activeForkId!
                );

                await harness!.waitForCondition(() => {
                    const connectionsAfter =
                        respondingPeer.stateManager.p2pManager.openConnections
                            .length;
                    return connectionsAfter < connectionsBefore;
                }, 5000);

                // Assert
                const connectionsAfter =
                    respondingPeer.stateManager.p2pManager.openConnections
                        .length;
                expect(connectionsAfter).to.be.lessThan(connectionsBefore);
            }
        });

        // Arrange: Setup channel with non-disputed forkId, prevent peers from disconnecting requester
        // Act: Request acknowledgment for non-disputed forkId, peers don't acknowledge because fork is not disputed, timeout triggers
        // Assert: Non-responding peers are disconnected after timeout period
        it("should handle dispute acknowledgment request timeout", async function () {
            // Arrange
            await harness!.cleanup();
            await harness!.setup(3, {
                timeConfig: {
                    agreementTime: 1
                }
            });
            const forkId = await harness!.openChannel();
            await harness!.connectPeers();

            await harness!.submitNextTransaction((contract) => contract.add(1));

            const requestingPeer = harness!.peers[0];
            const nonDisputedForkId = ("0x" + "f".repeat(64)) as ForkId;

            const disconnectSpies: Array<{ restore: () => void }> = [];
            for (let i = 1; i < 3; i++) {
                const peer = harness!.peers[i];
                const originalDisconnect =
                    peer.stateManager.p2pManager.disconnectAndBlacklistPeer.bind(
                        peer.stateManager.p2pManager
                    );
                const spy = (transport: any) => {
                    const profile =
                        peer.stateManager.p2pManager.profileManager.getProfileByTransport(
                            transport
                        );
                    if (profile?.evmAddress === requestingPeer.address) {
                        return;
                    }
                    return originalDisconnect(transport);
                };
                peer.stateManager.p2pManager.disconnectAndBlacklistPeer =
                    spy as any;
                disconnectSpies.push({
                    restore: () => {
                        peer.stateManager.p2pManager.disconnectAndBlacklistPeer =
                            originalDisconnect;
                    }
                });
            }

            const connectionsBefore =
                requestingPeer.stateManager.p2pManager.openConnections.length;

            // Act
            const requestingPeerService =
                harness!.peers[0].stateManager.p2pManager.localRpc
                    .isForkDisputedService;
            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                nonDisputedForkId
            );

            const timeoutMs =
                2 * requestingPeer.stateManager.timeConfig.agreementTime * 1000;
            await harness!.waitForCondition(() => {
                const connectionsAfter =
                    requestingPeer.stateManager.p2pManager.openConnections
                        .length;
                return connectionsAfter < connectionsBefore;
            }, timeoutMs + 1000);

            disconnectSpies.forEach((spy) => spy.restore());

            // Assert
            const connectionsAfter =
                requestingPeer.stateManager.p2pManager.openConnections.length;
            expect(connectionsAfter).to.be.lessThan(connectionsBefore);
        });

        // Arrange: Setup channel with disputed fork
        // Act: Dispute acknowledgment request sent for disputed fork
        // Assert: All peers correctly acknowledge the disputed fork
        it("should handle disputed fork acknowledgment", async function () {
            // Arrange
            const forkId1 = harness!.activeForkId!;

            // Act
            const nonMaliciousPeers = [0, 1, 2].filter(
                (i) => i !== authorPeer.index
            );
            const requestingPeerIndex = nonMaliciousPeers[0];
            const requestingPeer = harness!.peers[requestingPeerIndex];
            const requestingPeerService =
                requestingPeer.stateManager.p2pManager.localRpc
                    .isForkDisputedService;

            requestingPeerService.requestDisputeAcknowledgment(
                requestingPeer.stateManager.channelId,
                forkId1
            );

            // Assert
            expect(requestingPeerService.disputedForks.has(forkId1)).to.be.true;
            expect(requestingPeerService.disputedForks.size).to.equal(1);

            const allAcknowledged1 = await harness!.verifyAllPeersAcknowledged(
                requestingPeerIndex,
                forkId1,
                5000,
                [authorPeer.index]
            );
            expect(allAcknowledged1).to.be.true;
        });

        // Arrange: Setup channel with disputed fork, verify local diamond shows fork as disputed
        // Act: Dispute acknowledgment request received
        // Assert: Peer acknowledges disputed fork after receiving request
        it("should acknowledge disputed fork when local diamond shows fork as disputed", async function () {
            // Arrange
            const requestingPeer = harness!.peers[0];
            const receivingPeer = harness!.peers[1];

            const isDisputedLocal =
                await receivingPeer.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                    harness!.peers[0].stateManager.channelId,
                    harness!.activeForkId!
                );
            expect(isDisputedLocal).to.be.true;

            // Act
            const requestingPeerTransport = harness!.getPeerTransport(1, 0);

            if (requestingPeerTransport) {
                const receivingPeerService =
                    harness!.peers[1].stateManager.p2pManager.localRpc
                        .isForkDisputedService;

                expect(
                    receivingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.false;

                await receivingPeerService
                    .createRPCMethods(requestingPeerTransport)
                    .onDisputeAcknowledgmentRequest(
                        harness!.peers[0].stateManager.channelId,
                        harness!.activeForkId!
                    );

                await harness!.waitForCondition(() => {
                    return receivingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    );
                }, 5000);

                // Assert
                expect(
                    receivingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.true;
            }
        });

        // Arrange: Setup channel with disputed fork, wait for dispute to be committed on-chain
        // Act: Dispute acknowledgment request received
        // Assert: Peer acknowledges disputed fork after receiving request
        it("should acknowledge disputed fork when dispute is committed on-chain", async function () {
            // Arrange
            const requestingPeer = harness!.peers[0];
            const receivingPeer = harness!.peers[1];

            await harness!.waitForCondition(async () => {
                const isDisputedOnChain =
                    await receivingPeer.stateManager.stateChannelManagerContract.isForkDisputed(
                        harness!.peers[0].stateManager.channelId,
                        harness!.activeForkId!
                    );
                return isDisputedOnChain;
            }, 5000);

            const isDisputedOnChain =
                await receivingPeer.stateManager.stateChannelManagerContract.isForkDisputed(
                    harness!.peers[0].stateManager.channelId,
                    harness!.activeForkId!
                );

            if (!isDisputedOnChain) {
                return;
            }

            // Act
            const requestingPeerTransport = harness!.getPeerTransport(1, 0);

            if (requestingPeerTransport) {
                const receivingPeerService =
                    harness!.peers[1].stateManager.p2pManager.localRpc
                        .isForkDisputedService;

                expect(
                    receivingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.false;

                await receivingPeerService
                    .createRPCMethods(requestingPeerTransport)
                    .onDisputeAcknowledgmentRequest(
                        harness!.peers[0].stateManager.channelId,
                        harness!.activeForkId!
                    );

                await harness!.waitForCondition(() => {
                    return receivingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    );
                }, 5000);

                // Assert
                expect(
                    receivingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.true;
            }
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
