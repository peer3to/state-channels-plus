import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";
import { ZeroHash } from "ethers";
import { Codec, Type } from "@/utils";
import { hash } from "../factory";

describe("E2E: Advanced Security", function () {
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

    describe("Byzantine Participant Behavior", function () {
        // Arrange: Setup channel, participant creates two conflicting blocks at same height
        // Act: Participant signs both blocks and sends to different peers
        // Assert: Double sign  Dispute is created and committed on-chain
        it("should create dispute for double-sign detected", async function () {
            // Arrange
            await harness!.setup(3);
            const forkId = await harness!.openChannel();

            // Create 2 blocks so peers sync on blocks at height 0 and height 1
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 0 - height 0
            await harness!.submitNextTransaction((contract) => contract.add(2)); // peer 1 - height 1

            // Verify both peers are in sync after 2 blocks
            harness!.assertAllPeersInSync();
            const latestBlock =
                harness!.peers[0].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );
            expect(latestBlock?.height).to.equal(
                1,
                "Should be at height 1 after 2 blocks"
            );

            // Reset spies after setup
            harness!.resetEventSpies();

            // Act: Peer 1 (who authored the block at height 1) submits a double-sign block at height 1
            await harness!.submitDoubleSignBlock(1, { forkId });

            // Assert: The other peer (peer 0) should detect peer 1's double-sign
            // Wait for peer 0 to detect the double-sign and initiate dispute
            const doubleSignDetected = await harness!.waitForEventCounts(
                "onInitiatingDispute",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 1, expectedCount: 0 }
                ],
                5000
            );

            expect(doubleSignDetected).to.be.true;

            // Verify dispute was committed on-chain
            const disputeCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                [
                    { peerId: 0, expectedCount: 2 },
                    { peerId: 1, expectedCount: 2 }
                ],
                2000
            );
            expect(disputeCommitted).to.be.true;
        });

        // Arrange: Setup channel, participant creates block with invalid state transition
        // Act: Invalid transition detection triggers dispute creation
        // Assert: Dispute is created for invalid state transition
        it("should create dispute for invalid state transition", async function () {
            // Arrange
            await harness!.setup(3);
            const forkId = await harness!.openChannel();

            // Create 2 blocks so peers sync on blocks at height 0 and height 1
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 0 - height 0
            await harness!.submitNextTransaction((contract) => contract.add(2)); // peer 1 - height 1

            // Verify both peers are in sync after 2 blocks
            harness!.assertAllPeersInSync();
            const latestBlock =
                harness!.peers[0].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );
            expect(latestBlock?.height).to.equal(
                1,
                "Should be at height 1 after 2 blocks"
            );

            // Reset spies after setup
            harness!.resetEventSpies();

            // Act: Get the next peer to write and have them submit an invalid state transition block
            // The block will have a valid transaction but wrong state snapshot hash
            await harness!.submitInvalidStateTransitionBlock(2, {
                forkId
            });

            // Assert: The other peer should detect the invalid state transition and initiate dispute
            // Wait for the other peer to detect the invalid state transition and initiate dispute
            const invalidStateTransitionDetected =
                await harness!.waitForEventCounts(
                    "onInitiatingDispute",
                    [
                        { peerId: 0, expectedCount: 1 },
                        { peerId: 1, expectedCount: 1 },
                        { peerId: 2, expectedCount: 0 }
                    ],
                    5000
                );

            expect(invalidStateTransitionDetected).to.be.true;

            // Verify dispute was committed on-chain
            const disputeCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                [
                    { peerId: 0, expectedCount: 2 },
                    { peerId: 1, expectedCount: 2 },
                    { peerId: 2, expectedCount: 2 }
                ],
                4000,
                { mode: "atLeast" }
            );
            expect(disputeCommitted).to.be.true;
        });

        // Arrange: Setup channel with known correct genesis, participant provides different genesis
        // Act: Malicious participant tries to use wrong genesis block
        // Assert: Wrong genesis is detected and participant is rejected/disputed
        it("should detect and handle wrong genesis block");
    });

    describe.skip("Malicious Block Production", function () {
        // Arrange: Setup channel, create block with forged/invalid signature
        // Act: Submit block with bad signature to network
        // Assert: Block is rejected due to signature validation failure
        it("should reject block with invalid signature");

        // Arrange: Setup channel, create block and modify transaction data after signing
        // Act: Submit tampered block to network
        // Assert: Block is rejected due to transaction data integrity check failure
        it("should reject block with tampered transaction data");

        // Arrange: Setup channel with known block chain, create block with wrong previous hash
        // Act: Submit block claiming incorrect parent
        // Assert: Block is rejected due to chain integrity violation
        it("should reject block claiming incorrect previous hash");

        // Arrange: Setup channel with known participants, non-participant creates block
        // Act: Non-participant attempts to submit block
        // Assert: Block is rejected due to unauthorized participant
        it("should reject block from non-participant");
    });

    describe.skip("Fork Management", function () {
        // Arrange: Setup channel, two participants create conflicting blocks at same height
        // Act: Both blocks are propagated to network
        // Assert: Fork is detected and both branches are tracked
        it("should detect fork when conflicting blocks received");

        // Arrange: Same as above, fork has been detected
        // Act: Continue operating with both forks active
        // Assert: System maintains both fork states until dispute resolution
        it("should maintain both forks until resolution");

        // Arrange: Setup active fork situation with dispute evidence
        // Act: Submit dispute proof to resolve fork
        // Assert: Fork is resolved through dispute mechanism, correct fork chosen
        it("should resolve fork through dispute mechanism");

        // Arrange: Same as above, dispute resolution identifies malicious participant
        // Act: Fork resolution completes with fraud proof
        // Assert: Malicious participant is slashed, funds redistributed
        it("should slash malicious participant in fork resolution");

        // Arrange: Fork resolution has completed with slashing
        // Act: Broadcast fork resolution results to all participants
        // Assert: All participants update to resolved fork, remove invalid fork
        it("should update all participants after fork resolution");
    });

    describe("Dispute Flow", function () {
        it("should reduce honest invalid state transition disputes and create new fork", async function () {
            // Arrange - Setup with 4 participants
            await harness!.setup(4, {
                timeConfig: {
                    p2pTime: 3,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            });
            const originalForkId = await harness!.openChannel();

            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) => contract.add(2));

            harness!.assertAllPeersInSync();

            // Reset spies
            harness!.resetEventSpies();

            // Act - Create an invalid state transition dispute (honest dispute, happy path)
            // Get the next peer to write and have them submit an invalid state transition block
            const nextPeer = await harness!.getNextPeerToWrite();
            await harness!.submitInvalidStateTransitionBlock(nextPeer.index, {
                forkId: originalForkId
            });

            // Wait for disputes to be observed on all peers
            const disputeCommitedObserved = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                [
                    { peerId: 0, expectedCount: 3 },
                    { peerId: 1, expectedCount: 3 },
                    { peerId: 2, expectedCount: 3 },
                    { peerId: 3, expectedCount: 3 }
                ],
                5000
            );
            expect(disputeCommitedObserved).to.be.true;

            const forkChanged = await harness!.waitForCondition(() => {
                const peerForks = harness!.peers
                    .map((p) => p.stateManager.forkId)
                    .filter(
                        (forkId) =>
                            forkId !== ZeroHash && forkId !== originalForkId
                    );
                // All 3 honest peers should have the new fork after successful reduction
                return peerForks.length >= 3 && new Set(peerForks).size === 1;
            }, 10000); // Wait up to 10 seconds for reduction processing

            // Assert - Reduction should have occurred (fork IDs changed)
            expect(forkChanged).to.be.true;
        });

        it("should remove malicious participant after fork and keep liveness", async function () {
            // Arrange - same timing as reduction happy path
            await harness!.setup(4, {
                timeConfig: {
                    p2pTime: 3,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            });
            const originalForkId = await harness!.openChannel();

            // Establish baseline state
            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) => contract.add(2));
            harness!.assertAllPeersInSync();

            // Reset spies so we only count dispute-related activity
            harness!.resetEventSpies();

            // Act - have the next writer broadcast an invalid block
            const maliciousPeer = harness!.peers[2];
            const honestPeers = [
                harness!.peers[0],
                harness!.peers[1],
                harness!.peers[3]
            ];
            const maliciousIndex = maliciousPeer.index;
            const honestIndices = honestPeers.map((peer) => peer.index);

            await harness!.submitInvalidStateTransitionBlock(maliciousIndex, {
                forkId: originalForkId
            });

            // Wait for disputes to be committed across peers
            const disputesCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                harness!.peers.map((peer) => ({
                    peerId: peer.index,
                    expectedCount: 3
                })),
                8000,
                { mode: "atLeast" }
            );
            expect(disputesCommitted).to.be.true;

            // Wait for honest peers to agree on the new fork
            const forkSettled = await harness!.waitForCondition(() => {
                const forkIds = honestPeers.map(
                    (peer) => peer.stateManager.forkId
                );
                const uniqueForks = new Set(forkIds);
                const allMoved =
                    forkIds.length > 0 &&
                    forkIds.every(
                        (forkId) =>
                            forkId !== originalForkId && forkId !== ZeroHash
                    );
                return allMoved && uniqueForks.size === 1;
            }, 10000);
            expect(forkSettled).to.be.true;

            // Assert - malicious participant removed from new fork
            for (const peer of honestPeers) {
                const participants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                expect(participants).to.have.lengthOf(honestPeers.length);

                expect(participants).to.not.include(maliciousPeer.address);
            }

            // advance the state between honest peers
            await harness!.submitTransaction(
                honestPeers[2],
                (contract) => contract.add(1),
                { waitForTurn: true }
            ); // peer 3 turn
            await harness!.submitTransaction(
                honestPeers[0],
                (contract) => contract.add(2),
                { waitForTurn: true }
            ); // peer 0 turn
            await harness!.submitTransaction(
                honestPeers[1],
                (contract) => contract.add(3),
                {
                    waitForTurn: true,
                    waitForPeers: honestIndices,
                    waitForSync: true
                }
            ); // peer 1 turn
            // await sleep(500)
            harness!.assertAllPeersInSync({ peerIndices: honestIndices });

            // Assert - only honest peers continue authoring and syncing on new fork
            const nextWriter = await harness!.getNextPeerToWrite();
            expect(nextWriter.index).to.not.equal(
                maliciousIndex, // 2
                "Removed peer should NOT receive next turn"
            );
        });
    });

    describe("Dishonest disputes", function () {
        // Arrange: peer submits dispute with tampered auditing data commitment
        // Act: tampered dispute is posted on-chain
        // Assert: validation rejects it, dispute is killed, fork stays unchanged
        it("should reject dispute with incorrect auditing data commitment", async function () {
            await harness!.setup(3);
            const originalForkId = await harness!.openChannel();

            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) => contract.add(2));
            harness!.assertAllPeersInSync();
            harness!.resetEventSpies();

            // Peer 1 crafts and posts a tampered dispute
            const { dispute } = await harness!.postTamperedDispute(
                1,
                (dispute) => {
                    dispute.input.disputeAuditingDataHash = hash();
                },
                originalForkId
            );

            const killed = await harness!.waitForEventCounts(
                "onDisputeKilled",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 1, expectedCount: 1 },
                    { peerId: 2, expectedCount: 1 }
                ],
                3000,
                { mode: "atLeast" }
            );
            expect(killed).to.be.true;

            // Wait for dispute fraud proof to be stored (validation rejection)
            const fraudProofStored = await harness!.waitForCondition(() => {
                return harness!.peers.every((peer) => {
                    const proof =
                        peer.stateManager.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                            dispute
                        );
                    return !!proof;
                });
            }, 2000);
            expect(fraudProofStored).to.be.true;

            const forkUnchanged = harness!.peers.every(
                (p) => p.stateManager.forkId === originalForkId
            );
            expect(forkUnchanged).to.be.true;
        });

        // Arrange: peer submits timeout dispute accusing a participant who is not next to write
        // Act: tampered timeout data is posted on-chain
        // Assert: validation rejects it, dispute is killed, fork stays unchanged
        it("should reject timeout dispute when accused participant is not next to write", async function () {
            await harness!.setup(3);
            const originalForkId = await harness!.openChannel();

            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) => contract.add(2));
            harness!.assertAllPeersInSync();
            harness!.resetEventSpies();

            const notNextPeer = harness!.peers[1];

            const { dispute: timeoutDispute } =
                await harness!.postTamperedDispute(
                    0,
                    (dispute) => {
                        dispute.input.timeout.participant = notNextPeer.address;
                    },
                    originalForkId
                );

            // Wait for dispute fraud proof to be stored (validation rejection)
            const fraudProofStored = await harness!.waitForCondition(() => {
                return harness!.peers.every((peer) => {
                    const proof =
                        peer.stateManager.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                            timeoutDispute
                        );
                    return !!proof;
                });
            }, 3000);
            expect(fraudProofStored).to.be.true;

            const forkUnchanged = harness!.peers.every(
                (p) => p.stateManager.forkId === originalForkId
            );
            expect(forkUnchanged).to.be.true;
        });

        // Arrange: tamper stateProof milestone so auditing data reconstruction is partial
        // Act: run validateDispute -> should enter isPartial path and reject with fraud proof
        // Assert: validateDispute returns false and fraud proof is stored
        it("should reject dispute when auditing data is partial and state proof invalid", async function () {
            await harness!.setup(2);
            const forkId = await harness!.openChannel();
            await harness!.submitNextTransaction((c) => c.add(1));
            await harness!.submitNextTransaction((c) => c.add(2));

            const { dispute } =
                await harness!.peers[0].stateManager.disputeManager.constructDispute(
                    forkId
                );

            // Tamper the first milestone's first signed block to reference an unknown snapshot
            const tamperedStateProof = { ...dispute.input.stateProof };
            if (
                tamperedStateProof.milestones.length === 0 ||
                tamperedStateProof.milestones[0].blockConfirmations.length === 0
            ) {
                throw new Error("No milestones to tamper");
            }
            const firstBc =
                tamperedStateProof.milestones[0].blockConfirmations[0];
            const block = Codec.decode(
                firstBc.signedBlock.encodedBlock,
                Type.Block
            );
            block.stateSnapshotHash = hash(); // not stored
            firstBc.signedBlock.encodedBlock = Codec.encode(block, Type.Block);

            const tamperedDispute = {
                ...dispute,
                input: { ...dispute.input, stateProof: tamperedStateProof }
            };

            const isValid =
                await harness!.peers[0].stateManager.disputeValidationService.validateDispute(
                    tamperedDispute
                );
            expect(isValid).to.be.false;

            const fraudProof =
                harness!.peers[0].stateManager.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    tamperedDispute
                );
            expect(fraudProof).to.not.be.undefined;
        });
    });

    describe.skip("Economic Security", function () {
        // Arrange: Setup completed fraud proof and dispute resolution
        // Act: Execute slashing of proven malicious participant
        // Assert: Participant funds are slashed according to fraud proof
        it("should slash participant for proven fraud");

        // Arrange: Slashing has occurred, slashed funds need redistribution
        // Act: Redistribute slashed funds to honest participants
        // Assert: Funds are distributed correctly according to protocol rules
        it("should redistribute slashed funds correctly");

        // Arrange: Setup active channel with ongoing operations, fraud detected
        // Act: Execute slashing while channel is still operating
        // Assert: Slashing completes without disrupting ongoing channel operations
        it("should handle slashing during active channel operation");
    });
});
