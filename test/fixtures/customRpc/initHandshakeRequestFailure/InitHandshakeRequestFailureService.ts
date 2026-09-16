// @spec-test-coverage-ignore: worker-side support service for mapped InitHandshake request-failure cases
import type { PingPongRpc } from "../PingPongRpcManifest";
import { InitHandshakeRequestFailureRpcMethods } from "./InitHandshakeRequestFailureRpcMethods";
import type P2PManager from "@/P2PManager";
import type PeerProfile from "@/PeerProfile";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type Rpc from "@/rpc/Rpc";
import { HolepunchTransport } from "@/transport";
import type NetworkTransport from "@/transport/NetworkTransport";
import {
    RecordingBannablePeerInfo,
    RecordingHolepunchSocket
} from "@test/fixtures/P2PTransportFixture";
import { waitFor } from "@test/utils/waitFor";
import { ethers } from "ethers";

/**
 * A Holepunch peer driven by the probe: its socket is the whole wire. The
 * profile is captured at connect time because a disconnect unregisters the
 * transport, and its blacklist flag is what the caller asserts on.
 */
type ProbePeer = {
    transport: HolepunchTransport;
    socket: RecordingHolepunchSocket;
    peerInfo: RecordingBannablePeerInfo;
    profile: PeerProfile;
    wallet: ethers.HDNodeWallet;
};

export type HandshakeRequestFailureProbe = {
    socketDestroyed: boolean;
    banCalls: boolean[];
    identityBlacklisted: boolean;
    profileBlacklisted: boolean;
    connectionRemoved: boolean;
};

export class InitHandshakeRequestFailureService extends ANetworkRpcService<
    InitHandshakeRequestFailureRpcMethods,
    P2PManager<PingPongRpc>
> {
    /**
     * The catch runs on the rejection's own microtask chain, so this window
     * only has to outlast that: it is the budget for observing that no close
     * follows, not a protocol wait.
     */
    private static readonly CLOSE_ABSENCE_WINDOW_MS = 500;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "InitHandshakeRequestFailureService"
            })
        );
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): InitHandshakeRequestFailureRpcMethods {
        return new InitHandshakeRequestFailureRpcMethods(transport, this);
    }

    /** The request leg times out: nothing answers the challenge at all. */
    public async probeRequestTimeout(): Promise<HandshakeRequestFailureProbe> {
        const peer = this.connectProbePeer();
        try {
            await this.waitForChallenge(peer);
            await this.waitForClose(peer, this.challengeWaitMs() + 5000);
            return this.result(peer);
        } finally {
            this.p2pManager.disconnectConnection(peer.transport);
        }
    }

    /** The peer answers the challenge with an error response of its own. */
    public async probeRemoteError(): Promise<HandshakeRequestFailureProbe> {
        const peer = this.connectProbePeer();
        try {
            const request = await this.waitForChallenge(peer);
            peer.socket.emit(
                "data",
                JSON.stringify({
                    rpcResponse: true,
                    requestId: request.requestId,
                    ok: false,
                    error: "request time outside agreement window"
                })
            );
            await this.waitForClose(peer, this.challengeWaitMs() + 5000);
            return this.result(peer);
        } finally {
            this.p2pManager.disconnectConnection(peer.transport);
        }
    }

    /**
     * The connection is already gone when the request settles. There is no
     * transport left to close, so the handshake must not close one.
     */
    public async probeTransportClosedDuringRequest(): Promise<HandshakeRequestFailureProbe> {
        const peer = this.connectProbePeer();
        try {
            await this.waitForChallenge(peer);
            this.p2pManager.rpcRouter.rejectPendingRpcRequestsForTransport(
                peer.transport,
                new Error("Peer disconnected before RPC response arrived")
            );
            await this.waitForClose(
                peer,
                InitHandshakeRequestFailureService.CLOSE_ABSENCE_WINDOW_MS
            );
            return this.result(peer);
        } finally {
            this.p2pManager.disconnectConnection(peer.transport);
        }
    }

    /**
     * A real Holepunch transport over a recording socket. Its constructor
     * starts the handshake, so the challenge is already on the wire.
     */
    private connectProbePeer(): ProbePeer {
        const peerInfo = new RecordingBannablePeerInfo();
        const socket = new RecordingHolepunchSocket();
        const transport = new HolepunchTransport(
            socket,
            peerInfo,
            this.p2pManager.rpcRouter
        );
        this.p2pManager.addConnection(transport);
        return {
            transport,
            socket,
            peerInfo,
            profile:
                this.p2pManager.profileManager.registerTransport(transport),
            wallet: ethers.Wallet.createRandom()
        };
    }

    /** The challenge frame this node put on the wire for `peer`. */
    private async waitForChallenge(peer: ProbePeer): Promise<Rpc> {
        let request: Rpc | undefined;
        await waitFor(
            () => {
                request = peer.socket.writes
                    .map((frame) => JSON.parse(frame) as Rpc)
                    .find(
                        (frame) =>
                            frame.method === "onInitHandshakeRequest" &&
                            frame.requestId !== undefined
                    );
                return request !== undefined;
            },
            this.challengeWaitMs(),
            10
        );
        if (!request) throw new Error("No handshake challenge was sent");
        return request;
    }

    /**
     * Wait for the disconnect the probed path is expected to perform. A peer
     * that is never closed is a result the caller asserts on, not an error, so
     * the expired budget returns the observed state instead of throwing.
     */
    private async waitForClose(
        peer: ProbePeer,
        budgetMs: number
    ): Promise<void> {
        await waitFor(() => peer.socket.destroyed, budgetMs, 20).catch(
            () => undefined
        );
    }

    private result(peer: ProbePeer): HandshakeRequestFailureProbe {
        return {
            socketDestroyed: peer.socket.destroyed,
            banCalls: [...peer.peerInfo.banCalls],
            identityBlacklisted: this.p2pManager.isBlacklisted(
                peer.wallet.address
            ),
            profileBlacklisted: peer.profile.isBlackListed,
            connectionRemoved: !this.p2pManager.openConnections.includes(
                peer.transport
            )
        };
    }

    private challengeWaitMs(): number {
        return this.p2pManager.stateManager.timeConfig.agreementTime * 1000;
    }
}

export default InitHandshakeRequestFailureService;
