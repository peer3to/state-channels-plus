import { expect } from "chai";
import { PeerTestHarness, sleep } from "@test/fixtures/PeerTestHarness";
import { StateSnapshot } from "@/models";
import {
    MathStateMachine,
    MathConsumerFacet__factory
} from "@typechain-types/index";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

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

        // Arrange: Setup 3 participants, open channel, execute 3 state transitions
        // Act: Post the latest state snapshot on-chain
        // Assert: All peers observe StateSnapshotUpdated and on-chain snapshot matches latest local snapshot
        it.only("should post updated state snapshot on-chain after 3 transitions", async function () {
            await harness!.setup(3);
            const forkId = await harness!.openChannel();

            await harness!.submitNextTransaction((contract) => contract.add(1));
            await harness!.submitNextTransaction((contract) =>
                contract.leaveChannel()
            );
            await harness!.submitNextTransaction((contract) => contract.add(3));

            const latestBlockHeight =
                harness!.peers[0].stateManager.storage.blocks.getNextBlockHeight(
                    forkId
                ) - 1;

            harness!.assertAllPeersInSync();
            harness!.resetEventSpies();

            const preparedSameForkData =
                await harness!.peers[0].stateManager.prepareUpdateSnapshotSameFork(
                    forkId
                );
            expect(
                preparedSameForkData,
                "Expected snapshot data to post"
            ).to.not.equal(undefined);

            const stateMachine =
                harness!.peers[0].stateManager.diamondStateMachine;
            const zeroBalance = await stateMachine.getZeroBalance();
            let expectedWithdrawalsDeltaBalance = zeroBalance;
            for (const outboundBlock of preparedSameForkData!
                .outboundMessageBlocks) {
                for (const message of outboundBlock.messages) {
                    expectedWithdrawalsDeltaBalance =
                        await stateMachine.addBalance(
                            expectedWithdrawalsDeltaBalance,
                            message.balance
                        );
                }
            }

            const onChainSnapshotBefore = StateSnapshot.from(
                await harness!.channelManager.getStateSnapshot(
                    harness!.channelId
                )
            );

            const channelBalanceBefore =
                await harness!.channelManager.getChannelBalance(
                    harness!.channelId
                );
            expect(
                await stateMachine.areBalancesEqual(
                    channelBalanceBefore.totalWithdrawals,
                    onChainSnapshotBefore.snapshotData.totalWithdrawals
                ),
                "channelBalances.totalWithdrawals should match snapshot.totalWithdrawals (before)"
            ).to.equal(true);

            await harness!.peers[0].stateManager.postStateSnapshot(forkId);

            const onChainSnapshotAfterPost = StateSnapshot.from(
                await harness!.channelManager.getStateSnapshot(
                    harness!.channelId
                )
            );

            const channelBalanceAfter = await (
                harness!.channelManager as any
            ).getChannelBalance(harness!.channelId);
            expect(
                await stateMachine.areBalancesEqual(
                    channelBalanceAfter.totalWithdrawals,
                    onChainSnapshotAfterPost.snapshotData.totalWithdrawals
                ),
                "channelBalances.totalWithdrawals should match snapshot.totalWithdrawals (after)"
            ).to.equal(true);

            const withdrawalsDeltaActual = await stateMachine.subtractBalance(
                channelBalanceAfter.totalWithdrawals,
                channelBalanceBefore.totalWithdrawals
            );
            expect(
                await stateMachine.areBalancesEqual(
                    withdrawalsDeltaActual,
                    expectedWithdrawalsDeltaBalance
                )
            ).to.equal(
                true,
                "On-chain totalWithdrawals should increase by outbound message balances"
            );

            const sawSnapshotUpdate = await harness!.waitForEventCounts(
                "onStateSnapshotUpdated",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 1, expectedCount: 1 },
                    { peerId: 2, expectedCount: 1 }
                ],
                15000,
                { mode: "atLeast" }
            );
            expect(sawSnapshotUpdate).to.be.true;

            const localLatestSnapshot =
                harness!.peers[0].stateManager.storage.getStateSnapshot({
                    forkId,
                    height: latestBlockHeight
                });
            expect(localLatestSnapshot).to.not.equal(undefined);

            const onChainSnapshot = StateSnapshot.from(
                await harness!.channelManager.getStateSnapshot(
                    harness!.channelId
                )
            );

            expect(onChainSnapshot.blockHeight).to.equal(
                latestBlockHeight,
                "On-chain snapshot should be updated to latest block height"
            );
            expect(onChainSnapshot.hash).to.equal(
                localLatestSnapshot!.hash,
                "On-chain snapshot hash should match latest local snapshot"
            );

            expect(
                await stateMachine.areBalancesEqual(
                    onChainSnapshot.snapshotData.totalDeposits,
                    localLatestSnapshot!.snapshotData.totalDeposits
                )
            ).to.equal(
                true,
                "On-chain totalDeposits should match latest local snapshot"
            );
            expect(
                await stateMachine.areBalancesEqual(
                    onChainSnapshot.snapshotData.totalWithdrawals,
                    localLatestSnapshot!.snapshotData.totalWithdrawals
                )
            ).to.equal(
                true,
                "On-chain totalWithdrawals should match latest local snapshot"
            );
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
                    p2pTime: 2,
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
            const disputeCreated = await harness!.waitForEventCounts(
                "onInitiatingDispute",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 1, expectedCount: 1 }
                ],
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
            const disputesCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                [
                    { peerId: 0, expectedCount: 2 },
                    { peerId: 1, expectedCount: 2 },
                    { peerId: 2, expectedCount: 2 }
                ],
                10000
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
            const disputeCreated = await harness!.waitForEventCounts(
                "onInitiatingDispute",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 2, expectedCount: 1 }
                ],
                10000
            );

            // Assert - A timeout dispute should be created by one of the remaining peers
            expect(disputeCreated).to.be.true;

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
                    p2pTime: 2,
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

            // Simulate peer 2 posting junk calldata (invalid signature) directly on-chain
            await harness!.postJunkCalldataOnChain(2, {
                height: currentBlock!.height + 1
            });

            // Wait for other peers to detect the calldata and attempt validation (which will fail)
            await harness!.waitForEventCounts(
                "onBlockCalldataPosted",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 1, expectedCount: 1 }
                ],
                5000
            );

            // Wait for timeout check cycle to detect forced timeout
            const forcedTimeoutDetected = await harness!.waitForEventCounts(
                "onInitiatingDispute",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 1, expectedCount: 1 }
                ],
                10000
            );

            // Assert - Forced timeout dispute created
            expect(forcedTimeoutDetected).to.be.true;
            const disputesCommitted = await harness!.waitForEventCounts(
                "onDisputeCommitted",
                [
                    { peerId: 0, expectedCount: 2 },
                    { peerId: 1, expectedCount: 2 },
                    { peerId: 2, expectedCount: 2 }
                ],
                10000
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
        });

        // Arrange: Setup 3 participants, produce correct block N, post junk calldata for block N
        // Act: Next peer (for block N+1) doesn't author a block, timeout occurs
        // Assert: Timeout dispute created with previousBlockProducerPostedCalldata=true, isForced=true, previousBlock.onChainTimestamp=undefined
        it("should handle timeout when previous peer posted junk calldata and next peer doesn't author block", async function () {
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
                height: currentBlock!.height
            });

            // Wait for other peers to detect the junk calldata
            await harness!.waitForEventCounts(
                "onBlockCalldataPosted",
                [
                    { peerId: 0, expectedCount: 1 },
                    { peerId: 1, expectedCount: 1 }
                ],
                5000
            );

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
            const timeoutDisputeCreated = await harness!.waitForEventCounts(
                "onInitiatingDispute",
                [
                    { peerId: 1, expectedCount: 1 },
                    { peerId: 2, expectedCount: 1 }
                ],
                10000
            );

            // // Assert - Timeout dispute should be created

            expect(timeoutDisputeCreated, "Timeout dispute should be created")
                .to.be.true;

            const timeoutStruct = harness!.getTimeoutStruct(
                1,
                harness!.activeForkId!
            );
            expect(timeoutStruct).to.not.be.undefined;
            // Timeout should target peer 0 (next to write after peer 2)
            expect(timeoutStruct!.participant).to.equal(
                harness!.peers[0].address
            );

            // Block height should be N+1 (the block that wasn't produced)
            expect(Number(timeoutStruct!.blockHeight)).to.equal(
                currentBlock!.height + 1
            );

            // Previous block producer posted calldata (junk calldata was posted by the previous peer)
            expect(timeoutStruct!.previousBlockProducerPostedCalldata).to.be
                .true;
            // Previous block should not have onChainTimestamp (junk was rejected)
            expect(currentBlock!.onChainTimestamp).to.be.undefined;

            // Timeout should not be forced (junk calldata was posted by the previous peer, not the timed out peer)
            expect(timeoutStruct!.isForced).to.be.false;
        });
    });

    describe("Forced Inbound Joins", function () {
        it("should propagate forced joins through event listeners and state updates", async function () {
            await harness!.setup(3);
            await harness!.openChannel();

            const mathConsumerFacet = MathConsumerFacet__factory.connect(
                await harness!.channelManager.getAddress(),
                harness!.peers[0].signer
            );
            const [, , , forcedJoinSigner] = await hre.ethers.getSigners();
            const forcedAmount = 275n;

            const initialParticipants =
                await harness!.peers[0].stateManager.diamondStateMachine.getParticipants();
            expect(initialParticipants).to.have.length(3);

            harness!.resetEventSpies();

            const tx = await mathConsumerFacet.forceInboundJoin(
                harness!.channelId,
                forcedJoinSigner.address,
                forcedAmount
            );
            await tx.wait();

            const inboundEventsObserved = await harness!.waitForEventCounts(
                "onInboundMessagesProcessed",
                harness!.peers.map((peer) => ({
                    peerId: peer.index,
                    expectedCount: 1
                })),
                5000,
                { mode: "atLeast" }
            );
            expect(inboundEventsObserved).to.be.true;

            const latestInboundBlock =
                harness!.peers[0].stateManager.storage.inboundMessages.getLatestMessageBlock();
            expect(latestInboundBlock).to.not.equal(
                undefined,
                "forced inbound block should be stored"
            );

            const forcedMessage = latestInboundBlock!.messages[0];
            expect(forcedMessage.participant).to.equal(
                forcedJoinSigner.address
            );
            expect(forcedMessage.balance.amount).to.equal(forcedAmount);

            await harness!.submitNextTransaction((contract) =>
                contract.add(10)
            );
            harness!.assertAllPeersInSync();

            for (const peer of harness!.peers) {
                const participants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                expect(participants).to.have.length(4);
                expect(participants).to.include(forcedJoinSigner.address);

                const insertedBalance = await peer.contractInstance.getBalance(
                    forcedJoinSigner.address
                );
                expect(insertedBalance).to.equal(forcedAmount);
            }
        });
    });

    describe("Open/Join Channel", function () {
        // Arrange: Setup 3 participants, remove one signature from OpenChannelConfirmation
        // Act: Attempt to submit incomplete OpenChannelConfirmation on-chain
        // Assert: Transaction reverts with signature validation error
        it("should reject channel opening with missing signature", async function () {
            await harness!.setup(3);

            const { encodedOpenChannel, signatures } =
                await harness!.buildOpenChannelRequest({
                    signerIndices: [0, 1] // leave last peer unsigned
                });

            const txPromise = harness!.channelManager.open({
                encodedOpenChannel,
                signatures
            });

            await expect(txPromise).to.be.revertedWith(
                "Cryptography: Not enough signatures provided"
            );
        });

        // Arrange: Setup participants with specific non-zero initial balances
        // Act: Submit OpenChannel with custom balance array
        // Assert: Channel opens with correct initial balances for each participant
        it("should open channel with initial balances", async function () {
            const initialBalance = 123;
            await harness!.setup(3, { initialBalance });

            await harness!.openChannel();

            const math = harness!.peers[0].contractInstance as MathStateMachine;
            const balances = await Promise.all(
                harness!.peers.map((peer) => math.getBalance(peer.address))
            );

            balances.forEach((balance) =>
                expect(balance).to.equal(BigInt(initialBalance))
            );
        });

        // Arrange: Open channel with short deadline; wait past it
        // Act: Attempt to join after deadline
        // Assert: Join reverts with deadline error
        it("should reject joins submitted after the deadline", async function () {
            await harness!.setup(3);

            const now = await time.latest();
            const deadline = Number(now) + 5;

            const forkId = await harness!.openChannelWithSigners(
                {
                    deadlineTimestamp: deadline
                },
                "all"
            );
            expect(forkId).to.not.be.undefined;

            const [, , , lateSigner] = await hre.ethers.getSigners();

            await time.increaseTo(deadline + 1);

            const { signedJoinChannel, signatures } =
                await harness!.buildJoinChannelRequest({
                    participantSigner: lateSigner,
                    channelId: harness!.channelId.toString(),
                    deadlineTimestamp: deadline,
                    thresholdSignerIndices: "all"
                });

            const txPromise = harness!.channelManager.joinChannel({
                signedJoinChannel,
                signatures
            });

            await expect(txPromise).to.be.revertedWithCustomError(
                {
                    interface: new hre.ethers.Interface([
                        "error ErrorJoinChannelExpired()"
                    ])
                },
                "ErrorJoinChannelExpired"
            );
        });
    });
});
