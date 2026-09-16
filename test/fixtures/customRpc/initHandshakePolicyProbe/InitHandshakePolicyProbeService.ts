// @spec-test-coverage-ignore: worker-side support service for mapped InitHandshake suspension cases
import type { PingPongRpc } from "../PingPongRpcManifest";
import { InitHandshakePolicyProbeRpcMethods } from "./InitHandshakePolicyProbeRpcMethods";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import type PeerProfile from "@/PeerProfile";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import InitHandshakeService from "@/rpc/network/services/initHandshake/InitHandshakeService";
import type Rpc from "@/rpc/Rpc";
import { HolepunchTransport } from "@/transport";
import type NetworkTransport from "@/transport/NetworkTransport";
import { TransportType } from "@/transport/TransportType";
import {
    RecordingBannablePeerInfo,
    RecordingHolepunchSocket
} from "@test/fixtures/P2PTransportFixture";
import { waitFor } from "@test/utils/waitFor";
import { ethers } from "ethers";

/**
 * A Holepunch peer driven by the probe: its socket is the whole wire. The
 * profile is captured at connect time because a disconnect unregisters the
 * transport, and its suspension flag is exactly what the caller asserts on.
 */
type ProbePeer = {
    transport: HolepunchTransport;
    socket: RecordingHolepunchSocket;
    peerInfo: RecordingBannablePeerInfo;
    profile: PeerProfile;
    wallet: ethers.HDNodeWallet;
};

export type RefusalOrderingProbe = {
    refusalFrameIndex: number;
    writesAtDestroy: number | undefined;
    socketDestroyed: boolean;
    banCalls: boolean[];
    profileBlacklisted: boolean;
    profileSuspended: boolean;
};

export type HandshakeSuspensionProbe = {
    socketDestroyed: boolean;
    banCalls: boolean[];
    identityBlacklisted: boolean;
    profileBlacklisted: boolean;
    profileSuspended: boolean;
    connectionRemoved: boolean;
};

export class InitHandshakePolicyProbeService extends ANetworkRpcService<
    InitHandshakePolicyProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "InitHandshakePolicyProbeService"
            })
        );
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): InitHandshakePolicyProbeRpcMethods {
        return new InitHandshakePolicyProbeRpcMethods(transport, this);
    }

    /**
     * The handshake ack never arrives after we verified the responder. The
     * timeout is a load/clock symptom, so the transport closes and the peer is
     * suspended rather than blacklisted.
     */
    public async probeAckTimeoutAfterVerifiedAddress(): Promise<HandshakeSuspensionProbe> {
        const peer = this.connectProbePeer();
        await this.answerHandshakeChallenge(peer);
        await this.waitForClose(peer);
        return this.result(peer);
    }

    /** The request leg times out: nothing answers the challenge at all. */
    public async probeRequestTimeout(): Promise<HandshakeSuspensionProbe> {
        const peer = this.connectProbePeer();
        await this.waitForChallenge(peer);
        await this.waitForClose(peer);
        return this.result(peer);
    }

    /** The peer refuses the challenge with an error response of its own. */
    public async probeRefusedRequest(): Promise<HandshakeSuspensionProbe> {
        const peer = this.connectProbePeer();
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
        await this.waitForClose(peer);
        return this.result(peer);
    }

    /**
     * The connection is already gone when the request settles. There is no peer
     * left to suspend, so nothing is banned and nothing is closed by the
     * handshake itself.
     */
    public async probeTransportClosedDuringRequest(): Promise<HandshakeSuspensionProbe> {
        const peer = this.connectProbePeer();
        await this.waitForChallenge(peer);
        this.p2pManager.rpcRouter.rejectPendingRpcRequestsForTransport(
            peer.transport,
            new Error("Peer disconnected before RPC response arrived")
        );
        await this.waitForClose(peer);
        return this.result(peer);
    }

    /**
     * The peer opens with a request whose timestamp is outside the agreement
     * window. Our refusal must reach the wire before the close, otherwise the
     * peer only sees a bare disconnect and redials.
     */
    public async probeSkewedRequestRefusedBeforeClose(): Promise<RefusalOrderingProbe> {
        const peer = this.connectProbePeer();
        const skewedTime =
            Clock.getTimeInSeconds() +
            this.p2pManager.stateManager.timeConfig.agreementTime * 10;
        peer.socket.emit(
            "data",
            JSON.stringify({
                service: "initHandshakeService",
                method: "onInitHandshakeRequest",
                params: [ethers.keccak256(ethers.randomBytes(32)), skewedTime],
                requestId: "probe-skewed-request"
            })
        );
        await this.waitForClose(peer);
        return {
            refusalFrameIndex: peer.socket.writes.findIndex((frame) => {
                const value = JSON.parse(frame) as {
                    rpcResponse?: boolean;
                    requestId?: string;
                    ok?: boolean;
                };
                return (
                    value.rpcResponse === true &&
                    value.requestId === "probe-skewed-request" &&
                    value.ok === false
                );
            }),
            writesAtDestroy: peer.socket.writesAtDestroy,
            socketDestroyed: peer.socket.destroyed,
            banCalls: [...peer.peerInfo.banCalls],
            profileBlacklisted: peer.profile.isBlackListed,
            profileSuspended: peer.profile.isSuspended
        };
    }

    /**
     * A real Holepunch transport over a recording socket. Its constructor
     * starts the handshake, so the challenge is already on the wire.
     */
    private connectProbePeer(wallet?: ethers.HDNodeWallet): ProbePeer {
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
            wallet: wallet ?? ethers.Wallet.createRandom()
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
     * Answer the challenge the way an honest peer does: sign the domain-tagged
     * message and reply on the same request id. No ack follows.
     */
    private async answerHandshakeChallenge(peer: ProbePeer): Promise<void> {
        const request = await this.waitForChallenge(peer);
        const challengeHash = String(request.params[0]);
        const signature = await peer.wallet.signMessage(
            InitHandshakeService.buildHandshakeChallengeMessage(challengeHash)
        );
        peer.socket.emit(
            "data",
            JSON.stringify({
                rpcResponse: true,
                requestId: request.requestId,
                ok: true,
                result: {
                    signature,
                    responseTime: Clock.getTimeInSeconds(),
                    preferredTransport: TransportType.HOLEPUNCH
                }
            })
        );
    }

    /**
     * Wait for the disconnect the probed policy is expected to perform. A peer
     * that is never closed is a result the caller asserts on, not an error, so
     * the expired budget returns the observed state instead of throwing.
     */
    private async waitForClose(peer: ProbePeer): Promise<void> {
        await waitFor(
            () => peer.socket.destroyed,
            this.challengeWaitMs() + 5000,
            20
        ).catch(() => undefined);
    }

    private result(peer: ProbePeer): HandshakeSuspensionProbe {
        return {
            socketDestroyed: peer.socket.destroyed,
            banCalls: [...peer.peerInfo.banCalls],
            identityBlacklisted: this.p2pManager.isBlacklisted(
                peer.wallet.address
            ),
            profileBlacklisted: peer.profile.isBlackListed,
            profileSuspended: peer.profile.isSuspended,
            connectionRemoved: !this.p2pManager.openConnections.includes(
                peer.transport
            )
        };
    }

    private challengeWaitMs(): number {
        return this.p2pManager.stateManager.timeConfig.agreementTime * 1000;
    }
}

export default InitHandshakePolicyProbeService;
