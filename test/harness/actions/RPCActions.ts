// step 1 - W1 §6 - RPCActions hits the localRpc service instances via
// `peer.stateManager.p2pManager.localRpc.<service>` and frequently passes a
// live ATransport into createRPCMethods(transport). the audit (W1 appendix A
// bucket ii) maps these to queryInternals.isForkDisputedService({op,args}) and
// queryInternals.initHandshakeService({op,args}), with the worker dispatching
// the op against the in-thread service. that dispatcher exists in
// subHandleRoutes; however the action methods today consume live service
// instances + transports + signers. migrating to the dispatcher requires
// serialising transports + signing args (named-handler registry / W3 envelope
// id seam). until that lands, the action class continues to reach the live
// services through the inline peer's record. dedicatedPeerThread=true is
// W5-blocked at handle construction so every handle is an InlinePeer.

import { ethers } from "ethers";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { LocalDiscoveryServer, Logger } from "@/utils";
import { ForkId, Address } from "@/types/types";
import { hash as fakeHash } from "@test/factory";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import { InlinePeer } from "@test/harness/core/InlinePeer";

/**
 * Actions for RPC service testing
 * Provides access to RPC services and helper methods for test blocks
 */
export class RPCActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    // step 1 - inline-only accessor. live service instance is not on the sub-
    // handle surface; worker-mode equivalent goes through the dispatcher named
    // op (queryInternals.isForkDisputedService) once the named-handler registry
    // lands. callers below are bucket-(ii) deferred.
    private getInlineRecord(peerIndex: number) {
        const handle = this.harness.getPeerHandle(peerIndex) as InlinePeer;
        return handle.record;
    }

    getRemoteRpc(peerIndex: number) {
        return this.getInlineRecord(peerIndex).stateManager.p2pManager
            .remoteRpc;
    }

    getLocalRpc(peerIndex: number) {
        return this.getInlineRecord(peerIndex).stateManager.p2pManager.localRpc;
    }
    /**
     * (alias) Get the transport in fromPeerIndex p2pManager towards toPeerIndex
     */
    getTransport(
        fromPeerIndex: number,
        toPeerIndex: number
    ): ATransport | undefined {
        return this.harness.query.getTransport(fromPeerIndex, toPeerIndex);
    }
    /**
     * Check if handshake is completed between two peers
     */
    async isHandshakeCompleted(
        peerIndex: number,
        otherPeerAddress: Address
    ): Promise<boolean> {
        // route via sub-handle so worker peers can answer over rpc; inline
        // peers run the same predicate body locally.
        return this.harness
            .getPeerHandle(peerIndex)
            .queryInternals.isHandshakeCompletedWith(otherPeerAddress);
    }

    /**
     * Wait for handshake to complete using connection barrier (event-driven)
     */
    private async waitForHandshakeCompleted(
        peerIndex: number,
        otherPeerAddress: Address,
        timeoutMs: number = 5000
    ): Promise<void> {
        await this.harness.connectionBarrier.waitFor(
            () => this.isHandshakeCompleted(peerIndex, otherPeerAddress),
            {
                timeoutMs,
                timeoutMessage: `Handshake between peer ${peerIndex} and ${otherPeerAddress} not completed within ${timeoutMs}ms`
            }
        );
    }

    /**
     * Check if a peer has acknowledged a disputed fork
     */
    async didPeerAcknowledgeDisputedFork(
        requestingPeerIndex: number,
        respondingPeerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        // step 1 - route via sub-handle dispatcher -> worker-safe.
        const handle = this.harness.getPeerHandle(requestingPeerIndex);
        const result = await handle.queryInternals.isForkDisputedService({
            op: "didPeerAcknowledgeDisputedFork",
            args: [respondingPeerAddress.toString(), forkId]
        });
        return result as boolean;
    }

    /**
     * Join a peer to the channel and wait for handshake completion
     * Encapsulates both connection and handshake verification
     */
    async joinPeerToChannel(
        newPeerIndex: number,
        observingPeerIndex: number
    ): Promise<void> {
        // step 1 - tryOpenConnectionToChannel routes through the network
        // sub-handle (W1 appendix A bucket ii). live P2PManager.self stays
        // inline-side; LocalDiscoveryServer is orchestrator-driven.
        const newPeer = this.harness.getPeer(newPeerIndex);
        const handle = this.harness.getPeerHandle(newPeerIndex);
        await handle.network.tryOpenConnectionToChannel(
            this.harness.channelId!.toString()
        );
        // step 2 - orchestrator-side dial. worker mode already dialed inside
        // p2pSetup (entry.ts runP2pSetup) and newPeer.stateManager.p2pManager
        // is undefined orchestrator-side -> skip when handle is worker.
        // mirrors NetworkController.connectPeers.
        if (!handle.__workerBackend) {
            await LocalDiscoveryServer.connectToPeers(
                newPeer.stateManager.p2pManager.self,
                this.harness.channelId!,
                newPeer.address
            );
        }
        await this.waitForHandshakeCompleted(
            observingPeerIndex,
            newPeer.address
        );
    }

    async requestDisputeAcknowledgment(options: {
        peerIndex: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { peerIndex, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }
        const handle = this.harness.getPeerHandle(peerIndex);
        await handle.queryInternals.isForkDisputedService({
            op: "requestDisputeAcknowledgment",
            args: [this.harness.channelId!, activeForkId]
        });
    }

    async sendFakeDisputeRequest(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromAddr = this.harness.getPeerHandle(fromPeer).address;
        await toHandle.queryInternals.callServiceWithTransport({
            serviceName: "isForkDisputedService",
            methodName: "onDisputeAcknowledgmentRequest",
            otherAddr: fromAddr,
            args: [this.harness.channelId!, fakeForkId]
        });
    }

    async simulateBuildOnDisputedFork(options: {
        buildingPeer: number;
        observingPeer: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { buildingPeer, observingPeer, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        // step 1 - read latest block via the data-path query (PeerHandle bucket-(i)).
        // inline mode returns the live Block instance; in-process equivalence.
        const buildingPeerHandle = this.harness.getPeerHandle(buildingPeer);
        const observingPeerObj = this.harness.getPeer(observingPeer);

        const transport = await this.harness.query.waitForPeerTransport(
            observingPeer,
            buildingPeer,
            5000
        );

        const buildingLatestBlock = (await buildingPeerHandle.queryLatestBlock(
            activeForkId
        )) as import("@/models/Block").default | undefined;

        if (!buildingLatestBlock) {
            throw new Error(`No latest block found for fork ${activeForkId}`);
        }

        const buildingPeerAddress =
            transport.peerAddress ?? buildingPeerHandle.address.toString();

        await observingPeerObj.stateManager.blockValidationStrategy.blockForkIsDisputed(
            buildingLatestBlock,
            buildingPeerAddress
        );
    }

    async connectPeers(peerIndices: number[]): Promise<void> {
        await this.harness.network.connectPeers(peerIndices);
    }

    async newPeerJoins(options: {
        newPeerIndex: number;
        observingPeerIndex: number;
    }): Promise<void> {
        await this.joinPeerToChannel(
            options.newPeerIndex,
            options.observingPeerIndex
        );
    }

    async sendInvalidTimeHandshakeRequest(options: {
        fromPeer: number;
        toPeer: number;
        timeOffset: number;
    }): Promise<void> {
        const { fromPeer, toPeer, timeOffset } = options;
        // step 1 - route createRPCMethods(transport).onInitHandshakeRequest
        // through the receiving peer -> in-thread transport resolution
        // (worker-safe). orchestrator only ships scalars.
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromAddr = this.harness.getPeerHandle(fromPeer).address;
        const agreementTime =
            this.harness.options.timeConfig?.agreementTime ?? 0;
        const invalidTime =
            Clock.getTimeInSeconds() + agreementTime + timeOffset;
        await toHandle.queryInternals.callServiceWithTransport({
            serviceName: "initHandshakeService",
            methodName: "onInitHandshakeRequest",
            otherAddr: fromAddr,
            args: [fakeHash(), invalidTime]
        });
    }

    async initiateHandshake(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        // step 1 - run initHandshake(transport) in-thread for `fromPeer`.
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const toAddr = this.harness.getPeerHandle(toPeer).address;
        await fromHandle.queryInternals.callServiceMethodWithTransport({
            serviceName: "initHandshakeService",
            methodName: "initHandshake",
            otherAddr: toAddr,
            args: []
        });
    }

    async sendSlowHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
        delaySeconds: number;
    }): Promise<void> {
        const { fromPeer, toPeer, delaySeconds } = options;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const fromAddr = fromHandle.address;

        // step 1 - lookup the challenge `toPeer` set when it initiated handshake.
        const challenge =
            await toHandle.queryInternals.getInitChallenge(fromAddr);
        if (!challenge)
            throw new Error("No challenge found - initiate handshake first");

        const agreementTime =
            this.harness.options.timeConfig?.agreementTime ?? 0;
        const slowResponseTime =
            challenge.initTime + agreementTime + delaySeconds;
        // step 2 - sign the challenge with the orchestrator-side fromPeer signer
        // (signer is already on the handle per D-15).
        const signature = await fromHandle.signer.signMessage(
            ethers.getBytes(challenge.randomChallengeHash)
        );
        const fromPreferred =
            await fromHandle.queryInternals.getPreferredTransportType();

        // step 3 - call onInitHandshakeResponse via the rpc-methods chain on
        // `toPeer` (the receiving side) with the live transport to fromPeer.
        await toHandle.queryInternals.callServiceWithTransport({
            serviceName: "initHandshakeService",
            methodName: "onInitHandshakeResponse",
            otherAddr: fromAddr,
            args: [signature, slowResponseTime, fromPreferred]
        });
    }

    async sendUnsolicitedHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const fromAddr = fromHandle.address;

        // step 1 - guard: no challenge expected for "unsolicited" semantics.
        const challenge =
            await toHandle.queryInternals.getInitChallenge(fromAddr);
        if (challenge)
            throw new Error(
                "Challenge already exists - this wouldn't be unsolicited"
            );

        const signature = await fromHandle.signer.signMessage(
            ethers.getBytes(fakeHash())
        );
        const fromPreferred =
            await fromHandle.queryInternals.getPreferredTransportType();
        await toHandle.queryInternals.callServiceWithTransport({
            serviceName: "initHandshakeService",
            methodName: "onInitHandshakeResponse",
            otherAddr: fromAddr,
            args: [signature, Clock.getTimeInSeconds(), fromPreferred]
        });
    }

    async clearHandshakeChallenge(options: {
        peerIndex: number;
        targetPeer: number;
    }): Promise<void> {
        const { peerIndex, targetPeer } = options;
        const handle = this.harness.getPeerHandle(peerIndex);
        const targetAddr = this.harness.getPeerHandle(targetPeer).address;
        await handle.queryInternals.clearInitChallenge(targetAddr);
    }

    async sendValidHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const toHandle = this.harness.getPeerHandle(toPeer);
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const fromAddr = fromHandle.address;

        const challenge =
            await toHandle.queryInternals.getInitChallenge(fromAddr);
        if (!challenge)
            throw new Error("No challenge found - initiate handshake first");

        const signature = await fromHandle.signer.signMessage(
            ethers.getBytes(challenge.randomChallengeHash)
        );
        const fromPreferred =
            await fromHandle.queryInternals.getPreferredTransportType();
        await toHandle.queryInternals.callServiceWithTransport({
            serviceName: "initHandshakeService",
            methodName: "onInitHandshakeResponse",
            otherAddr: fromAddr,
            args: [signature, Clock.getTimeInSeconds(), fromPreferred]
        });
    }

    async initiateHandshakeWithoutResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        // step 1 - same as initiateHandshake; named separately to document
        // the test's expectation (response will time out).
        const fromHandle = this.harness.getPeerHandle(fromPeer);
        const toAddr = this.harness.getPeerHandle(toPeer).address;
        await fromHandle.queryInternals.callServiceMethodWithTransport({
            serviceName: "initHandshakeService",
            methodName: "initHandshake",
            otherAddr: toAddr,
            args: []
        });
    }

    async sendDuplicateAcknowledgmentResponse(options: {
        respondingPeer: number;
        requestingPeer: number;
        forkId?: ForkId;
    }): Promise<void> {
        const { respondingPeer, requestingPeer, forkId } = options;
        const activeForkId = forkId ?? this.harness.activeForkId;
        if (!activeForkId) {
            throw new Error("No active fork ID");
        }

        const requestingPeerHandle = this.harness.getPeerHandle(requestingPeer);
        const respondingHandle = this.harness.getPeerHandle(respondingPeer);
        await respondingHandle.queryInternals.isForkDisputedService({
            op: "respondToDisputeAcknowledgment",
            args: [
                requestingPeerHandle.address.toString(),
                this.harness.channelId!,
                activeForkId
            ]
        });
    }

    async requestFakeDisputeWithSpiedDisconnect(options: {
        requestingPeer: number;
    }): Promise<void> {
        // step 1 - install an inline filter on every other peer; filter drops
        // disconnects targeting the requester so the test can observe the
        // no-ack timeout path. closure runs orchestrator-side either backend.
        const { requestingPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const requestingPeerHandle = this.harness.getPeerHandle(requestingPeer);
        const skipAddress = requestingPeerHandle.address;

        for (let i = 0; i < this.harness.peers.length; i++) {
            if (i === requestingPeer) continue;
            const peer = this.harness.getPeerHandle(i);
            // step 1 - return false -> drop; true -> delegate to original.
            await peer.network.installDisconnectFilter(
                (addr) => addr !== skipAddress
            );
        }

        // step 2 - dispatch through queryInternals -> in worker mode this rpc
        // forwards to the in-thread service; inline runs the body locally.
        // args is an array -> dispatcher spreads positionally.
        await requestingPeerHandle.queryInternals.isForkDisputedService({
            op: "requestDisputeAcknowledgment",
            args: [this.harness.channelId!, fakeForkId]
        });
    }
}
