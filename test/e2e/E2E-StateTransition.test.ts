import { BLOCK_TIME_MS, MAX_TX_GAS } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { slotDeployerIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * E2E Tests for State Transitions
 *
 * Maps to: src/rpc/network/services/stateTransition/
 *          src/stateManager/StateManager.ts
 *
 * Tests the core state transition mechanism, block creation, and state advancement.
 */
describe("E2E: State Transitions", function () {
    it("the test chain makes one block per BLOCK_TIME_MS and takes a transaction at MAX_TX_GAS", async function () {
        const h = TestSession.getHarness();
        await h.setup(2);
        const start = await h.provider.getBlockNumber();
        await waitFor(
            async () => (await h.provider.getBlockNumber()) >= start + 3
        );

        const blocks = await Promise.all(
            [0, 1, 2, 3].map((offset) => h.provider.getBlock(start + offset))
        );
        const steps = blocks
            .slice(1)
            .map((block, index) => block!.timestamp - blocks[index]!.timestamp);
        const blockSeconds = BLOCK_TIME_MS / 1000;
        expect(steps).to.deep.equal([blockSeconds, blockSeconds, blockSeconds]);

        const deployer = h.signerFor(slotDeployerIndex());
        const atCap = await (
            await deployer.sendTransaction({
                to: deployer.address,
                gasLimit: MAX_TX_GAS
            })
        ).wait();
        expect(atCap?.status).to.equal(1);
    });

    it("the peer3 chain refuses a transaction at MAX_TX_GAS + 1", async function () {
        // hardhat has no per-transaction cap below its block gas limit
        if (process.env.TEST_CHAIN !== "peer3") this.skip();
        const h = TestSession.getHarness();
        await h.connectChain();
        const deployer = h.signerFor(slotDeployerIndex());
        await expect(
            deployer.sendTransaction({
                to: deployer.address,
                gasLimit: MAX_TX_GAS + 1n
            })
        ).to.be.rejectedWith(/exceeds transaction gas limit cap/);
    });

    describe("Basic State Advancement", function () {
        it("should handle consecutive blocks between participants", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3);
            await h.transition.advanceState({ count: 10 });
            await h.assert.sync.peersInSyncWait();
            await h.assert.sync.blockHeight({ expectedHeight: 9 }); // 10 blocks after genesis = height 9
        });

        it("should handle full round rotation", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4);
            await h.transition.advanceState({ rounds: 1 }); // All 4 peers write once
            await h.assert.sync.peersInSyncWait();
            await h.assert.sync.blockHeight({ expectedHeight: 3 }); // 4 transitions = height 3
        });

        it("should handle multiple rotation rounds", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3);
            await h.transition.advanceState({ rounds: 3 }); // 3 rounds = 9 transitions
            await h.assert.sync.peersInSyncWait();
            await h.assert.sync.blockHeight({ expectedHeight: 8 });
        });
    });

    describe("State Modifications", function () {
        it("should handle honest peer transitions after fork resolution", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.start(4, 2);
            await h.assert.sync.peersInSyncWait();

            const maliciousPeerIndex = 2;
            const forkId = h.activeForkId!;

            await h.dispute.createInvalidStateTransitionDispute(
                maliciousPeerIndex,
                {
                    resetEventSpies: true
                }
            );
            await h.assert.dispute.initiatedAndCommitedWait();
            await h.dispute.resolveDisputeWait({ forkId });
            await h.transition.advanceState({ count: 3 });

            await h.assert.sync.onlyHonestPeersInSync();
        });
    });

    describe("Authoring Rollback", function () {
        it("the writer's state machine refuses a pending top-up → its candidate fails, it recovers and authors, every peer stores the same block and no dispute starts", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const forkId = h.activeForkId!;

            const writer = await h.query.getNextPeerToWrite();
            const acceptInbound = await h.rpcStub.refuseInboundMessages(
                writer.index
            );
            // a real top-up lands on chain -> the writer's next block must
            // carry it, and its state machine refuses the message
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });
            const heightBefore = await h
                .control(writer)
                .query.getNextBlockHeight(forkId)
                .request();

            let message = "no throw";
            try {
                await h
                    .getPeer(writer.index)
                    .p2pInstance.p2pContractInstance.add(1);
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }
            expect(message).to.contain("Failed to process inbound message");

            await acceptInbound();
            await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add(1);

            await h.assert.sync.peersInSyncWait();
            const blockHashes = await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .query.getBlockHashAt(forkId, heightBefore)
                        .request()
                )
            );
            expect(blockHashes[0]).to.be.a("string");
            expect(new Set(blockHashes).size).to.equal(1);
            for (const peer of h.peers) {
                expect(
                    h.event.getEventCallCount(peer.index, "disputeStarted")
                ).to.equal(0);
            }
            await h.assert.dispute.didNotInitiate({
                peers: h.peers.map((peer) => peer.index)
            });
        });
    });
});
