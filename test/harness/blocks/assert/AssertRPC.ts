import { HarnessBlock } from "../HarnessBlock";

/**
 * RPC-specific assertion blocks
 * Extracted from AssertBlocks.ts for better organization and maintainability
 */
export class AssertRPC {
    /**
     * Assert peer was disconnected (expects specific final connection count)
     * Uses disconnectionBarrier for event-driven waiting
     */
    static peerDisconnectedFrom(options: {
        peerIndex: number;
        expectedFinalCount: number;
        timeoutMs?: number;
    }) {
        const { peerIndex, expectedFinalCount, timeoutMs = 5000 } = options;

        return new HarnessBlock(async (harness) => {
            // Wait for connection count to reach expected final count
            await harness.disconnectionBarrier.waitFor(
                () =>
                    harness.stateQuery.getConnectionCount(peerIndex) ===
                    expectedFinalCount,
                {
                    timeoutMs,
                    timeoutMessage: `Expected peer ${peerIndex} to have ${expectedFinalCount} connection(s) within ${timeoutMs}ms, actual: ${harness.stateQuery.getConnectionCount(peerIndex)}`
                }
            );

            return harness;
        });
    }

    /**
     * Assert peer was disconnected (connection count decreased)
     * Uses disconnectionBarrier for event-driven waiting
     */
    static peerDisconnected(options: {
        peerIndex: number;
        expectedDisconnections?: number;
        timeoutMs?: number;
    }) {
        const {
            peerIndex,
            expectedDisconnections = 1,
            timeoutMs = 5000
        } = options;

        return new HarnessBlock(async (harness) => {
            const connectionsBefore =
                harness.stateQuery.getConnectionCount(peerIndex);
            const expectedCount = connectionsBefore - expectedDisconnections;

            // Use disconnectionBarrier (event-driven) - signaled by onDisconnection hook
            await harness.disconnectionBarrier.waitFor(
                () =>
                    harness.stateQuery.getConnectionCount(peerIndex) <=
                    expectedCount,
                {
                    timeoutMs,
                    timeoutMessage: `Expected peer ${peerIndex} to lose ${expectedDisconnections} connection(s) within ${timeoutMs}ms, lost: ${connectionsBefore - harness.stateQuery.getConnectionCount(peerIndex)}`
                }
            );

            const connectionsAfter =
                harness.stateQuery.getConnectionCount(peerIndex);
            if (connectionsAfter > expectedCount) {
                throw new Error(
                    `Expected peer ${peerIndex} to lose ${expectedDisconnections} connection(s), ` +
                        `but only lost ${connectionsBefore - connectionsAfter} ` +
                        `(before: ${connectionsBefore}, after: ${connectionsAfter})`
                );
            }

            return harness;
        });
    }

    /**
     * Assert all connected peers acknowledged dispute
     */
    static allPeersAcknowledgedDispute(options: {
        requestingPeer: number;
        forkId?: import("@/types/types").ForkId;
        excludePeers?: number[];
        timeoutMs?: number;
    }) {
        const {
            requestingPeer,
            forkId,
            excludePeers = [],
            timeoutMs = 5000
        } = options;

        return new HarnessBlock(async (harness) => {
            const activeForkId = forkId ?? harness.activeForkId;
            if (!activeForkId) {
                throw new Error("No active fork ID");
            }

            const requestingService =
                harness.rpcActions.getIsForkDisputedService(requestingPeer);

            // Calculate expected number of acknowledging peers
            const totalPeers = harness.peers.length;
            const expectedAcknowledgments =
                totalPeers - excludePeers.length - 1; // -1 for self

            // Use rpcBarrier to wait for acknowledgments (event-driven)
            // The barrier is signaled when onDisputeAcknowledgmentResponse is received
            await harness.rpcBarrier.waitFor(
                () => {
                    const acknowledgedPeers = harness.peers
                        .filter((_, i) => !excludePeers.includes(i))
                        .filter((_, i) => i !== requestingPeer)
                        .filter((p) =>
                            requestingService.didPeerAcknowledgeDisputedFork(
                                p.address,
                                activeForkId
                            )
                        );

                    return acknowledgedPeers.length >= expectedAcknowledgments;
                },
                {
                    timeoutMs,
                    timeoutMessage: `Not all peers acknowledged disputed fork ${activeForkId} to peer ${requestingPeer} within ${timeoutMs}ms`
                }
            );

            return harness;
        });
    }

