import { HarnessBlock } from "./HarnessBlock";
import { ForkId } from "@/types/types";
import { hash as fakeHash } from "@test/factory";
import Clock from "@/Clock";
import { ethers } from "ethers";

/**
 * RPC namespace - Simple, single-responsibility blocks for RPC service testing
 *
 * Rules:
 * - NO complex scenarios or multi-step logic
 * - NO hidden assertions (tests must assert explicitly)
 * - Use connectionBarrier for event-driven waiting (NO waitForCondition)
 */
export class RPC {
    // ==========================================
    // IsForkDisputed RPC - Basic Operations
    // ==========================================

    /**
     * Request dispute acknowledgment from connected peers
     */
    static requestDisputeAcknowledgment(options: {
        peerIndex: number;
        forkId?: ForkId;
    }) {
        const { peerIndex, forkId } = options;

        return new HarnessBlock(async (harness) => {
            const activeForkId = forkId ?? harness.activeForkId;
            if (!activeForkId) {
                throw new Error("No active fork ID");
            }

            const service =
                harness.rpcActions.getIsForkDisputedService(peerIndex);
            await service.requestDisputeAcknowledgment(
                harness.channelId!,
                activeForkId
            );

            return harness;
        });
    }

    /**
     * Send fake dispute request for non-disputed fork (fraud attempt)
     */
    static sendFakeDisputeRequest(options: {
        fromPeer: number;
        toPeer: number;
    }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const fakeForkId = fakeHash() as ForkId;
            const transport = await harness.stateQuery.waitForPeerTransport(
                toPeer,
                fromPeer,
                5000
            );

            const receivingService =
                harness.rpcActions.getIsForkDisputedService(toPeer);
            await receivingService
                .createRPCMethods(transport)
                .onDisputeAcknowledgmentRequest(harness.channelId!, fakeForkId);

            return harness;
        });
    }

    /**
     * Simulate peer building on acknowledged disputed fork
     * Triggers block validation which should cause disconnection
     */
    static simulateBuildOnDisputedFork(options: {
        buildingPeer: number;
        observingPeer: number;
        forkId?: ForkId;
    }) {
        const { buildingPeer, observingPeer, forkId } = options;

        return new HarnessBlock(async (harness) => {
            const activeForkId = forkId ?? harness.activeForkId;
            if (!activeForkId) {
                throw new Error("No active fork ID");
            }

            const buildingPeerObj = harness.getPeer(buildingPeer);
            const observingPeerObj = harness.getPeer(observingPeer);

            const transport = await harness.stateQuery.waitForPeerTransport(
                observingPeer,
                buildingPeer,
                5000
            );

            const buildingLatestBlock =
                buildingPeerObj.stateManager.storage.blocks.getLatestBlock(
                    activeForkId
                );

            if (!buildingLatestBlock) {
                throw new Error(
                    `No latest block found for fork ${activeForkId}`
                );
            }

            const buildingPeerAddress =
                transport.peerAddress ?? buildingPeerObj.address;

            // Trigger block validation on disputed fork
            await observingPeerObj.stateManager.blockValidationStrategy.blockForkIsDisputed(
                buildingLatestBlock,
                buildingPeerAddress
            );

            return harness;
        });
    }

    // ==========================================
    // InitHandshake RPC - Basic Operations
    // ==========================================

    /**
     * Connect peers using network controller
     */
    static connectPeers(peerIndices: number[]) {
        return new HarnessBlock(async (harness) => {
            await harness.networkController.connectPeers(peerIndices);
            return harness;
        });
    }

    /**
     * New peer joins channel and waits for handshake to complete
     * Uses connectionBarrier for event-driven waiting
     */
    static newPeerJoins(options: {
        newPeerIndex: number;
        observingPeerIndex: number;
    }) {
        const { newPeerIndex, observingPeerIndex } = options;

        return new HarnessBlock(async (harness) => {
            await harness.rpcActions.joinPeerToChannel(
                newPeerIndex,
                observingPeerIndex
            );
            return harness;
        });
    }

    /**
     * Send handshake request with invalid timestamp
     */
    static sendInvalidTimeHandshakeRequest(options: {
        fromPeer: number;
        toPeer: number;
        timeOffset: number;
    }) {
        const { fromPeer, toPeer, timeOffset } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                toPeer,
                fromPeer,
                5000
            );

            const receivingService =
                harness.rpcActions.getInitHandshakeService(toPeer);
            const agreementTime =
                harness.peers[toPeer].stateManager.timeConfig.agreementTime;
            const invalidTime =
                Clock.getTimeInSeconds() + agreementTime + timeOffset;

            await receivingService
                .createRPCMethods(transport)
                .onInitHandshakeRequest(fakeHash(), invalidTime);

            return harness;
        });
    }

    /**
     * Initiate handshake from one peer to another
     */
    static initiateHandshake(options: { fromPeer: number; toPeer: number }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                fromPeer,
                toPeer,
                5000
            );

            const service =
                harness.rpcActions.getInitHandshakeService(fromPeer);
            service.initHandshake(transport);

            return harness;
        });
    }

    /**
     * Send handshake response with slow RTT (exceeds agreementTime)
     */
    static sendSlowHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
        delaySeconds: number;
    }) {
        const { fromPeer, toPeer, delaySeconds } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                toPeer,
                fromPeer,
                5000
            );

            const initiatingService =
                harness.rpcActions.getInitHandshakeService(toPeer);
            const challenge = initiatingService.getChallenge(transport);

            if (!challenge) {
                throw new Error(
                    "No challenge found - initiate handshake first"
                );
            }

            const fromPeerObj = harness.getPeer(fromPeer);
            const agreementTime =
                harness.peers[toPeer].stateManager.timeConfig.agreementTime;
            const slowResponseTime =
                challenge.initTime + agreementTime + delaySeconds;

            const signature =
                await fromPeerObj.stateManager.p2pManager.p2pSigner.signMessage(
                    challenge.randomChallengeHash
                );

            const rpcHandler = initiatingService.createRPCMethods(transport);
            await rpcHandler.onInitHandshakeResponse(
                signature,
                slowResponseTime,
                fromPeerObj.stateManager.p2pManager.preferredTransport
            );

            return harness;
        });
    }

    /**
     * Send handshake response with invalid signature
     */
    static sendInvalidSignatureHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                toPeer,
                fromPeer,
                5000
            );

            const fromPeerObj = harness.getPeer(fromPeer);
            const initiatingService =
                harness.rpcActions.getInitHandshakeService(toPeer);

            // Create invalid signature (sign wrong message)
            const wrongMessage = ethers.randomBytes(32);
            const invalidSignature =
                await fromPeerObj.signer.signMessage(wrongMessage);

            const rpcHandler = initiatingService.createRPCMethods(transport);
            await rpcHandler.onInitHandshakeResponse(
                invalidSignature,
                Clock.getTimeInSeconds(),
                fromPeerObj.stateManager.p2pManager.preferredTransport
            );

            return harness;
        });
    }

    /**
     * Send unsolicited handshake response (no prior request)
     */
    static sendUnsolicitedHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                toPeer,
                fromPeer,
                5000
            );

            const fromPeerObj = harness.getPeer(fromPeer);
            const initiatingService =
                harness.rpcActions.getInitHandshakeService(toPeer);

            // Verify no challenge exists (unsolicited)
            const challenge = initiatingService.getChallenge(transport);
            if (challenge) {
                throw new Error(
                    "Challenge already exists - this wouldn't be unsolicited"
                );
            }

            // Send response anyway (should trigger disconnection)
            const signature =
                await fromPeerObj.stateManager.p2pManager.p2pSigner.signMessage(
                    fakeHash()
                );

            const rpcHandler = initiatingService.createRPCMethods(transport);
            await rpcHandler.onInitHandshakeResponse(
                signature,
                Clock.getTimeInSeconds(),
                fromPeerObj.stateManager.p2pManager.preferredTransport
            );

            return harness;
        });
    }

    /**
     * Clear handshake challenge for a peer connection
     */
    static clearHandshakeChallenge(options: {
        peerIndex: number;
        targetPeer: number;
    }) {
        const { peerIndex, targetPeer } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                peerIndex,
                targetPeer,
                5000
            );

            const service =
                harness.rpcActions.getInitHandshakeService(peerIndex);
            service.mapTransportToChallenge.delete(transport);

            return harness;
        });
    }

    /**
     * Blacklist a peer
     */
    static blacklistPeer(options: {
        ownerPeer: number;
        blacklistedPeer: number;
    }) {
        const { ownerPeer, blacklistedPeer } = options;

        return new HarnessBlock(async (harness) => {
            const blacklistedPeerObj = harness.getPeer(blacklistedPeer);
            const ownerPeerObj = harness.getPeer(ownerPeer);

            const profile = harness.stateQuery.getProfile(
                ownerPeer,
                blacklistedPeerObj.address
            );

            if (profile) {
                profile.blacklist();
            } else {
                // If no profile exists, add to blacklist directly
                ownerPeerObj.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    blacklistedPeerObj.address
                );
            }

            return harness;
        });
    }

    /**
     * Send valid handshake response
     */
    static sendValidHandshakeResponse(options: {
        fromPeer: number;
        toPeer: number;
    }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                toPeer,
                fromPeer,
                5000
            );
            const initService =
                harness.rpcActions.getInitHandshakeService(toPeer);
            const challenge = initService.getChallenge(transport);

            if (!challenge) {
                throw new Error(
                    "No challenge found - initiate handshake first"
                );
            }

            const respondingPeer = harness.getPeer(fromPeer);
            const signature =
                await respondingPeer.stateManager.p2pManager.p2pSigner.signMessage(
                    challenge.randomChallengeHash
                );

            await initService
                .createRPCMethods(transport)
                .onInitHandshakeResponse(
                    signature,
                    Clock.getTimeInSeconds(),
                    respondingPeer.stateManager.p2pManager.preferredTransport
                );

            return harness;
        });
    }

    /**
     * Initiate handshake without response (tests timeout mechanism)
     * Does NOT disconnect - just initiates and leaves hanging
     */
    static initiateHandshakeWithoutResponse(options: {
        fromPeer: number;
        toPeer: number;
    }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const transport = await harness.stateQuery.waitForPeerTransport(
                fromPeer,
                toPeer,
                5000
            );
            const initService =
                harness.rpcActions.getInitHandshakeService(fromPeer);

            // Just initiate without response - tests timeout behavior
            initService.initHandshake(transport);

            return harness;
        });
    }

    /**
     * Initiate handshake then disconnect responding peer to prevent response
     * Used to test timeout behavior
     */
    static initiateHandshakeThenPreventResponse(options: {
        fromPeer: number;
        toPeer: number;
    }) {
        const { fromPeer, toPeer } = options;

        return new HarnessBlock(async (harness) => {
            const respondingPeer = harness.getPeer(toPeer);
            const transport = await harness.stateQuery.waitForPeerTransport(
                fromPeer,
                toPeer,
                5000
            );

            // Initiate handshake
            const initService =
                harness.rpcActions.getInitHandshakeService(fromPeer);
            initService.initHandshake(transport);

            // Disconnect on responding peer side to prevent response
            respondingPeer.stateManager.p2pManager.disconnectConnection(
                transport
            );

            return harness;
        });
    }

    /**
     * Send duplicate acknowledgment response (should trigger disconnection)
     */
    static sendDuplicateAcknowledgmentResponse(options: {
        respondingPeer: number;
        requestingPeer: number;
        forkId?: ForkId;
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

            await service.respondToDisputeAcknowledgment(
                requestingPeerObj.address,
                harness.channelId!,
                activeForkId
            );

            return harness;
        });
    }

    /**
     * Request acknowledgment for a fake/non-disputed fork
     * Prevents peers from disconnecting the requester (for timeout testing)
     */
    static requestFakeDisputeWithSpiedDisconnect(options: {
        requestingPeer: number;
    }) {
        const { requestingPeer } = options;

        return new HarnessBlock(async (harness) => {
            const fakeForkId = fakeHash() as ForkId;
            const requestingPeerObj = harness.getPeer(requestingPeer);
            const service =
                harness.rpcActions.getIsForkDisputedService(requestingPeer);

            // Spy to prevent peers from disconnecting the requester
            // We want to test timeout behavior, not invalid request behavior
            for (let i = 0; i < harness.peers.length; i++) {
                if (i === requestingPeer) continue;

                const peer = harness.getPeer(i);
                const originalDisconnect =
                    peer.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress.bind(
                        peer.stateManager.p2pManager
                    );

                peer.stateManager.p2pManager.disconnectAndBlacklistPeerByEvmAddress =
                    (addr) => {
                        if (addr === requestingPeerObj.address) {
                            return; // Prevent disconnect of requester
                        }
                        return originalDisconnect(addr);
                    };
            }

            service.requestDisputeAcknowledgment(
                harness.channelId!,
                fakeForkId
            );

            return harness;
        });
    }
}
