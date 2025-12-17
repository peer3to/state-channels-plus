import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";
import { ZeroHash } from "ethers";
import { Codec, SignatureUtils, Type } from "@/utils";
import { hash } from "../factory";
import { Bytes, ForkId } from "@/types/types";

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

        it("should dispute forged inbound message blocks", async function () {
            await harness!.setup(3);
            const forkId = await harness!.openChannel();

            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) => contract.add(2));

            harness!.assertAllPeersInSync();
            harness!.resetEventSpies();

            const maliciousPeer = await harness!.getNextPeerToWrite();
            await harness!.submitForgedInboundMessageBlock(
                maliciousPeer.index,
                { forkId }
            );

            const initiatingCounts = harness!.peers.map((peer) => ({
                peerId: peer.index,
                expectedCount: peer.index === maliciousPeer.index ? 0 : 1
            }));

            const forgedDetected = await harness!.waitForEventCounts(
                "onInitiatingDispute",
                initiatingCounts,
                5000
            );
            expect(forgedDetected).to.be.true;

            const disputeCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                harness!.peers.map((peer) => ({
                    peerId: peer.index,
                    expectedCount: 2
                })),
                5000,
                { mode: "atLeast" }
            );
            expect(disputeCommitted).to.be.true;
        });
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
        let originalForkId: ForkId;

        beforeEach(async function () {
            await harness!.setup(3);
            originalForkId = await harness!.openChannel();

            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) => contract.add(2));
            harness!.assertAllPeersInSync();
            harness!.resetEventSpies();
        });

        // Arrange: peer submits dispute with tampered auditing data commitment
        // Act: tampered dispute is posted on-chain
        // Assert: validation rejects it, dispute is killed, fork stays unchanged
        it("should reject dispute with incorrect auditing data commitment", async function () {
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
            const notNextPeer = harness!.peers[1];

            const { dispute: timeoutDispute } =
                await harness!.postTamperedDispute(
                    0,
                    (dispute) => {
                        // Tamper: set timeout participant to someone who is NOT next to write
                        dispute.input.timeout.participant = notNextPeer.address;
                        dispute.input.timeout.blockHeight = 2;
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
        // Act: post tampered dispute on-chain -> validators can't reconstruct full data and state proof is invalid
        // Assert: validation rejects it, dispute is killed, fraud proof stored, fork stays unchanged
        it("should reject dispute when auditing data is partial and state proof invalid", async function () {
            // Peer 1 crafts and posts a tampered dispute
            // Tamper the first milestone's first signed block to reference an unknown snapshot
            // This makes auditing data reconstruction partial (missing snapshot) and state proof invalid
            const { dispute } = await harness!.postTamperedDispute(
                1,
                (dispute) => {
                    const tamperedStateProof = dispute.input.stateProof;
                    if (
                        tamperedStateProof.milestones.length === 0 ||
                        tamperedStateProof.milestones[0].blockConfirmations
                            .length === 0
                    ) {
                        throw new Error("No milestones to tamper");
                    }
                    const firstBc =
                        tamperedStateProof.milestones[0].blockConfirmations[0];
                    const block = Codec.decode(
                        firstBc.signedBlock.encodedBlock,
                        Type.Block
                    );
                    block.stateSnapshotHash = hash(); // not stored - makes auditing data partial
                    firstBc.signedBlock.encodedBlock = Codec.encode(
                        block,
                        Type.Block
                    );
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

        // Arrange: tamper both auditing data commitment and stateProof with full auditing data
        // Act: post tampered dispute on-chain -> validators reconstruct full data but reject due to both bad commitment and bad stateProof
        // Assert: validation rejects it, dispute is killed, fraud proof stored, fork stays unchanged
        it("should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid", async function () {
            // Peer 1 crafts and posts a tampered dispute
            // Tamper both the auditing data commitment and a critical part of the state proof
            //  checkDisputeAuditingDataCommitment returns false
            // verifyStateProof also returns false
            const { dispute } = await harness!.postTamperedDispute(
                1,
                (dispute) => {
                    // Tamper the auditing data hash so commitment check fails
                    dispute.input.disputeAuditingDataHash = hash();
                    // Also tamper the latestStateSnapshotHash so verifyStateProof fails
                    dispute.input.latestStateSnapshotHash = hash();
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

        it("should reject dispute when auditing data commitment is valid but state proof is invalid (createDisputeInvalidStateProofWithAuditingDataIntegrityVerified)", async function () {
            const { dispute } = await harness!.postTamperedDispute(
                1,
                (dispute) => {
                    // Only tamper the latestStateSnapshotHash so verifyStateProof fails
                    dispute.input.latestStateSnapshotHash = hash();
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
    });

    it("should redispute a tampered state proof that corrupts the first signed block height", async function () {
        // Flow:
        // 1. Peer 0 authors block 0 - all sync (finalized)
        // 2. Stub peer 1 to not broadcast block 1
        // 3. Peer 1 authors block 1 (no other peers will receive it)
        // 4. Peer 0 submits invalid state transition
        // 5. Peers 1 and 2 observe the invalid state transition and initiate disputes (peer 1 should have signedblocks in its state proof)
        // 6. Peer 1 dispute gets corrupted.
        // 7. Peer 2 should observe the corrupted dispute and re-dispute against peer 0

        await harness!.setup(3);
        const forkId = await harness!.openChannel();

        const peer0 = harness!.peers[0];
        const peer1 = harness!.peers[1];
        const peer2 = harness!.peers[2];

        // Step 1: First transaction - peer 0 authors, all sync (finalized)
        await harness!.submitNextTransaction((contract) => contract.add(1));
        harness!.assertAllPeersInSync();
        harness!.resetEventSpies();

        // Get peer 1's broadcast function reference
        const peer1RemoteRpc = peer1.stateManager.p2pManager.remoteRpc;

        const originalOnBlockConfirmation =
            peer1RemoteRpc.stateTransitionService.onBlockConfirmation;

        // Stub peer 1's broadcast to be a no-op - peer 1 will author but not broadcast
        peer1RemoteRpc.stateTransitionService.onBlockConfirmation = (
            _blockConfirmation
        ) => {
            // Return a dummy handler that does nothing
            return {
                broadcast: () => {
                    peer1.logger.info("Suppressed broadcast from peer 1");
                },
                sendOne: () => {},
                sendMultiple: () => {}
            } as unknown as ReturnType<typeof originalOnBlockConfirmation>;
        };

        // Step 3: Peer 1 authors block 1
        await harness!.submitNextTransaction((contract) => contract.add(100), {
            waitForPeers: [1, 2],
            waitForSync: false
        });

        harness!.resetEventSpies();

        // Verify peer 1 is ahead of peer 0 and peer 2
        const peersAhead = await harness!.waitForCondition(() => {
            const p0Height =
                peer0.stateManager.storage.blocks.getNextBlockHeight(forkId);
            const p1Height =
                peer1.stateManager.storage.blocks.getNextBlockHeight(forkId);
            const p2Height =
                peer2.stateManager.storage.blocks.getNextBlockHeight(forkId);
            peer1.logger.info(
                `Block heights - peer0: ${p0Height}, peer1: ${p1Height}, peer2: ${p2Height}`
            );
            return p1Height > p0Height && p1Height > p2Height;
        }, 5000);
        expect(peersAhead).to.be.true;

        // restore peer 1's broadcast
        peer1RemoteRpc.stateTransitionService.onBlockConfirmation =
            originalOnBlockConfirmation;

        // Step 6: Tamper peer 1's constructDispute to corrupt the first signed block height
        const peer1DisputeManager = peer1.stateManager.disputeManager;
        const originalConstructDispute =
            peer1DisputeManager.constructDispute.bind(peer1DisputeManager);

        let tamperedDispute: any;
        peer1DisputeManager.constructDispute = async (targetForkId) => {
            const res = await originalConstructDispute(targetForkId);
            const stateProof = res.dispute.input.stateProof;

            peer1.logger.info(
                `Peer 1 constructDispute: signedBlocks.length = ${stateProof.signedBlocks.length}`
            );

            if (stateProof.signedBlocks.length === 0) {
                throw new Error("Expected signedBlocks in state proof");
            }

            const firstSignedBlock = stateProof.signedBlocks[0];
            const firstBlock = Codec.decode(
                firstSignedBlock.encodedBlock,
                Type.Block
            );

            // Corrupt the height (transactionCnt) of the first signed block
            peer1.logger.info(
                `Tampering block height from ${firstBlock.transaction.header.transactionCnt} to ${BigInt(firstBlock.transaction.header.transactionCnt) + 5n}`
            );
            firstBlock.transaction.header.transactionCnt =
                BigInt(firstBlock.transaction.header.transactionCnt) + 5n;
            stateProof.signedBlocks[0].encodedBlock = Codec.encode(
                firstBlock,
                Type.Block
            );

            // Re-sign the tampered dispute
            const tamperedSig = await SignatureUtils.signDispute(
                res.dispute,
                peer1.signer
            );
            res.disputeConfirmation.signedDispute = {
                encodedDispute: tamperedSig.encoded,
                signature: tamperedSig.signature as Bytes
            };

            tamperedDispute = res.dispute;
            return res;
        };

        // Step 5: Peer 0 submits an invalid state transition block
        // This triggers disputes from peer 1 (tampered) and peer 2 (honest)
        await harness!.submitInvalidStateTransitionBlock(0, { forkId });

        // Wait for peer 1 to initiate its (tampered) dispute
        const peer1Initiated = await harness!.waitForCondition(
            () => harness!.getEventCallCount(1, "onInitiatingDispute") > 0,
            10000
        );
        expect(peer1Initiated).to.be.true;

        // Wait for peer 2 to detect peer 0's invalid dispute and redispute against it
        // Peer 2 validates all disputes and should detect the tampered signed block height
        const peer2Redisputed = await harness!.waitForCondition(() => {
            // Peer 2 should have multiple disputes:
            // 1. Against peer 0 (invalid state transition)
            // 2. Against peer 1 (tampered dispute)
            return harness!.getEventCallCount(2, "onInitiatingDispute") >= 2;
        }, 15000);

        expect(peer2Redisputed).to.be.true;

        // Verify the tampered dispute exists
        expect(tamperedDispute).to.exist;

        // Restore constructDispute
        peer1DisputeManager.constructDispute = originalConstructDispute;
    });

    describe("DisputeValidationService - validStateProofButNotSynced", function () {
        let forkId: ForkId;

        beforeEach(async function () {
            await harness!.setup(3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2
                }
            });
            forkId = await harness!.openChannel();
        });

        it("should handle valid dispute when validating peer is missing snapshot data ", async function () {
            // Stub peer 2's calldata handler to prevent syncing from on-chain calldata
            // Save original handler so peer 2 can't sync via calldata
            const peer2EventHandler =
                harness!.peers[2].stateManager.eventHandler;
            const originalCalldataHandler =
                peer2EventHandler.onBlockCalldataPosted.bind(peer2EventHandler);
            peer2EventHandler.onBlockCalldataPosted = async () => {
                // No-op: peer 2 won't process calldata, simulating being out of sync
            };

            // Track peer 2's snapshots
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const snapshotStorage = harness!.peers[2].stateManager.storage
                .stateSnapshots as any;
            const snapshotCountBefore = Array.from(
                snapshotStorage.snapshotsByHash.keys()
            ).length;

            // Disconnect peer 2 from P2P network
            // Peer 2 won't receive new blocks via P2P and won't sign them
            await harness!.simulatePeerTimeout(2);

            // Submit a transaction - peer 2 is disconnected so:
            // 1. Peer 2 won't receive the block via P2P (disconnected)
            // 2. Peer 2 won't sign the block
            // 3. Block stays UNFINALIZED (in signedBlocks, not milestones)
            // 4. Peer 2 won't sync from calldata (handler stubbed)
            await harness!.submitNextTransaction(
                (contract) => contract.add(100),
                { waitForPeers: [0, 1], waitForSync: true }
            );

            // Wait for timeout dispute to be posted by peer 0 or 1
            // Peer 2 will validate this dispute with isPartial = true (missing snapshot)
            // and valid state proof (signedBlocks are valid)
            // This triggers validStateProofButNotSynced path
            const disputePosted = await harness!.waitForCondition(
                () =>
                    harness!.getEventCallCount(0, "onInitiatingDispute") > 0 ||
                    harness!.getEventCallCount(1, "onInitiatingDispute") > 0,
                10000
            );
            expect(disputePosted).to.be.true;

            // Wait for peer 2 to re-sync via validStateProofButNotSynced
            // When peer 2 validates the dispute with isPartial = true and valid state proof,
            // it should sync by applying the signed blocks from the state proof
            const resynced = await harness!.waitForCondition(() => {
                const snapshotCountAfter = Array.from(
                    snapshotStorage.snapshotsByHash.keys()
                ).length;
                return snapshotCountAfter > snapshotCountBefore;
            }, 5000);
            expect(resynced).to.be.true;

            // Restore original handler
            peer2EventHandler.onBlockCalldataPosted = originalCalldataHandler;
        });

        it("should sync missing state via validStateProofButNotSynced when peer receives dispute with blocks it doesn't have", async function () {
            // Submit initial transaction and wait for sync
            await harness!.submitNextTransaction((contract) => contract.add(1));
            harness!.assertAllPeersInSync();
            harness!.resetEventSpies();

            // Get peer 1's broadcast function reference
            const peer1 = harness!.peers[1];
            const peer1RemoteRpc = peer1.stateManager.p2pManager.remoteRpc;
            const originalStateTransitionService =
                peer1RemoteRpc.stateTransitionService;

            // Stub peer 1's broadcast to be a no-op - peer 1 will author but not broadcast
            peer1RemoteRpc.stateTransitionService.onBlockConfirmation = (
                _blockConfirmation
            ) => {
                // Return a dummy handler that does nothing
                return {
                    broadcast: () => {
                        peer1.logger.info("Suppressed broadcast from peer 1");
                    },
                    sendOne: () => {},
                    sendMultiple: () => {}
                } as unknown as ReturnType<
                    typeof originalStateTransitionService.onBlockConfirmation
                >;
            };

            // Peer 1 authors a block but doesn't broadcast it
            // This creates a state where peer 1 is 1 block ahead of peers 0 and 2
            await harness!.waitForTurn(peer1);
            await harness!.submitNextTransaction(
                (contract) => contract.add(10),
                { waitForSync: false }
            );

            // Verify peer 1 has more blocks than peer 2

            await harness!.waitForCondition(
                () =>
                    peer1.stateManager.storage.blocks.getNextBlockHeight(
                        forkId
                    ) >
                    harness!.peers[2].stateManager.storage.blocks.getNextBlockHeight(
                        forkId
                    ),
                5000
            );

            // Now peer 0 submits an invalid state transition block
            // This will trigger disputes from both peer 1 and peer 2
            await harness!.submitInvalidStateTransitionBlock(0, { forkId });

            // Wait for disputes to be committed on-chain
            const disputesCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                [
                    { peerId: 1, expectedCount: 2 },
                    { peerId: 2, expectedCount: 2 }
                ],
                8000,
                { mode: "atLeast" }
            );
            expect(disputesCommitted).to.be.true;

            // Peer 2 should sync the missing block via validStateProofButNotSynced
            // when validating peer 1's dispute which contains blocks peer 2 doesn't have
            const peer2Synced = await harness!.waitForCondition(() => {
                const peer2BlockCount =
                    harness!.peers[2].stateManager.storage.blocks.getNextBlockHeight(
                        forkId
                    );
                const peer1BlockCount =
                    peer1.stateManager.storage.blocks.getNextBlockHeight(
                        forkId
                    );

                const peer2LatestBlockHash =
                    harness!.peers[2].stateManager.storage.blocks.getLatestBlock(
                        forkId
                    )?.hash;
                const peer1LatestBlockHash =
                    peer1.stateManager.storage.blocks.getLatestBlock(
                        forkId
                    )?.hash;
                // Peer 2 should have gained the block that peer 1 had
                return (
                    peer2LatestBlockHash === peer1LatestBlockHash &&
                    peer2BlockCount === 2 &&
                    peer1BlockCount === 2
                );
            }, 5000);
            expect(peer2Synced).to.be.true;
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
