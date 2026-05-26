import type { ForkId } from "@/types/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class AssertRPCActions {
    constructor(private readonly harness: PeerTestHarness) {}

    async peerDisconnectedFrom(options: {
        peerIndex: number;
        expectedFinalCount: number;
        timeoutMs?: number;
    }): Promise<void> {
        const { peerIndex, expectedFinalCount, timeoutMs = 5000 } = options;

        await this.harness.disconnectionBarrier.waitFor(
            async () =>
                (await this.harness.query.getConnectionCount(peerIndex)) ===
                expectedFinalCount,
            {
                timeoutMs,
                timeoutMessageFn: async () =>
                    `Expected peer ${peerIndex} to have ${expectedFinalCount} connection(s) within ${timeoutMs}ms, actual: ${await this.harness.query.getConnectionCount(peerIndex)}`
            }
        );
    }

    handshakeCompleted(options: { peer1: number; peer2: number }): void {
        const { peer1, peer2 } = options;
        const peer2Obj = this.harness.getPeer(peer2);
        const isCompleted = this.harness.rpc.isHandshakeCompleted(
            peer1,
            peer2Obj.address
        );

        if (!isCompleted) {
            throw new Error(
                `Expected handshake to be completed between peer ${peer1} and peer ${peer2}, but it is not`
            );
        }
    }

    async allHandshakesCompleted(
        handshakes: Array<{ peer1: number; peer2: number }>
    ): Promise<void> {
        for (const { peer1, peer2 } of handshakes) {
            this.handshakeCompleted({ peer1, peer2 });
        }
    }

    async allPeersAcknowledgedDispute(options: {
        requestingPeer: number;
        forkId?: ForkId;
        excludePeers?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const {
            requestingPeer,
            forkId,
            excludePeers = [],
            timeoutMs = 5000
        } = options;

        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const requestingService =
            this.harness.rpc.getIsForkDisputedService(requestingPeer);

        const totalPeers = this.harness.peers.length;
        const expectedAcknowledgments = totalPeers - excludePeers.length - 1;

        await this.harness.rpcBarrier.waitFor(
            () => {
                const acknowledgedPeers = this.harness.peers
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
    }

    duplicateDisputeRequestIgnored(options: {
        peerIndex: number;
        forkId?: ForkId;
    }): void {
        const { peerIndex, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const service = this.harness.rpc.getIsForkDisputedService(peerIndex);
        const disputedForksBefore = service.disputedForks.size;
        service.requestDisputeAcknowledgment(
            this.harness.channelId!,
            activeForkId
        );
        const disputedForksAfter = service.disputedForks.size;

        if (disputedForksAfter !== disputedForksBefore) {
            throw new Error(
                `Expected duplicate request to be ignored, but disputedForks changed from ${disputedForksBefore} to ${disputedForksAfter}`
            );
        }
    }

    firstAcknowledgmentRecorded(options: {
        respondingPeer: number;
        requestingPeer: number;
        forkId?: ForkId;
    }): void {
        const { respondingPeer, requestingPeer, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const requestingPeerObj = this.harness.getPeer(requestingPeer);
        const service =
            this.harness.rpc.getIsForkDisputedService(respondingPeer);

        const acknowledged = service.didIAcknowledgeDisputedFork(
            requestingPeerObj.address,
            activeForkId
        );

        if (!acknowledged) {
            throw new Error(
                `Expected peer ${respondingPeer} to have acknowledged fork ${activeForkId} to peer ${requestingPeer}, but did not`
            );
        }
    }

    async transportClosedOrGone(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.query
            .waitForPeerTransport(fromPeer, toPeer, 1000)
            .catch(() => null);

        if (transport && !transport.isClosed) {
            throw new Error(
                `Expected transport from peer ${fromPeer} to peer ${toPeer} to be closed, but it is still open`
            );
        }
    }
}
