import { TestSession, PeerTestHarness, sleep } from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for Fork Dispute Detection
 *
 * Maps to: src/rpc/services/isForkDisputedService/IsForkDisputedService.ts
 *          src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts
 *
 * Tests the fork dispute acknowledgment mechanism and peer disconnection logic.
 */
describe("E2E: Is Fork Disputed", function () {
    describe("Dispute Acknowledgment Broadcasting", function () {
        it("should broadcast acknowledgment request and receive responses from all peers", async function () {
            const h = TestSession.getHarness();
            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: 1
            });

            await h.rpc.requestDisputeAcknowledgment({ peerIndex: 0 });
            await h.assert.rpc.allPeersAcknowledgedDispute({
                requestingPeer: 0,
                excludePeers: [1]
            });
        });

        it("should successfully acknowledge genuinely disputed fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: 1
            });
            await h.rpc.requestDisputeAcknowledgment({ peerIndex: 0 });
            await h.assert.rpc.allPeersAcknowledgedDispute({
                requestingPeer: 0,
                excludePeers: [1]
            });
        });

        it("should ignore duplicate dispute acknowledgment requests", async function () {
            const h = TestSession.getHarness();
            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: 1
            });
            await h.rpc.requestDisputeAcknowledgment({ peerIndex: 0 });
            await h.assert.rpc.allPeersAcknowledgedDispute({
                requestingPeer: 0,
                excludePeers: [1]
            });
            h.assert.rpc.duplicateDisputeRequestIgnored({ peerIndex: 0 });
            await h.assert.rpc.allPeersAcknowledgedDispute({
                requestingPeer: 0,
                excludePeers: [1]
            });
        });

        it("should disconnect peer sending duplicate acknowledgment responses", async function () {
            const h = TestSession.getHarness();
            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: 1
            });
            await h.rpc.sendDuplicateAcknowledgmentResponse({
                respondingPeer: 0,
                requestingPeer: 2
            });
            h.assert.rpc.firstAcknowledgmentRecorded({
                respondingPeer: 0,
                requestingPeer: 2
            });
            await h.rpc.sendDuplicateAcknowledgmentResponse({
                respondingPeer: 0,
                requestingPeer: 2
            });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 0,
                expectedFinalCount: 0
            });
        });

        it("should disconnect non-responding peers after acknowledgment timeout", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, { timeConfig: { agreementTime: 1 } });
            await h.rpc.requestFakeDisputeWithSpiedDisconnect({
                requestingPeer: 0
            });
            await sleep(2500);
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 0,
                expectedFinalCount: 0
            });
        });
    });

    describe("Byzantine Peer Detection", function () {
        it("should disconnect peer building on acknowledged disputed fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: 1
            });
            await h.rpc.requestDisputeAcknowledgment({ peerIndex: 0 });
            await h.assert.rpc.allPeersAcknowledgedDispute({
                requestingPeer: 0,
                excludePeers: [1]
            });
            await h.rpc.simulateBuildOnDisputedFork({
                buildingPeer: 2,
                observingPeer: 0
            });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 0,
                expectedFinalCount: 0
            });
        });

        it("should disconnect peer requesting acknowledgment of non-disputed fork", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            h.event.resetEventSpies();
            await h.rpc.sendFakeDisputeRequest({ fromPeer: 0, toPeer: 1 });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 1,
                expectedFinalCount: 1
            });
        });
    });
});
