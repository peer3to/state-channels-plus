import { getReconnectDelayMs } from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import {
    assertBlockEventsComeFromNodeSockets,
    assertDestroyRejectsInFlightRead,
    assertDestroyRejectsWaitingRead,
    assertNodeOnAnotherChainRefused,
    assertSilentNodeMarkedDeadAndReadFailsOver,
    assertStartupDoesNotWaitForASilentNode,
    assertStopReconnectingRejectsWaitingRead,
    assertTransactionFailsOverAfterFirstNodeForwardedIt,
    assertTransactionWaitResolvesAfterReconnect,
    assertDestroyFailsHeldRequest,
    assertHeldRequestAnsweredAfterRestore,
    assertNeverConnectedNodeFailsAtOnce,
    assertReadFailsOverWhenNodeDropsMidRequest,
    assertReadsFailOverToNextNode,
    assertRefusedNodeKeepsReconnecting,
    assertReopenedSocketHandedToWatchers,
    assertStartupFailsWithoutReachableNode,
    assertStartupWithOneUnreachableNode,
    assertStopReconnectingLeavesNodeDown,
    assertTransactionFailsOverToNextNode,
    assertTransactionHeldUntilANodeReconnects,
    assertTransactionSentToFirstNodeOnly
} from "@test/fixtures/node/RpcNodesFixture";
import { expect } from "chai";

describe("RpcNodeProvider", () => {
    it("doubles the reconnect delay from 250 ms up to a 5 s bound", () => {
        expect(
            [0, 1, 2, 3, 4, 5, 6, 40].map((failedAttempts) =>
                getReconnectDelayMs(failedAttempts)
            )
        ).to.deep.equal([250, 500, 1000, 2000, 4000, 5000, 5000, 5000]);
    });

    it("answers a request held while its node is cut once the node is back", async () => {
        await assertHeldRequestAnsweredAfterRestore();
    });

    it("hands every reopened socket to its watchers as reopened", async () => {
        await assertReopenedSocketHandedToWatchers();
    });

    it("fails requests at once while its node has never connected", async () => {
        await assertNeverConnectedNodeFailsAtOnce();
    });

    it("keeps reconnecting a node that refused its first connection", async () => {
        await assertRefusedNodeKeepsReconnecting();
    });

    it("never reconnects after stopReconnecting", async () => {
        await assertStopReconnectingLeavesNodeDown();
    });

    it("fails a request held for a reconnect when destroyed", async () => {
        await assertDestroyFailsHeldRequest();
    });

    it("refuses a node that serves another chain than the first connected node", async () => {
        await assertNodeOnAnotherChainRefused();
    });
});

describe("MultiRpcProvider", () => {
    it("sends a transaction to the first node only while it is connected", async () => {
        await assertTransactionSentToFirstNodeOnly();
    });

    it("fails a transaction over to the next node while the first is cut", async () => {
        await assertTransactionFailsOverToNextNode();
    });

    it("holds a transaction while no node is connected and sends it once one reconnects", async () => {
        await assertTransactionHeldUntilANodeReconnects();
    });

    it("answers reads through the next node while the first is cut", async () => {
        await assertReadsFailOverToNextNode();
    });

    it("fails a read over to the next node when the first drops mid-request", async () => {
        await assertReadFailsOverWhenNodeDropsMidRequest();
    });

    it("marks a node whose socket stops answering as dead and fails the read over", async () => {
        await assertSilentNodeMarkedDeadAndReadFailsOver();
    });

    it("fails a transaction over to the next node when the first drops after forwarding it", async () => {
        await assertTransactionFailsOverAfterFirstNodeForwardedIt();
    });

    it("resolves a transaction wait from a node socket's block event after a reconnect", async () => {
        await assertTransactionWaitResolvesAfterReconnect();
    });

    it("rejects a read in flight when destroyed", async () => {
        await assertDestroyRejectsInFlightRead();
    });

    it("rejects a read waiting for a node when destroyed", async () => {
        await assertDestroyRejectsWaitingRead();
    });

    it("rejects a read waiting for a node when reconnects stop", async () => {
        await assertStopReconnectingRejectsWaitingRead();
    });

    it("relays each new block once from the node sockets without polling", async () => {
        await assertBlockEventsComeFromNodeSockets();
    });

    it("starts the runtime chain context while one of its nodes is unreachable", async () => {
        await assertStartupWithOneUnreachableNode();
    });

    it("fails runtime startup when no node is reachable and names every node", async () => {
        await assertStartupFailsWithoutReachableNode();
    });

    it("starts the runtime chain context without waiting for a silent node", async () => {
        await assertStartupDoesNotWaitForASilentNode();
    });
});
