import { expect } from "chai";
import { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
import { AStateMachine, MathStateMachine } from "@typechain-types/index";
import { ForkId } from "@/types/types";
import { hash } from "../factory";
import { ATransport } from "@/transport";

describe("E2E: RPC Services", function () {
    let harness: PeerTestHarness<MathStateMachine>;

    beforeEach(async function () {
        harness = new PeerTestHarness<MathStateMachine>();
        await harness.setup(3);
        await harness.openChannel();
    });

    afterEach(async function () {
        if (harness) {
            await harness.cleanup();
        }
    });

    describe("IsForkDisputed RPC", function () {
        let byzantinePeer: TestPeer<MathStateMachine>;
        let nonByzantinePeers: TestPeer<MathStateMachine>[];

        beforeEach(async function () {
            byzantinePeer = harness.peers[1];
            nonByzantinePeers = [harness.peers[0], harness.peers[2]];

            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) => contract.add(1));

            harness.assertAllPeersInSync();
            harness.resetEventSpies();

            // Create double-sign scenario to trigger dispute
            await harness.submitDoubleSignBlock(byzantinePeer.index);

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

        const getConnectionCount = (peer: TestPeer<AStateMachine>) =>
            peer.stateManager.p2pManager.openConnections.length;

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
            const connectionsBefore = getConnectionCount(requestingPeer);

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
                    connectionsBefore - getConnectionCount(requestingPeer) ===
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
            const connectionsBefore = getConnectionCount(receivingPeer);

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
                    connectionsBefore - getConnectionCount(receivingPeer) === 1,
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

            const connectionsBefore = getConnectionCount(respondingPeer);

            // Act - Second response (duplicate, should trigger disconnection)
            await respondingPeerService.respondToDisputeAcknowledgment(
                transport,
                requestingPeer.stateManager.channelId,
                harness.activeForkId!
            );

            // Assert - Responding peer should disconnect requesting peer
            const assertion = await harness.waitForCondition(
                () =>
                    connectionsBefore - getConnectionCount(respondingPeer) ===
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

            const connectionsBefore = getConnectionCount(requestingPeer);

            // Act
            requestAcknowledgment(requestingPeer, nonDisputedForkId);

            // Timeout is 2 * agreementTime (1 second) = 2 seconds
            const timeoutMs =
                2 * requestingPeer.stateManager.timeConfig.agreementTime * 1000;
            await harness.waitForCondition(() => {
                return getConnectionCount(requestingPeer) < connectionsBefore;
            }, timeoutMs + 1000);

            disconnectSpies.forEach((spy) => spy.restore());

            // Assert
            const connectionsAfter = getConnectionCount(requestingPeer);
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

            const isDisputedOnChain = await harness.waitForCondition(
                () =>
                    receivingPeer.stateManager.stateChannelManagerContract.isForkDisputed(
                        harness.channelId,
                        harness.activeForkId!
                    ),
                5000
            );

            expect(
                isDisputedOnChain,
                "timed out waiting for fork to be disputed on-chain"
            ).to.be.true;

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
