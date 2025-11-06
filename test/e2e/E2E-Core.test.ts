import { expect } from "chai";
import { PeerTestHarness, sleep } from "@test/fixtures/PeerTestHarness";
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

        // Arrange: Setup 3 participants with initial balances, open channel, configure short timeout
        // Act: next peer to write, does not author a block
        // Assert: timeout dispute is created and submitted on-chain, no calldata was posted to the blockchain during the timeout scenario
        it("should handle timeout when next peer to write, does not author a block", async function () {
            // Arrange - Setup with 3 participants and short timeout for fast testing
            await harness!.setup(3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 3
                }
            });
            await harness!.openChannel();

            // Make 2 transactions to establish normal operation
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 0
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 1

            // Reset spies after setup
            harness!.resetEventSpies();

            // Act (peer 2 does not author a block)
            // Assert: A timeout dispute is created and submitted on-chain
            const disputeCreated = await harness!.waitForCondition(
                () => {
                    // Check if any of the remaining peers initiated a dispute
                    const peer0DisputeCount = harness!.getEventCallCount(
                        0,
                        "onInitiatingDispute"
                    );
                    const peer1DisputeCount = harness!.getEventCallCount(
                        1,
                        "onInitiatingDispute"
                    );

                    return peer0DisputeCount === 1 && peer1DisputeCount === 1;
                },
                10000 // Wait up to 10 seconds for dispute creation
            );
            expect(disputeCreated).to.be.true;

            expect(
                harness!.getEventCallCount(0, "onInitiatingDispute"),
                "Peer 0 should have initiated 1 dispute"
            ).to.be.equal(1);
            expect(
                harness!.getEventCallCount(1, "onInitiatingDispute"),
                "Peer 1 should have initiated 1 dispute"
            ).to.be.equal(1);
            expect(
                harness!.getEventCallCount(2, "onInitiatingDispute"),
                "Peer 2 should have not initiated any disputes"
            ).to.be.equal(0);

            // Assert that the disputes events was recieved (2 peers initiated a dispute X 3 participants = 6 events)
            const disputesCommitted = await harness!.waitForCondition(
                () =>
                    harness!.getEventCallCount(0, "onDisputeCommitted") +
                        harness!.getEventCallCount(1, "onDisputeCommitted") +
                        harness!.getEventCallCount(2, "onDisputeCommitted") ==
                    6,

                1000
            );
            expect(disputesCommitted).to.be.true;

            // Assert that no calldata was posted
            harness!.assertEventHandlerCalledTotalTimes("onPostedCalldata", 0);
            harness!.assertEventHandlerCalledTotalTimes(
                "onBlockCalldataPosted",
                0
            );
        });

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

        // Test: Forced timeout when peer posts junk calldata
        // Arrange: Setup 3 participants, configure timeout
        // Act: Next peer posts invalid/unlinked calldata on-chain that gets rejected by validation
        // Assert: System creates forced timeout dispute (isForced=true), remaining peers maintain liveness
        it("should create forced timeout when peer posts junk calldata that is rejected", async function () {
            // Arrange
            await harness!.setup(3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2
                }
            });
            await harness!.openChannel();

            // Establish initial state
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 0
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 1

            // Reset spies
            harness!.resetEventSpies();

            // Act
            const nextPeer = await harness!.getNextPeerToWrite(); // peer 2
            expect(nextPeer.index).to.equal(2, "Should be peer 2's turn");

            // Get the current state so we can create an unlinked block
            const currentBlock =
                harness!.peers[0].stateManager.storage.blocks.getLatestBlock(
                    harness!.activeForkId!
                );
            expect(currentBlock).to.not.be.undefined;

            // Simulate peer 2 posting junk calldata (unlinked block) directly on-chain
            await harness!.postJunkCalldataOnChain(2, {
                forkId: harness!.activeForkId!,
                height: currentBlock!.height + 1,
                wrongPreviousHash: true // Creates block with wrong previousBlockHash
            });

            // Wait for other peers to detect the calldata and attempt validation (which will fail)
            await harness!.waitForCondition(() => {
                // Other peers should detect the calldata via onBlockCalldataPosted event
                const peer0CalldataEvents = harness!.getEventCallCount(
                    0,
                    "onBlockCalldataPosted"
                );
                const peer1CalldataEvents = harness!.getEventCallCount(
                    1,
                    "onBlockCalldataPosted"
                );
                return peer0CalldataEvents == 1 && peer1CalldataEvents == 1;
            }, 5000);

            // Wait for timeout check cycle to detect forced timeout
            const forcedTimeoutDetected = await harness!.waitForCondition(
                () => {
                    const peer0Disputes = harness!.getEventCallCount(
                        0,
                        "onInitiatingDispute"
                    );
                    const peer1Disputes = harness!.getEventCallCount(
                        1,
                        "onInitiatingDispute"
                    );
                    return peer0Disputes == 1 && peer1Disputes == 1;
                },
                10000
            );

            // Assert - Forced timeout dispute created
            expect(forcedTimeoutDetected).to.be.true;
            const disputesCommitted = await harness!.waitForCondition(
                () =>
                    harness!.getEventCallCount(0, "onDisputeCommitted") +
                        harness!.getEventCallCount(1, "onDisputeCommitted") +
                        harness!.getEventCallCount(2, "onDisputeCommitted") ==
                    6,

                1000
            );
            expect(disputesCommitted).to.be.true;

            // Verify timeout struct has isForced = true using helper method
            const timeoutStruct = harness!.getTimeoutStruct(
                0,
                harness!.activeForkId!
            );

            expect(timeoutStruct).to.not.be.undefined;
            expect(timeoutStruct!.isForced).to.be.true;
            expect(timeoutStruct!.participant).to.equal(
                harness!.peers[2].address
            );
            expect(Number(timeoutStruct!.blockHeight)).to.equal(
                currentBlock!.height + 1
            );

            // TODO: Uncomment once dispute resolution is implemented.
            //
            // Forced timeout detection works - the dispute gets created and committed on-chain. But the
            // participant removal isn't happening yet because EventHandler.setForkIfLatestAndCurrent()
            // and the final dispute handling in onDisputeCommitted() aren't implemented. The state machine
            // participant list doesn't get updated, so getNextToWrite() still returns the timed-out peer.
            //
            // See EventHandler.ts:555-590 and EventHandler.ts:170-190 for the unimplemented parts.

            /*
            // System should continue with remaining honest peers
            const nextPeerAfter = await harness!.getNextPeerToWrite();
            expect([0, 1]).to.include(
                nextPeerAfter.index,
                "Next peer should be one of the remaining honest peers"
            );

            // Verify liveness - remaining peers can continue transacting
            await harness!.submitTransaction(
                nextPeerAfter,
                (contract) => contract.add(100),
                { waitForPeers: [0, 1] }
            );

            // Assert - Remaining peers stay in sync
            harness!.assertAllPeersInSync({ peerIndices: [0, 1] });

            // Assert - No additional calldata posting needed (all active peers are signing)
            const totalCalldataPosts =
                harness!.getEventCallCount(0, "onPostingCalldata") +
                harness!.getEventCallCount(1, "onPostingCalldata");
            // Only the initial junk calldata should have triggered posting, no new ones
            expect(totalCalldataPosts).to.equal(0, "No new calldata should be posted after forced timeout");
            */
        });

        // Arrange: Setup 3 participants, produce correct block N, post junk calldata for block N
        // Act: Next peer (for block N+1) doesn't author a block, timeout occurs
        // Assert: Timeout dispute created with previousBlockProducerPostedCalldata=true, isForced=true, previousBlock.onChainTimestamp=undefined
        it.skip("should handle timeout when previous peer posted junk calldata and next peer doesn't author block", async function () {
            // Arrange - Setup with 3 participants and short timeout for fast testing
            await harness!.setup(3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 2,
                    chainFallbackTime: 3
                }
            });
            await harness!.openChannel();

            // Establish initial state with 2 transactions
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 0
            await harness!.submitNextTransaction((contract) => contract.add(1)); // peer 1

            // Reset spies after setup
            harness!.resetEventSpies();

            // Act - Part 1: Peer 2 produces correct block N and behaves normally
            const nextPeer = await harness!.getNextPeerToWrite(); // Should be peer 2
            expect(nextPeer.index).to.equal(2, "Should be peer 2's turn");

            // Peer 2 creates block normally and all peers sync
            await harness!.submitTransaction(nextPeer, (contract) =>
                contract.add(1)
            );

            // Get the block that was just created
            const currentBlock =
                harness!.peers[2].stateManager.storage.blocks.getLatestBlock(
                    harness!.activeForkId!
                );
            expect(currentBlock).to.not.be.undefined;
            expect(currentBlock!.height).to.equal(2, "Should be at height 2");

            // Act - Part 2: Wait 2 seconds, then peer 2 posts junk calldata
            // This simulates peer 2 becoming byzantine AFTER behaving correctly
            await sleep(2000);

            await harness!.postJunkCalldataOnChain(2, {
                forkId: harness!.activeForkId!,
                height: currentBlock!.height,
                wrongPreviousHash: true
            });

            // Wait for other peers to detect the junk calldata
            await harness!.waitForCondition(() => {
                const peer0CalldataEvents = harness!.getEventCallCount(
                    0,
                    "onBlockCalldataPosted"
                );
                const peer1CalldataEvents = harness!.getEventCallCount(
                    1,
                    "onBlockCalldataPosted"
                );
                return peer0CalldataEvents == 1 && peer1CalldataEvents == 1;
            }, 5000);

            // at this point, peer 0 and peer 1  have detected the junk calldata and created a  frauf proof dispute
            //  the uploading of this dispute FAILS (a bug) and we get the following error:
            /*
            [ERROR][Peer 2][0x3C44Cd...][DisputeManager] Error uploading dispute
             {"forkId":"0x75048b474d06af1e9590638edb80af0aaf7fa453aa8a9bb9d141eeac2054fd8d","error":"Transaction reverted without a reason string"}
            */

            // get block again from  storage
            const peer1Block =
                harness!.peers[1].stateManager.storage.blocks.getLatestBlock(
                    harness!.activeForkId!
                );
            expect(peer1Block).to.not.be.undefined;
            expect(peer1Block!.height).to.equal(2, "Should be at height 2");

            // Verify the correct block still doesn't have onChainTimestamp (junk was rejected)
            expect(peer1Block!.onChainTimestamp).to.be.undefined;

            // Act - Part 3: Next peer (peer 0) doesn't author block N+1, causing timeout
            // The timeout should be initiated after p2p+agreement+chainFallbackTime
            // Since previousBlock.onChainTimestamp is undefined, relevantTimestamp = block.timestamp
            // and previousBlockProducerPostedCalldata should be true (calldata slot is occupied)

            // Wait for timeout dispute to be created (should target peer 0 for not producing block N+1)
            // const timeoutDisputeCreated = await harness!.waitForCondition(
            //     () => {
            //         const peer1DisputeCount = harness!.getEventCallCount(
            //             1,
            //             "onInitiatingDispute"
            //         );
            //         const peer2DisputeCount = harness!.getEventCallCount(
            //             2,
            //             "onInitiatingDispute"
            //         );
            //         return peer1DisputeCount == 1 && peer2DisputeCount == 1;
            //     },
            //     15000 // Wait up to 15 seconds for timeout + dispute creation
            // );

            // // Assert - Timeout dispute should be created
            // The failure of the dispute above somhow corrupts something, and the timeout dispute is not created
            // and this assertion fails
            // expect(timeoutDisputeCreated, "Timeout dispute should be created")
            //     .to.be.true;

            // TODO: Uncomment once bug is fixes and above assertion passes

            /*
                            const timeoutStruct = harness!.getTimeoutStruct(
                1,
                harness!.activeForkId!
            );
            expect(timeoutStruct).to.not.be.undefined;

            expect(timeoutStruct!.previousBlockProducerPostedCalldata).to.be.true;

            // Timeout should be forced because previous block producer posted junk calldata
            expect(timeoutStruct!.isForced).to.be.true;

            // Previous block should not have onChainTimestamp (junk was rejected)
            expect(currentBlock!.onChainTimestamp).to.be.undefined;

            // Timeout should target peer 0 (next to write after peer 2)
            expect(timeoutStruct!.participant).to.equal(
                harness!.peers[0].address
            );

            // Block height should be N+1 (the block that wasn't produced)
            expect(Number(timeoutStruct!.blockHeight)).to.equal(
                currentBlock!.height + 1
            );
                
                */
        });
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