    /**
     * Assert handshake completed between two peers
     */
    static handshakeCompleted(options: { peer1: number; peer2: number }) {
        const { peer1, peer2 } = options;

        return new HarnessBlock(async (harness) => {
            const peer2Obj = harness.getPeer(peer2);
            const isCompleted = harness.rpcActions.isHandshakeCompleted(
                peer1,
                peer2Obj.address
            );

            if (!isCompleted) {
                throw new Error(
                    `Expected handshake to be completed between peer ${peer1} and peer ${peer2}, ` +
                        `but it is not`
                );
            }

            return harness;
        });
    }

    /**
     * Assert duplicate dispute acknowledgment request is ignored (idempotent)
     */
    static duplicateDisputeRequestIgnored(options: {
        peerIndex: number;
        forkId?: import("@/types/types").ForkId;
    }) {
        const { peerIndex, forkId } = options;

        return new HarnessBlock(async (harness) => {
            const activeForkId = forkId ?? harness.activeForkId;
            if (!activeForkId) {
                throw new Error("No active fork ID");
            }

            const service =
                harness.rpcActions.getIsForkDisputedService(peerIndex);
            const disputedForksBefore = service.disputedForks.size;

            // Try to request again
            service.requestDisputeAcknowledgment(
                harness.channelId!,
                activeForkId
            );

            const disputedForksAfter = service.disputedForks.size;

            if (disputedForksAfter !== disputedForksBefore) {
                throw new Error(
                    `Expected duplicate request to be ignored, but disputedForks changed ` +
                        `from ${disputedForksBefore} to ${disputedForksAfter}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert first acknowledgment was recorded
     */
    static firstAcknowledgmentRecorded(options: {
        respondingPeer: number;
        requestingPeer: number;
        forkId?: import("@/types/types").ForkId;
    }) {
        const { respondingPeer, requestingPeer, forkId } = options;

        return new HarnessBlock(async (harness) => {
            const activeForkId = forkId ?? harness.activeForkId;
            if (!activeForkId) {
                throw new Error("No active fork ID");
            }

            const requestingPeerObj = harness.getPeer(requestingPeer);
            const service =
                harness.rpcActions.getIsForkDisputedService(respondingPeer);

            const acknowledged = service.didIAcknowledgeDisputedFork(
                requestingPeerObj.address,
                activeForkId
            );

            if (!acknowledged) {
                throw new Error(
                    `Expected peer ${respondingPeer} to have acknowledged fork ${activeForkId} ` +
                        `to peer ${requestingPeer}, but did not`
                );
            }

            return harness;
        });
    }

    /**
     * Assert transport is closed or gone after timeout
     */
    static transportClosedOrGone(options: {
        fromPeer: number;
        toPeer: number;
    }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery
                .waitForPeerTransport(fromPeer, toPeer, 1000)
                .catch(() => null);

            // Transport should either be gone or closed
            if (transport && !transport.isClosed) {
                throw new Error(
                    `Expected transport from peer ${fromPeer} to peer ${toPeer} ` +
                        `to be closed, but it is still open`
                );
            }

            return harness;
        });
    }

    /**
     * Assert all specified handshakes are completed
     */
    static allHandshakesCompleted(
        handshakes: Array<{ peer1: number; peer2: number }>
    ) {
        return new HarnessBlock(async (harness) => {
            for (const { peer1, peer2 } of handshakes) {
                await AssertRPC.handshakeCompleted({ peer1, peer2 }).run(
                    harness
                );
            }
            return harness;
        });
    }
}
