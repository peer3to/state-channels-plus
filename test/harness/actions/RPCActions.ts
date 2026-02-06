import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { ForkId, Address } from "@/types/types";
import IsForkDisputedService from "@/rpc/services/isForkDisputedService/IsForkDisputedService";
import InitHandshakeService from "@/rpc/services/initHandshake/InitHandshakeService";

/**
 * Actions for RPC service testing
 * Provides access to RPC services and helper methods for test blocks
 */
export class RPCActions {
    constructor(
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Get IsForkDisputed RPC service for a peer
     */
    getIsForkDisputedService(peerIndex: number): IsForkDisputedService {
        return this.harness.getPeer(peerIndex).stateManager.p2pManager.localRpc
            .isForkDisputedService;
    }

    /**
     * Get InitHandshake RPC service for a peer
     */
    getInitHandshakeService(peerIndex: number): InitHandshakeService {
        return this.harness.getPeer(peerIndex).stateManager.p2pManager.localRpc
            .initHandshakeService;
    }

    /**
     * Check if handshake is completed between two peers
     */
    isHandshakeCompleted(
        peerIndex: number,
        otherPeerAddress: Address
    ): boolean {
        const profile = this.harness.stateQuery.getProfile(
            peerIndex,
            otherPeerAddress
        );
        return profile?.getIsHandshakeCompleted() ?? false;
    }

    /**
     * Wait for handshake to complete using connection barrier (event-driven)
     */
    async waitForHandshakeCompleted(
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
}
