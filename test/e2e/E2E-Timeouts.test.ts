import { TestSession, PeerTestHarness } from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for Timeout Management
 *
 * Maps to: src/agreementManager/AgreementManager.ts
 *          src/utils/TimeoutManager.ts
 *          src/Clock.ts
 *
 * Tests timeout detection, forced timeouts, and network liveness during disconnections.
 */
describe("E2E: Timeouts", function () {
    describe("Basic Timeout Scenarios", function () {
        it("should handle timeout when next peer to write does not author a block", async function () {
            this.timeout(90000);
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            await h.transition.advanceState({ count: 2 }); // Peers 0 and 1 take their turn

            h.event.resetEventSpies();
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1],
                timeoutMs: 10000
            });
            await h.assert.dispute.didNotInitiate({ peers: [2] });
            h.assert.calldata.noCalldataPosted();
        });

        it("should demonstrate timeout creates disputes", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            await h.transition.advanceState({ count: 2 }); // First 2 peers take turn, 3rd doesn't

            h.event.resetEventSpies();
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1],
                timeoutMs: 10000
            });
        });
    });

    describe("Network Disconnection Timeouts", function () {
        it("should handle timeout when non-author peer disconnects (calldata posting)", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            await h.transition.advanceState({ rounds: 1 }); // All 3 peers write once
            h.event.resetEventSpies();
            await h.network.disconnectPeer(2);
            await h.transition.advanceState({ count: 2 }); // Peers 0 and 1 write (peer 2 disconnected)
            await h.assert.calldata.calldataPosted();
        });

        it("should handle timeout when author peer disconnects", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            await h.transition.advanceState({ rounds: 1 }); // Heights 0,1,2
            await h.transition.advanceState({ count: 1 }); // Height 3
            h.event.resetEventSpies();
            await h.network.disconnectPeer(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 2],
                timeoutMs: 10000
            });
        });
    });

    describe("Forced Timeout (Junk Calldata)", function () {
        it("should create forced timeout when peer posts junk calldata that is rejected", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            await h.transition.advanceState({ count: 2 }); // Peers 0 and 1 write
            h.event.resetEventSpies();

            const currentBlock =
                h.peers[0].stateManager.storage.blocks.getLatestBlock(
                    h.activeForkId!
                );
            if (!currentBlock) {
                throw new Error("No current block found");
            }

            await h.byzantine.postJunkCalldataOnChain(2, {
                forkId: h.activeForkId!,
                height: currentBlock.height + 1
            });
            await h.event.waitUntilEventOccurs("onBlockCalldataPosted");
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1],
                timeoutMs: 10000
            });
            await h.assert.dispute.committedWait();
            h.assert.storage.storedTimeout({ participant: 2 });
        });

        it("should handle timeout when previous peer posted junk calldata and next peer doesn't author block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3);
            await h.transition.advanceState({ count: 2 }); // Peers 0 and 1 write
            await h.transition.peerWrite({ peer: 2 }); // Peer 2 writes valid block
            h.event.resetEventSpies();

            const currentBlock =
                h.peers[0].stateManager.storage.blocks.getLatestBlock(
                    h.activeForkId!
                );
            if (!currentBlock) {
                throw new Error("No current block found");
            }

            await h.byzantine.postJunkCalldataOnChain(2, {
                forkId: h.activeForkId!,
                height: currentBlock.height
            });
            await h.event.waitUntilEventOccurs("onBlockCalldataPosted");
            h.event.resetEventSpies();
            await h.assert.dispute.initiatedWait({
                peersIndices: [1, 2],
                timeoutMs: 10000
            });
        });
    });

    describe("Network Liveness", function () {
        it("should maintain liveness when peer disconnects mid-transaction", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.network.disconnectPeer(2);
            await h.transition.advanceState({ count: 1 });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
            h.assert.dispute.noDisputes();
        });
    });
});
