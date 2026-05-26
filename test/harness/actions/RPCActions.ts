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

import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { LocalDiscoveryServer, Logger } from "@/utils";
import { ForkId, Address } from "@/types/types";
import IsForkDisputedService from "@/rpc/services/isForkDisputedService/IsForkDisputedService";
import InitHandshakeService from "@/rpc/services/initHandshake/InitHandshakeService";
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
     * Get IsForkDisputed RPC service for a peer
     */
    getIsForkDisputedService(peerIndex: number): IsForkDisputedService {
        return this.getInlineRecord(peerIndex).stateManager.p2pManager.localRpc
            .isForkDisputedService;
    }

    /**
     * Get InitHandshake RPC service for a peer
     */
    getInitHandshakeService(peerIndex: number): InitHandshakeService {
        return this.getInlineRecord(peerIndex).stateManager.p2pManager.localRpc
            .initHandshakeService;
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
    didPeerAcknowledgeDisputedFork(
        requestingPeerIndex: number,
        respondingPeerAddress: Address,
        forkId: ForkId
    ): boolean {
        const service = this.getIsForkDisputedService(requestingPeerIndex);
        return service.didPeerAcknowledgeDisputedFork(
            respondingPeerAddress.toString(),
            forkId
        );
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
        const isWorker =
            (handle as unknown as { __workerBackend?: boolean })
                .__workerBackend === true;
        if (!isWorker) {
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

        const service = this.getIsForkDisputedService(peerIndex);
        await service.requestDisputeAcknowledgment(
            this.harness.channelId!,
            activeForkId
        );
    }

    async sendFakeDisputeRequest(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const transport = await this.harness.query.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const receivingService = this.getIsForkDisputedService(toPeer);
        await receivingService
            .createRPCMethods(transport)
            .onDisputeAcknowledgmentRequest(
                this.harness.channelId!,
                fakeForkId
            );
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
        const transport = await this.harness.query.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const receivingService = this.getInitHandshakeService(toPeer);
        const agreementTime =
            this.harness.peers[toPeer].stateManager.timeConfig.agreementTime;
        const invalidTime =
            Clock.getTimeInSeconds() + agreementTime + timeOffset;

        await receivingService
            .createRPCMethods(transport)
            .onInitHandshakeRequest(fakeHash(), invalidTime);
    }

    async initiateHandshake(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.query.waitForPeerTransport(
            fromPeer,
            toPeer,
            5000
        );

        const service = this.getInitHandshakeService(fromPeer);
        service.initHandshake(transport);
    }

    async sendSlowHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
        delaySeconds: number;
    }): Promise<void> {
        const { fromPeer, toPeer, delaySeconds } = options;
        const transport = await this.harness.query.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const initiatingService = this.getInitHandshakeService(toPeer);
        const challenge = initiatingService.getChallenge(transport);

        if (!challenge) {
            throw new Error("No challenge found - initiate handshake first");
        }

        const fromPeerRecord = this.getInlineRecord(fromPeer);
        const agreementTime =
            this.harness.peers[toPeer].stateManager.timeConfig.agreementTime;
        const slowResponseTime =
            challenge.initTime + agreementTime + delaySeconds;

        const signature =
            await fromPeerRecord.stateManager.p2pManager.p2pSigner.signMessage(
                challenge.randomChallengeHash
            );

        const rpcHandler = initiatingService.createRPCMethods(transport);
        await rpcHandler.onInitHandshakeResponse(
            signature,
            slowResponseTime,
            fromPeerRecord.stateManager.p2pManager.preferredTransport
        );
    }

    async sendUnsolicitedHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.query.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const fromPeerRecord = this.getInlineRecord(fromPeer);
        const initiatingService = this.getInitHandshakeService(toPeer);
        const challenge = initiatingService.getChallenge(transport);
        if (challenge) {
            throw new Error(
                "Challenge already exists - this wouldn't be unsolicited"
            );
        }

        const signature =
            await fromPeerRecord.stateManager.p2pManager.p2pSigner.signMessage(
                fakeHash()
            );

        const rpcHandler = initiatingService.createRPCMethods(transport);
        await rpcHandler.onInitHandshakeResponse(
            signature,
            Clock.getTimeInSeconds(),
            fromPeerRecord.stateManager.p2pManager.preferredTransport
        );
    }

    async clearHandshakeChallenge(options: {
        peerIndex: number;
        targetPeer: number;
    }): Promise<void> {
        const { peerIndex, targetPeer } = options;
        const transport = await this.harness.query.waitForPeerTransport(
            peerIndex,
            targetPeer,
            5000
        );

        const service = this.getInitHandshakeService(peerIndex);
        service.mapTransportToChallenge.delete(transport);
    }

    async sendValidHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.query.waitForPeerTransport(
            toPeer,
            fromPeer,
            5000
        );

        const initService = this.getInitHandshakeService(toPeer);
        const challenge = initService.getChallenge(transport);

        if (!challenge) {
            throw new Error("No challenge found - initiate handshake first");
        }

        const respondingPeerRecord = this.getInlineRecord(fromPeer);
        const signature =
            await respondingPeerRecord.stateManager.p2pManager.p2pSigner.signMessage(
                challenge.randomChallengeHash
            );

        await initService
            .createRPCMethods(transport)
            .onInitHandshakeResponse(
                signature,
                Clock.getTimeInSeconds(),
                respondingPeerRecord.stateManager.p2pManager.preferredTransport
            );
    }

    async initiateHandshakeWithoutResponse(options: {
        fromPeer: number;
        toPeer: number;
    }): Promise<void> {
        const { fromPeer, toPeer } = options;
        const transport = await this.harness.query.waitForPeerTransport(
            fromPeer,
            toPeer,
            5000
        );

        const initService = this.getInitHandshakeService(fromPeer);
        initService.initHandshake(transport);
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
        const service = this.getIsForkDisputedService(respondingPeer);

        await service.respondToDisputeAcknowledgment(
            requestingPeerHandle.address.toString(),
            this.harness.channelId!,
            activeForkId
        );
    }

    async requestFakeDisputeWithSpiedDisconnect(options: {
        requestingPeer: number;
    }): Promise<void> {
        // step 1 - install the named "network.dropSpecificAddress" filter on
        // every other peer; filter drops disconnects targeting the requester
        // so the test can observe the no-ack timeout path. handler body lives
        // in test/harness/worker-handlers/index.ts.
        const { requestingPeer } = options;
        const fakeForkId = fakeHash() as ForkId;
        const requestingPeerHandle = this.harness.getPeerHandle(requestingPeer);
        const service = this.getIsForkDisputedService(requestingPeer);

        for (let i = 0; i < this.harness.peers.length; i++) {
            if (i === requestingPeer) continue;
            const peer = this.harness.getPeerHandle(i);
            await peer.network.installDisconnectFilter({
                filterId: "network.dropSpecificAddress",
                args: { skipAddress: requestingPeerHandle.address }
            });
        }

        service.requestDisputeAcknowledgment(
            this.harness.channelId!,
            fakeForkId
        );
    }
}
