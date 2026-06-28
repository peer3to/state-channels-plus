import { MathTestSession as TestSession, sleep } from "@test/harness";
import { expect } from "chai";

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

        it("should disconnect peer sending duplicate acknowledgment requests", async function () {
            const h = TestSession.getHarness();
            await h.scenario.activeChannelWithDispute({
                numPeers: 3,
                numBlocks: 2,
                byzantinePeer: 1
            });
            // Peer 0 receives a dispute-ack request from peer 2 for the
            // genuinely disputed fork and acknowledges it.
            await h.rpc.sendDisputeAckRequest({ fromPeer: 2, toPeer: 0 });
            await h.assert.rpc.firstAcknowledgmentRecorded({
                respondingPeer: 0,
                requestingPeer: 2
            });
            // A second request for the same already-acknowledged fork is a
            // protocol violation -> peer 0 disconnects the requester.
            await h.rpc.sendDisputeAckRequest({ fromPeer: 2, toPeer: 0 });
            await h.assert.rpc.peerDisconnectedFrom({
                peerIndex: 0,
                expectedFinalCount: 0
            });
        });

        it("should disconnect non-responding peers after acknowledgment timeout", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
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

        it("should run stubbed RPC method via createRPCMethods wrapper", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 2);

            const restore = await h.rpcStub.stubRecordDisputeAckRequest(1);

            await h.rpc.sendFakeDisputeRequest({ fromPeer: 0, toPeer: 1 });

            expect(await h.rpcStub.wasDisputeAckRequestCalled(1)).to.equal(
                true
            );

            await restore();
        });
    });
});
