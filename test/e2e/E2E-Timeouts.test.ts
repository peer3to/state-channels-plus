import { MathTestSession as TestSession } from "@test/harness";

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
            await h.lifecycle.timeoutSetup(3, 2);

            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1],
                timeoutMs: 10000
            });
            await h.assert.dispute.didNotInitiate({ peers: [2] });
            h.assert.calldata.noCalldataPosted();
        });

        it("should demonstrate timeout creates disputes", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1],
                timeoutMs: 10000
            });
        });
    });

    describe("Network Disconnection Timeouts", function () {
        it("should handle timeout when non-author peer disconnects (calldata posting)", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 2,
                    chainFallbackTime: 4,
                    evidenceTime: 3
                }
            });
            await h.network.disconnectPeer(2);
            // TODO - never flaky when run in isolation - very flaky when run in parallel
            // TODO - under load Peer 1 can experience RaceConditionBlockCalldataTimestampTooLate - investigate
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] }); // Peers 0 and 1 write (peer 2 disconnected)
            await h.assert.calldata.calldataPosted();
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
        });

        it("should handle timeout when author peer disconnects", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 4);
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
            await h.lifecycle.timeoutSetup(3, 2);
            const currentBlockHeight = await h
                .control(h.peers[0])
                .query.getLatestBlockHeight(h.activeForkId!)
                .request();
            if (currentBlockHeight === null) {
                throw new Error("No current block found");
            }

            await h.byzantine.postJunkCalldataOnChain(2, {
                height: currentBlockHeight + 1
            });
            await h.event.waitUntilEventOccurs("onBlockCalldataPosted");
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1],
                timeoutMs: 10000
            });
            await h.assert.dispute.committedWait();
            h.assert.storage.storedTimeout({ timedoutParticipantIndex: 2 });
        });

        it("should handle timeout when previous peer posted junk calldata and next peer doesn't author block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 3);

            const currentBlockHeight = await h
                .control(h.peers[0])
                .query.getLatestBlockHeight(h.activeForkId!)
                .request();
            if (currentBlockHeight === null) {
                throw new Error("No current block found");
            }

            await h.byzantine.postJunkCalldataOnChain(2, {
                height: currentBlockHeight
            });
            await h.event.waitUntilEventOccurs("onBlockCalldataPosted");
            h.event.resetEventSpies();
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [1, 2],
                timeoutMs: 10000
            });
            await h.assert.storage.storedTimeout({
                timedoutParticipantIndex: 0,
                peerToCheck: 1
            }); // peer 0 should be timed out for not authoring block
            await h.assert.storage.storedTimeout({
                timedoutParticipantIndex: 0,
                peerToCheck: 2
            }); // peer 0 should be timed out for not authoring block
        });
    });

    describe("Network Liveness", function () {
        it("should maintain liveness when peer disconnects mid-transaction", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.network.disconnectPeer(2);
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
            h.assert.dispute.noDisputes();
        });
    });
});
