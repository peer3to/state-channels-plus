import type { ForkId } from "@/types/types";
import type { Status } from "@/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { TestPeer } from "@test/harness/core/types";
import { expect } from "chai";

export class AssertRPCActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(private readonly harness: PeerTestHarness<TCustomRpc>) {}

    // The observer blacklists and disconnects the target (a byzantine sender it
    // rejected) without going offline
    async peerBlacklistedAndDisconnected(options: {
        observer: TestPeer<TCustomRpc>;
        target: TestPeer<TCustomRpc>;
        expectedStatus: Status;
        timeoutMs?: number;
    }): Promise<void> {
        const {
            observer,
            target,
            expectedStatus,
            timeoutMs = this.harness.event.protocolEventTimeoutMs()
        } = options;

        await this.harness.disconnectionBarrier.waitFor(
            async () =>
                await this.harness
                    .control(observer)
                    .query.isBlacklisted(target.address)
                    .request(),
            {
                timeoutMs,
                timeoutMessage: `Expected peer ${observer.index} to blacklist peer ${target.index} within ${timeoutMs}ms`
            }
        );
        expect(
            await this.harness
                .control(observer)
                .query.isConnectedTo(target.address)
                .request(),
            `peer ${observer.index} stayed connected to blacklisted peer ${target.index}`
        ).to.equal(false);
        expect(
            await this.harness.control(observer).query.getStatus().request(),
            `peer ${observer.index} status changed while dropping peer ${target.index}`
        ).to.equal(expectedStatus);
    }

    async peerDisconnectedFrom(options: {
        peerIndex: number;
        expectedFinalCount: number;
        timeoutMs?: number;
    }): Promise<void> {
        const {
            peerIndex,
            expectedFinalCount,
            timeoutMs = this.harness.event.protocolEventTimeoutMs()
        } = options;

        await this.harness.disconnectionBarrier.waitFor(
            async () =>
                (await this.harness.query.getConnectionCount(peerIndex)) ===
                expectedFinalCount,
            {
                timeoutMs,
                timeoutMessage: `Expected peer ${peerIndex} to have ${expectedFinalCount} connection(s) within ${timeoutMs}ms`
            }
        );
    }

    async handshakeCompleted(options: {
        peer1: number;
        peer2: number;
    }): Promise<void> {
        const { peer1, peer2 } = options;
        const peer2Obj = this.harness.getPeer(peer2);
        const isCompleted = await this.harness.rpc.isHandshakeCompleted(
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
            await this.handshakeCompleted({ peer1, peer2 });
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
            timeoutMs = this.harness.event.protocolEventTimeoutMs()
        } = options;

        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const totalPeers = this.harness.peers.length;
        const expectedAcknowledgments = totalPeers - excludePeers.length - 1;

        await this.harness.rpcBarrier.waitFor(
            async () => {
                const candidates = this.harness.peers.filter(
                    (p, i) => !excludePeers.includes(i) && i !== requestingPeer
                );
                const acks = await Promise.all(
                    candidates.map((p) =>
                        this.harness.rpc.didPeerAcknowledgeDisputedFork(
                            requestingPeer,
                            p.address,
                            activeForkId
                        )
                    )
                );
                return acks.filter(Boolean).length >= expectedAcknowledgments;
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

        const peer = this.harness.getPeer(peerIndex);
        const disputedForksBefore = await this.harness
            .control(peer)
            .handshake.getDisputedForksCount()
            .request();
        await this.harness
            .control(peer)
            .handshake.requestDisputeAcknowledgment(
                this.harness.channelId!,
                activeForkId
            )
            .request();
        const disputedForksAfter = await this.harness
            .control(peer)
            .handshake.getDisputedForksCount()
            .request();

        if (disputedForksAfter !== disputedForksBefore) {
            throw new Error(
                `Expected duplicate request to be ignored, but disputedForks changed from ${disputedForksBefore} to ${disputedForksAfter}`
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

        const requestingPeerObj = this.harness.getPeer(requestingPeer);
        const respondingPeerObj = this.harness.getPeer(respondingPeer);

        const acknowledged = await this.harness
            .control(respondingPeerObj)
            .handshake.didIAcknowledgeDisputedFork(
                requestingPeerObj.address,
                activeForkId
            )
            .request();

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
        const fromPeerObj = this.harness.getPeer(fromPeer);
        const toAddress = this.harness.getPeer(toPeer).address;

        const closedOrGone = await this.harness
            .control(fromPeerObj)
            .query.isTransportClosed(toAddress)
            .request();

        if (!closedOrGone) {
            throw new Error(
                `Expected transport from peer ${fromPeer} to peer ${toPeer} to be closed, but it is still open`
            );
        }
    }
}
