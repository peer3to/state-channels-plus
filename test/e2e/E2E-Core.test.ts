import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";

describe("E2E: Core Functionality", function () {
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

    describe("Multi-Block Scenarios", function () {
        // Arrange: Setup 2 participants with initial balances, open channel
        // Act: Execute 10 consecutive blocks with transactions
        // Assert: All blocks are signed by both participants, state consistency maintained
        it("should handle 10 consecutive blocks between 2 participants", async function () {
            // Arrange
            await harness!.setup(2);
            const forkId = await harness!.openChannel();

            // Act
            for (let i = 0; i < 10; i++) {
                await harness!.submitNextTransaction((contract) =>
                    contract.add(1)
                );
            }

            // Assert
            const stateManager1 = harness!.peers[0].stateManager;
            const stateManager2 = harness!.peers[1].stateManager;

            const latestBlock1 =
                stateManager1.storage.blocks.getLatestBlock(forkId);
            const latestBlock2 =
                stateManager2.storage.blocks.getLatestBlock(forkId);

            expect(latestBlock1).to.not.equal(
                undefined,
                "Peer 1 should have a latest block"
            );
            expect(latestBlock2).to.not.equal(
                undefined,
                "Peer 2 should have a latest block"
            );
            expect(latestBlock1?.hash).to.equal(
                latestBlock2?.hash,
                "Peers should have same block hash"
            );

            expect(latestBlock1?.height).to.equal(
                latestBlock2?.height,
                "Peers should have same block height"
            );
            // Verify we have 10 blocks
            expect(latestBlock1?.height).to.equal(
                9,
                "Should have 10 blocks after genesis"
            );
            expect(latestBlock2?.height).to.equal(
                9,
                "Should have 10 blocks after genesis"
            );

            const stateSnapshot1 = stateManager1.storage.getStateSnapshot({
                forkId,
                height: 9
            });
            const stateSnapshot2 = stateManager2.storage.getStateSnapshot({
                forkId,
                height: 9
            });
            expect(stateSnapshot1).to.deep.equal(
                stateSnapshot2,
                "Peers should have same state snapshot"
            );

            // Verify state consistency - both peers should have the same final state
            harness!.assertAllPeersInSync();
        });

        // Arrange: Setup 3 participants with initial balances, open channel
        // Act: Execute 10 consecutive blocks with round-robin transactions
        // Assert: All blocks are signed by all 3 participants, state consistency maintained
        it("should handle 10 consecutive blocks between 3 participants", async function () {
            // Arrange
            await harness!.setup(3);
            const forkId = await harness!.openChannel();

            // Act
            for (let i = 0; i < 10; i++) {
                await harness!.submitNextTransaction((contract) =>
                    contract.add(1)
                );
            }

            // Assert
            const stateManagers = harness!.peers.map(
                (peer) => peer.stateManager
            );
            const latestBlocks = stateManagers.map((stateManager) =>
                stateManager.storage.blocks.getLatestBlock(forkId)
            );

            // Verify all peers have latest blocks
            latestBlocks.forEach((block, index) => {
                expect(block).to.not.equal(
                    undefined,
                    `Peer ${index + 1} should have a latest block`
                );
            });

            // Verify all peers have the same block hash
            for (let i = 1; i < latestBlocks.length; i++) {
                expect(latestBlocks[0]?.hash).to.equal(
                    latestBlocks[i]?.hash,
                    `Peers should have same block hash (comparing peer 1 with peer ${
                        i + 1
                    })`
                );
            }

            // Verify all peers have the same block height
            for (let i = 1; i < latestBlocks.length; i++) {
                expect(latestBlocks[0]?.height).to.equal(
                    latestBlocks[i]?.height,
                    `Peers should have same block height (comparing peer 1 with peer ${
                        i + 1
                    })`
                );
            }

            // Verify all peers have the same state snapshot
            const stateSnapshots = stateManagers.map((stateManager) =>
                stateManager.storage.getStateSnapshot({ forkId, height: 9 })
            );
            for (let i = 1; i < stateSnapshots.length; i++) {
                expect(stateSnapshots[0]).to.deep.equal(
                    stateSnapshots[i],
                    `Peers should have same state snapshot (comparing peer 1 with peer ${
                        i + 1
                    })`
                );
            }

            harness!.assertAllPeersInSync();
        });
    });

    describe("Timeout Scenarios", function () {
        // Scenario 1: Non-author peer disconnects
        // Arrange: Setup 3 participants with initial balances, open channel, configure short timeout
        // Act: Have one participant stop responding during block production
        // Assert: calldata is posted by the author peer
        it("should handle timeout when non-author peer disconnects", async function () {
            // Arrange - Setup with 3 participants and short timeout for fast testing
            await harness!.setup(3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2
                    // Total timeout: 4 seconds
                }
            });
            await harness!.openChannel();

            // Make 3 transactions to establish normal operation
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 0
            await harness!.submitNextTransaction((contract) => contract.add(2)); // peer 1
            await harness!.submitNextTransaction((contract) => contract.add(3)); // peer 2

            // Reset spies after setup
            harness!.resetEventSpies();

            // Act

            // Now it should be peer 0's turn again
            const nextPeer = await harness!.getNextPeerToWrite();
            expect(nextPeer.index).to.equal(0, "Should be peer 0's turn");

            // Disconnect peer 2 (non-author)
            await harness!.simulatePeerTimeout(2);

            // Peer 0 authors a transaction
            await harness!.submitTransaction(
                nextPeer,
                (contract) => contract.add(100),
                { waitForPeers: [0, 1] } // wait for peers 0 and 1 to sync
            );

            // Wait for calldata posting (since peer 2 can't sign)
            const calldataPosted = await harness!.waitForCondition(
                () =>
                    harness!.getEventCallCount(
                        nextPeer.index,
                        "onPostingCalldata"
                    ) > 0,
                3000
            );

            // Assert - Peer 0 posts calldata when peer 2 can't sign
            expect(calldataPosted).to.be.true;
            expect(
                harness!.getEventCallCount(nextPeer.index, "onPostingCalldata")
            ).to.be.at.least(1);

            // Now it should be peer 1's turn
            const nextPeerAfter = await harness!.getNextPeerToWrite();
            expect(nextPeerAfter.index).to.equal(1, "Should be peer 1's turn");

            // Test liveness: Peer 1 should be able to write despite peer 2 being disconnected
            await harness!.submitTransaction(
                nextPeerAfter,
                (contract) => contract.add(200),
                { waitForPeers: [0, 1] } // Don't wait for sync since peer 2 is disconnected
            );
        });

        // Scenario 2: Author peer disconnects
        // Arrange: Setup 3 participants with initial balances, open channel, configure short timeout
        // Act: disconnect author peer, just when it is their turn to write
        // Assert: timeout dispute is created and submitted on-chain
        it("should handle timeout when author peer disconnects", async function () {
            // Arrange - Setup with 3 participants and short timeout for fast testing
            await harness!.setup(3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 3
                }
            });
            await harness!.openChannel();

            // Make 3 transactions to establish normal operation
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 0
            await harness!.submitNextTransaction((contract) => contract.add(2)); // peer 1
            await harness!.submitNextTransaction((contract) => contract.add(3)); // peer 2

            // Reset spies after setup
            harness!.resetEventSpies();

            // Act
            // Now it should be peer 0's turn again - let them create a block first
            const nextPeer = await harness!.getNextPeerToWrite();

            // Disconnect peer 1 (the author peer who should write next) so they can't create a block
            await harness!.simulatePeerTimeout(1);

            // Let peer 0 create a block (this will schedule timeout for the next participant)
            await harness!.submitTransaction(
                nextPeer,
                (contract) => contract.add(100),
                { waitForPeers: [0, 2] }
            );

            // Wait for timeout dispute to be created and submitted on-chain
            // The remaining peers (0 and 2) should detect the timeout and create a dispute
            const disputeCreated = await harness!.waitForCondition(
                () => {
                    // Check if any of the remaining peers initiated a dispute
                    const peer0DisputeCount = harness!.getEventCallCount(
                        0,
                        "onInitiatingDispute"
                    );
                    const peer2DisputeCount = harness!.getEventCallCount(
                        2,
                        "onInitiatingDispute"
                    );

                    return peer0DisputeCount > 0 || peer2DisputeCount > 0;
                },
                10000 // Wait up to 10 seconds for dispute creation
            );

            // Assert - A timeout dispute should be created by one of the remaining peers
            expect(disputeCreated).to.be.true;

            // Verify that at least one peer initiated a dispute
            const totalDisputeCount =
                harness!.getEventCallCount(0, "onInitiatingDispute") +
                harness!.getEventCallCount(2, "onInitiatingDispute");
            expect(totalDisputeCount).to.be.at.least(1);

            // Verify that the disconnected peer (peer 1) did not initiate any disputes
            expect(
                harness!.getEventCallCount(1, "onInitiatingDispute")
            ).to.equal(0);
        });

        // Future test for dispute resolution
        it("should create timeout dispute for non-responsive participant");
    });

    describe("Channel Lifecycle", function () {
        // Arrange: Setup 2+ participants with initial balances and deadline
        // Act: All participants sign OpenChannelConfirmation, submit on-chain
        // Assert: Channel opens successfully, participants list updated, balances set
        it("should open channel with all participants signing");

        // Arrange: Setup 3 participants, remove one signature from OpenChannelConfirmation
        // Act: Attempt to submit incomplete OpenChannelConfirmation on-chain
        // Assert: Transaction reverts with signature validation error
        it("should reject channel opening with missing signature");

        // Arrange: Setup participants with specific non-zero initial balances
        // Act: Submit OpenChannel with custom balance array
        // Assert: Channel opens with correct initial balances for each participant
        it("should open channel with initial balances");

        // Arrange: Setup OpenChannel with custom deadline timestamp (future time)
        // Act: Submit channel opening before deadline
        // Assert: Channel opens successfully and respects the custom deadline
        it("should open channel with custom deadline timestamp");
    });

    describe("Economic Scenarios", function () {
        // Arrange: Setup channel, execute transactions that should maintain total balance
        // Act: Execute blocks with transfers between participants
        // Assert: Total balance in system remains constant (no money creation/destruction)
        it("should preserve balance invariants across blocks");

        // Arrange: Setup channel, prepare deposit transaction
        // Act: Execute deposit through depositAssetsComposable framework
        // Assert: Deposit is processed correctly, balances updated
        it("should handle deposit framework correctly");

        // Arrange: Setup channel with balances, prepare withdrawal transaction
        // Act: Execute withdrawal through withdrawAssetsComposable framework
        // Assert: Withdrawal is processed correctly, balances updated, invariants preserved
        it("should handle withdrawal framework correctly");
    });

    describe("Timing and Synchronization", function () {
        // Arrange: Setup participants with clocks offset by small amounts (1-2 seconds)
        // Act: Execute block production with timestamp validation
        // Assert: System handles small clock differences gracefully
        it("should handle participants with slightly different clocks");

        // Arrange: Setup channel, create block with timestamp > current time + tolerance
        // Act: Submit block with invalid timestamp
        // Assert: Block is rejected due to timestamp violation
        // NOTE: This covers future timestamps and other timestamp violations
        it("should detect timestamp violations");
    });

    describe("State Machine Execution", function () {
        // Arrange: Setup channel with state machine, prepare valid transaction
        // Act: Execute transaction that calls state machine methods
        // Assert: Transaction executes successfully, state is updated correctly
        it("should execute smart contract calls");

        // Arrange: Setup channel, prepare transaction that should revert
        // Act: Execute transaction that triggers state machine revert
        // Assert: Transaction fails gracefully, state remains unchanged, error is handled
        it("should handle state machine reverts correctly");
    });

    describe("Synchronization and Recovery", function () {
        // Arrange: Setup channel with on-chain state snapshots available
        // Act: Participant rebuilds entire state from on-chain data (no P2P sync)
        // Assert: State is completely rebuilt and matches other participants
        // NOTE: This is the most comprehensive sync test - covers all sync scenarios
        it("should handle complete state rebuild from on-chain data");
    });
});
