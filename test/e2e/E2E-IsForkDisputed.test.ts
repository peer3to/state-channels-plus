import { MathTestSession as TestSession, sleep } from "@test/harness";
import { registerTemporaryRpcStubHandler } from "@test/harness/worker-handlers/rpc-stub-handlers";
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

            // step 1 - test-local toggle. genuinely scoped to this case ->
            // ephemeral registration (no worker round-trip; inline only).
            let called = false;
            const handlerId = "test.E2E-IsForkDisputed.stubAckRequest";
            const unregister = registerTemporaryRpcStubHandler(
                handlerId,
                async () => {
                    called = true;
                }
            );

            try {
                const restore = await h.rpcStub.installNamedStub({
                    peerIndex: 1,
                    serviceName: "isForkDisputedService",
                    methodName: "onDisputeAcknowledgmentRequest",
                    handlerId
                });

                await h.rpc.sendFakeDisputeRequest({ fromPeer: 0, toPeer: 1 });

                expect(called).to.equal(true);

                await restore();
            } finally {
                unregister();
            }
        });
    });
});
