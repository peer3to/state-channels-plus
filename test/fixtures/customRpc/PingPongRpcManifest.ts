import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import { HarnessControlRpc } from "./harnessControl/HarnessControlRpc";

/**
 * Showcase custom RPC: proves typed peer-to-peer custom RPCs work across the
 * runtime port in BOTH delivery styles, targeted by EVM address (not transport,
 * which can't cross the boundary):
 *
 * - fire-and-forget: `sendPing` → peer records the ping, pongs back, and the
 *   relay service records it (all `void`, `sendOne(address)`);
 * - request/response: `requestSum` → peer computes and returns a value
 *   (`request(address)`).
 *
 * The harness drives it over `hostRpc` (loopback) and reads the recorded state
 * back; the service content itself is not important beyond demonstrating this.
 */
export type SumResponse = {
    sum: number;
    nonce: string;
    requester: string | undefined;
};

export class PingPongRpc extends HarnessControlRpc {
    pingService: PingService;
    relayService: RelayService;

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(p2pManager as unknown as P2PManager<HarnessControlRpc>);
        this.pingService = new PingService(p2pManager);
        this.relayService = new RelayService(p2pManager);
    }
}

class PingService extends ARpcService<PingRpcMethods, P2PManager<PingPongRpc>> {
    public receivedPingNonces: string[] = [];
    public receivedPongNonces: string[] = [];
    public receivedSumNonces: string[] = [];

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ component: "PingService" })
        );
    }

    public createRPCMethods(transport: ATransport): PingRpcMethods {
        return new PingRpcMethods(transport, this);
    }
}

class PingRpcMethods extends ARpcMethods<P2PManager<PingPongRpc>> {
    constructor(
        transport: ATransport,
        private readonly service: PingService
    ) {
        super(transport, service.p2pManager);
    }

    // ===== Peer-to-peer endpoints (the RPC being showcased) =====

    /** Fire-and-forget: record the ping, pong back, and have the relay log it. */
    public ping(nonce: string): void {
        this.service.receivedPingNonces.push(nonce);
        this.remoteRpc.pingService.pong(nonce).sendOne(this.senderTransport);
        this.remoteRpc.relayService
            .recordPing(nonce)
            .sendOne(this.senderTransport);
    }

    public pong(nonce: string): void {
        this.service.receivedPongNonces.push(nonce);
    }

    /** Request/response: compute a value and return it to the caller. */
    public async sum(
        a: number,
        b: number,
        nonce: string
    ): Promise<SumResponse> {
        this.service.receivedSumNonces.push(nonce);
        return {
            sum: a + b,
            nonce,
            requester: this.senderTransport.peerAddress
        };
    }

    /** Request/response error: the rejection is propagated back to the caller. */
    public async fail(reason: string): Promise<string> {
        throw new Error(reason);
    }

    // ===== State reads (driven over hostRpc, loopback to self) =====

    public getReceivedPingNonces(): string[] {
        return this.service.receivedPingNonces;
    }
    public getReceivedPongNonces(): string[] {
        return this.service.receivedPongNonces;
    }
    public getReceivedSumNonces(): string[] {
        return this.service.receivedSumNonces;
    }
}

class RelayService extends ARpcService<
    RelayRpcMethods,
    P2PManager<PingPongRpc>
> {
    public receivedRelayPingNonces: string[] = [];

    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ component: "RelayService" })
        );
    }

    public createRPCMethods(transport: ATransport): RelayRpcMethods {
        return new RelayRpcMethods(transport, this);
    }
}

class RelayRpcMethods extends ARpcMethods<P2PManager<PingPongRpc>> {
    constructor(
        transport: ATransport,
        private readonly service: RelayService
    ) {
        super(transport, service.p2pManager);
    }

    /** Peer-to-peer: record a relayed ping nonce. */
    public recordPing(nonce: string): void {
        this.service.receivedRelayPingNonces.push(nonce);
    }

    public getReceivedRelayPingNonces(): string[] {
        return this.service.receivedRelayPingNonces;
    }
}

export default PingPongRpc;
