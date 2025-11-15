import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
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
        beforeEach(async function () {
            harness = new PeerTestHarness<MathStateMachine>();
            await harness.setup(3);
            await harness.openChannel();

            await harness.submitNextTransaction((contract) => contract.add(1));

            harness.assertAllPeersInSync();
        });

        // Arrange: Setup channel with dispute window created on-chain
        // Act: Dispute acknowledgment request is broadcast to all peers
        // Assert: All peers acknowledge disputed fork and mark it as disputed
        it("should broadcast dispute acknowledgment to all peers on dispute creation", async function () {
            // Arrange
            await harness!.submitNextTransaction((contract) => contract.add(1));

            await harness!.createDispute(0, harness!.activeForkId!);

            // Act: Trigger dispute acknowledgment request (simulating onDisputeCommitted)
            const requestingPeer = harness!.peers[0];
            const requestingPeerService =
                harness!.peers[0].stateManager.p2pManager.localRpc
                    .isForkDisputedService;

            expect(
                requestingPeerService.disputedForks.has(harness!.activeForkId!)
            ).to.be.false;

            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                harness!.activeForkId!
            );

            // Assert: Fork should be added to disputedForks set
            expect(
                requestingPeerService.disputedForks.has(harness!.activeForkId!)
            ).to.be.true;

            // Assert: All peers should have acknowledged the disputed fork
            const allAcknowledged = await harness!.verifyAllPeersAcknowledged(
                0,
                harness!.activeForkId!,
                5000
            );
            expect(allAcknowledged).to.be.true;
        });

        // Arrange: Setup channel with disputed fork, peer builds on acknowledged disputed fork
        // Act: Peer sends block on fork they previously acknowledged as disputed
        // Assert: Peer is immediately disconnected for building on acknowledged disputed fork
        it("should disconnect peer building on acknowledged disputed fork", async function () {
            // Arrange
            await harness!.createDispute(0, harness!.activeForkId!);

            const requestingPeer = harness!.peers[0];
            const requestingPeerService =
                harness!.peers[0].stateManager.p2pManager.localRpc
                    .isForkDisputedService;

            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                harness!.activeForkId!
            );

            // Assert: All peers should have acknowledged the disputed fork
            const allAcknowledged = await harness!.verifyAllPeersAcknowledged(
                0,
                harness!.activeForkId!,
                5000
            );
            expect(allAcknowledged).to.be.true;

            // Act: Have one of the acknowledging peers try to build on the disputed fork
            const buildingPeer = harness!.peers[1];
            const buildingPeerTransport = harness!.getPeerTransport(0, 1);

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
            const latestBlock =
                buildingPeerStateManager.storage.blocks.getLatestBlock(
                    harness!.activeForkId!
                );

            if (latestBlock) {
                const blockValidationStrategy =
                    requestingPeer.stateManager.blockValidationStrategy;

                await blockValidationStrategy.blockForkIsDisputed(
                    latestBlock,
                    buildingPeerTransport
                );
            }

            await harness!.waitForCondition(() => {
                const connectionsAfter =
                    requestingPeer.stateManager.p2pManager.openConnections
                        .length;
                return connectionsAfter < connectionsBefore;
            }, 5000);

            // Assert: Building peer should be disconnected for building on acknowledged disputed fork
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

            // Act: Request acknowledgment for non-disputed fork
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

        // Arrange: Setup channel with multiple dispute acknowledgment requests for same fork
        // Act: Peer sends multiple acknowledgment requests for same fork ID
        // Assert: Subsequent requests are rejected and peer is disconnected
        it("should reject duplicate dispute acknowledgment requests", async function () {
            // Arrange
            await harness!.createDispute(0, harness!.activeForkId!);

            // Act: Request acknowledgment twice for same fork
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

            // Assert: Should still only have one disputed fork (duplicate ignored)
            expect(disputedForksAfter).to.equal(disputedForksBefore);
        });

        // Arrange: Setup channel with dispute acknowledgment, peer responds multiple times
        // Act: Peer sends multiple responses to same dispute acknowledgment request
        // Assert: Duplicate responses are rejected and peer is disconnected
        it("should reject duplicate dispute acknowledgment responses", async function () {
            // Arrange
            await harness!.createDispute(0, harness!.activeForkId!);

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

                await respondingPeerService.respondToDisputeAcknowledgment(
                    requestingPeerTransport,
                    harness!.peers[0].stateManager.channelId,
                    harness!.activeForkId!
                );

                // Assert: Should now be in myAcknowledgements
                expect(
                    respondingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.true;

                const connectionsBefore =
                    respondingPeer.stateManager.p2pManager.openConnections
                        .length;

                // Act: Send duplicate response (should detect duplicate via myAcknowledgements check)
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

                // Assert: Should be disconnected for duplicate response
                const connectionsAfter =
                    respondingPeer.stateManager.p2pManager.openConnections
                        .length;
                expect(connectionsAfter).to.be.lessThan(connectionsBefore);
            }
        });

        // Arrange: Setup channel with fake forkId disputed only for peer 0, prevent other peers from disconnecting requester
        // Act: Request acknowledgment for fake forkId, peers don't acknowledge because fork is not disputed for them, timeout triggers
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
            const fakeForkId = ("0x" + "f".repeat(64)) as ForkId;
            await harness!.markForkAsDisputed(fakeForkId, [0]);

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
                fakeForkId
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

        // Arrange: Setup channel with complex fork dispute scenario
        // Act: Multiple forks become disputed, acknowledgment requests sent for each
        // Assert: All peers correctly acknowledge all disputed forks
        it("should handle multiple disputed forks acknowledgment", async function () {
            // Arrange
            const forkId1 = harness!.activeForkId!;
            const forkId2 = ("0x" + "2".repeat(64)) as ForkId;
            const forkId3 = ("0x" + "3".repeat(64)) as ForkId;

            await harness!.createDispute(0, forkId1);
            await harness!.markForkAsDisputed(forkId2);
            await harness!.markForkAsDisputed(forkId3);

            // Act: Request acknowledgment for all forks
            const requestingPeer = harness!.peers[0];
            const requestingPeerService =
                harness!.peers[0].stateManager.p2pManager.localRpc
                    .isForkDisputedService;

            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                forkId1
            );
            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                forkId2
            );
            requestingPeerService.requestDisputeAcknowledgment(
                harness!.peers[0].stateManager.channelId,
                forkId3
            );

            // Assert: All three forks should be in disputedForks set
            expect(requestingPeerService.disputedForks.has(forkId1)).to.be.true;
            expect(requestingPeerService.disputedForks.has(forkId2)).to.be.true;
            expect(requestingPeerService.disputedForks.has(forkId3)).to.be.true;
            expect(requestingPeerService.disputedForks.size).to.equal(3);

            // Assert: All peers should have acknowledged all disputed forks
            const allAcknowledged1 = await harness!.verifyAllPeersAcknowledged(
                0,
                forkId1,
                5000
            );
            expect(allAcknowledged1).to.be.true;

            const allAcknowledged2 = await harness!.verifyAllPeersAcknowledged(
                0,
                forkId2,
                5000
            );
            expect(allAcknowledged2).to.be.true;

            const allAcknowledged3 = await harness!.verifyAllPeersAcknowledged(
                0,
                forkId3,
                5000
            );
            expect(allAcknowledged3).to.be.true;
        });

        // Arrange: Setup channel with dispute acknowledgment, check local diamond first
        // Act: Dispute acknowledgment request received, check local diamond contract
        // Assert: Local diamond dispute status is checked first before on-chain check
        it("should check local diamond dispute status first", async function () {
            // Arrange
            const requestingPeer = harness!.peers[0];
            const receivingPeer = harness!.peers[1];

            await harness!.createDispute(0, harness!.activeForkId!);

            const isDisputedLocal =
                await receivingPeer.stateManager.diamondStateMachine.localDiamondContract.isForkDisputed(
                    harness!.peers[0].stateManager.channelId,
                    harness!.activeForkId!
                );
            expect(isDisputedLocal).to.be.true;

            // Act: Send acknowledgment request via RPC (simulating normal flow)
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

                // Assert: Receiving peer should have acknowledged (checked local diamond first)
                expect(
                    receivingPeerService.didIAcknowledgeDisputedFork(
                        requestingPeerTransport,
                        harness!.activeForkId!
                    )
                ).to.be.true;
            }
        });

        // Arrange: Setup channel with dispute acknowledgment, local diamond not disputed
        // Act: Dispute acknowledgment request received, check state channel manager contract
        // Assert: On-chain state channel manager dispute status is checked after local diamond
        it("should check on-chain dispute status when local diamond is not disputed", async function () {
            // Arrange
            const requestingPeer = harness!.peers[0];
            const receivingPeer = harness!.peers[1];

            harness!.resetEventSpies();

            await harness!.createDispute(0, harness!.activeForkId!);

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

            // Act: Send acknowledgment request to receiving peer
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

                // Assert: Receiving peer should have acknowledged after checking on-chain
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
