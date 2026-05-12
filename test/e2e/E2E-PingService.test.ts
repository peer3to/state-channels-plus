/**
 * EXAMPLE: defining and using type-safe custom RPC services.
 */
import { expect } from "chai";

import {
    ARpcMethods,
    ARpcService,
    HandshakeCompletedGuard,
    defineRpcServices
} from "@/index";
import type P2PManager from "@/P2PManager";
import { ATransport } from "@/transport";
import { sleep } from "@/utils";

import { MathStateMachine } from "@typechain-types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";

type PingPongFactories = {
    pingService: (p2p: P2PManager<PingPongFactories>) => PingService;
    relayService: (p2p: P2PManager<PingPongFactories>) => RelayService;
};

type PingPongP2P = P2PManager<PingPongFactories>;

class PingService extends ARpcService<PingRpcMethods, PingPongP2P> {
    public readonly receivedPings: string[] = [];
    public readonly receivedPongs: string[] = [];

    constructor(p2pManager: PingPongP2P) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ module: "PingService" })
        );

        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(transport: ATransport): PingRpcMethods {
        return new PingRpcMethods(transport, this);
    }
}

class PingRpcMethods extends ARpcMethods<PingPongP2P> {
    constructor(
        transport: ATransport,
        private readonly service: PingService
    ) {
        super(transport, service.p2pManager);
    }

    public async ping(nonce: string): Promise<void> {
        this.service.receivedPings.push(nonce);

        // Same-service reply (pingService -> pingService).
        this.remoteRpc.pingService.pong(nonce).sendOne(this.senderTransport);

        // Cross-service call (pingService -> relayService).
        this.remoteRpc.relayService
            .recordPing(nonce)
            .sendOne(this.senderTransport);
    }

    public async pong(nonce: string): Promise<void> {
        this.service.receivedPongs.push(nonce);
    }
}

class RelayService extends ARpcService<RelayRpcMethods, PingPongP2P> {
    public readonly recordedPings: string[] = [];

    constructor(p2pManager: PingPongP2P) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ module: "RelayService" })
        );
    }

    public createRPCMethods(transport: ATransport): RelayRpcMethods {
        return new RelayRpcMethods(transport, this);
    }
}

class RelayRpcMethods extends ARpcMethods<PingPongP2P> {
    constructor(
        transport: ATransport,
        private readonly service: RelayService
    ) {
        super(transport, service.p2pManager);
    }

    public async recordPing(nonce: string): Promise<void> {
        this.service.recordedPings.push(nonce);

        // Cross-service reply (relayService -> pingService).
        this.remoteRpc.pingService.pong(nonce).sendOne(this.senderTransport);
    }
}

describe("Example: type-safe custom RPC services", function () {
    let harness:
        | PeerTestHarness<PingPongFactories, MathStateMachine>
        | undefined;

    afterEach(async function () {
        await harness?.cleanup();
        harness = undefined;
    });

    it("delivers ping/pong and cross-service relay over an authenticated channel", async function () {
        // `defineRpcServices` preserves literal keys so that
        // `p2p.remoteRpc.pingService.ping(...)` is fully typed.
        const rpcServiceFactories = defineRpcServices<PingPongFactories>({
            pingService: (p2p) => new PingService(p2p),
            relayService: (p2p) => new RelayService(p2p)
        });

        harness = new PeerTestHarness<PingPongFactories, MathStateMachine>({
            deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
        });

        await harness.setup(2, {
            autoConnect: true,
            rpcServiceFactories,
            timeConfig: { agreementTime: 5 }
        });
        await harness.lifecycle.openChannel();

        await harness.event.waitUntilEventOccurs("onConnection", 10000);

        const peer0 = harness.getPeer(0);
        const peer1 = harness.getPeer(1);

        await harness.connectionBarrier.waitFor(
            () =>
                harness!.rpc.isHandshakeCompleted(0, peer1.address) &&
                harness!.rpc.isHandshakeCompleted(1, peer0.address),
            {
                timeoutMs: 10000,
                timeoutMessage: "handshake did not complete"
            }
        );

        const p2p0 = peer0.stateManager.p2pManager as PingPongP2P;
        const p2p1 = peer1.stateManager.p2pManager as PingPongP2P;

        // Local handles — the service instances on each peer.
        const ping0 = p2p0.localRpc.pingService;
        const ping1 = p2p1.localRpc.pingService;
        const relay0 = p2p0.localRpc.relayService;
        const relay1 = p2p1.localRpc.relayService;

        // -------------------------------------------------------------------
        // Type-safety surface (compile-time only).
        //
        // Uncomment any of the lines below and `yarn dev:tsc` will reject them:
        //
        //   p2p0.remoteRpc.pingService.ping(42);          // arg must be a string
        //   p2p0.remoteRpc.relayService.recordPing(42);   // arg must be a string
        //   p2p0.remoteRpc.doesNotExistService;           // unknown service
        // -------------------------------------------------------------------

        const nonce = `nonce-${Date.now()}`;
        p2p0.remoteRpc.pingService.ping(nonce).sendOne(peer1.address);

        const roundTripDelivered = () =>
            ping1.receivedPings.includes(nonce) &&
            relay0.recordedPings.includes(nonce) &&
            ping0.receivedPongs.includes(nonce) &&
            ping1.receivedPongs.includes(nonce);

        const deadline = Date.now() + 10000;
        while (!roundTripDelivered() && Date.now() < deadline) {
            await sleep(25);
        }
        if (!roundTripDelivered()) {
            throw new Error(
                `expected full ping/pong/relay round-trip; got ping1.pings=${JSON.stringify(ping1.receivedPings)}, relay0.recorded=${JSON.stringify(relay0.recordedPings)}, ping0.pongs=${JSON.stringify(ping0.receivedPongs)}, ping1.pongs=${JSON.stringify(ping1.receivedPongs)}`
            );
        }

        expect(ping1.receivedPings).to.deep.equal([nonce]);
        expect(relay0.recordedPings).to.deep.equal([nonce]);
        expect(ping0.receivedPongs).to.deep.equal([nonce]);
        expect(ping1.receivedPongs).to.deep.equal([nonce]);

        // Nothing should have arrived on the opposite-side counterparts.
        expect(ping0.receivedPings).to.deep.equal([]);
        expect(relay1.recordedPings).to.deep.equal([]);
    });
});
