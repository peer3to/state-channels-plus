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

        const requestingHandle = this.harness.getPeerHandle(requestingPeer);

        const totalPeers = this.harness.peers.length;
        const expectedAcknowledgments = totalPeers - excludePeers.length - 1;

        // candidate peers for the acknowledgment check; computed once.
        const candidates = this.harness.peers
            .map((p, i) => ({ p, i }))
            .filter(({ i }) => !excludePeers.includes(i))
            .filter(({ i }) => i !== requestingPeer);

        await this.harness.rpcBarrier.waitFor(
            async () => {
                const results = await Promise.all(
                    candidates.map(({ p }) =>
                        requestingHandle.queryInternals
                            .isForkDisputedService({
                                op: "didPeerAcknowledgeDisputedFork",
                                args: [p.address, activeForkId]
                            })
                            .then((v) => v as boolean)
                    )
                );
                const acknowledgedCount = results.filter(Boolean).length;
                return acknowledgedCount >= expectedAcknowledgments;
            },
            {
                timeoutMs,
                timeoutMessage: `Not all peers acknowledged disputed fork ${activeForkId} to peer ${requestingPeer} within ${timeoutMs}ms`
            }
        );
    }

    async duplicateDisputeRequestIgnored(options: {
        peerIndex: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { peerIndex, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        // requestDisputeAcknowledgment returns false when the fork is already disputed.
        const handle = this.harness.getPeerHandle(peerIndex);
        const accepted = (await handle.queryInternals.isForkDisputedService({
            op: "requestDisputeAcknowledgment",
            args: [this.harness.channelId!, activeForkId]
        })) as boolean;

        if (accepted !== false) {
            throw new Error(
                `Expected duplicate request to be ignored, but requestDisputeAcknowledgment returned ${accepted}`
            );
        }
    }

    async firstAcknowledgmentRecorded(options: {
        respondingPeer: number;
        requestingPeer: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { respondingPeer, requestingPeer, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const requestingAddr =
            this.harness.getPeerHandle(requestingPeer).address;
        const handle = this.harness.getPeerHandle(respondingPeer);
        const acknowledged = (await handle.queryInternals.isForkDisputedService(
            {
                op: "didIAcknowledgeDisputedFork",
                args: [requestingAddr, activeForkId]
            }
        )) as boolean;

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
        const handle = this.harness.getPeerHandle(fromPeer);
        const toAddr = this.harness.getPeerHandle(toPeer).address;
        const status = await handle.queryInternals.getTransportStatus(toAddr);
        if (status.present && status.isClosed !== true) {
            throw new Error(
                `Expected transport from peer ${fromPeer} to peer ${toPeer} to be closed, but it is still open`
            );
        }
    }
}
