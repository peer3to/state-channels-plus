import { expect } from "chai";
import { MathStateMachine } from "@typechain-types";

import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import MainRpcService from "@/rpc/MainRpcService";
import type P2PManager from "@/P2PManager";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import type ATransport from "@/transport/ATransport";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT_MODULE } from "@test/harness/core/defaultMathHarnessDeployment";

type PingPongOptions = {
    onRpcHandled: () => void;
};

class PingPongRpc extends MainRpcService {
    pingService: PingService;
    relayService: RelayService;

    constructor(p2pManager: P2PManager<PingPongRpc>, options: PingPongOptions) {
        super(p2pManager);
        this.pingService = new PingService(p2pManager, options);
        this.relayService = new RelayService(p2pManager, options);
    }
}

class PingService extends ARpcService<PingRpcMethods, P2PManager<PingPongRpc>> {
    public receivedPingNonces: string[] = [];
    public receivedPongNonces: string[] = [];

    constructor(
        p2pManager: P2PManager<PingPongRpc>,
        readonly options: PingPongOptions
    ) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ component: "PingService" })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
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

    public ping(nonce: string): void {
        this.service.receivedPingNonces.push(nonce);
        this.service.options.onRpcHandled();

        this.remoteRpc.pingService.pong(nonce).sendOne(this.senderTransport);
        this.remoteRpc.relayService
            .recordPing(nonce)
            .sendOne(this.senderTransport);
    }

    public pong(nonce: string): void {
        this.service.receivedPongNonces.push(nonce);
        this.service.options.onRpcHandled();
    }
}

class RelayService extends ARpcService<
    RelayRpcMethods,
    P2PManager<PingPongRpc>
> {
    public receivedRelayPingNonces: string[] = [];

    constructor(
        p2pManager: P2PManager<PingPongRpc>,
        readonly options: PingPongOptions
    ) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ component: "RelayService" })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
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

    public recordPing(nonce: string): void {
        this.service.receivedRelayPingNonces.push(nonce);
        this.service.options.onRpcHandled();
    }
}

describe("E2E: PingPongService (custom RPC)", function () {
    let harness: PeerTestHarness<PingPongRpc, MathStateMachine> | undefined;

    afterEach(async function () {
        await harness?.cleanup();
        harness = undefined;
    });

    it("should let two peers call custom Ping/Pong RPC services", async function () {
        harness = new PeerTestHarness<PingPongRpc, MathStateMachine>(
            DEFAULT_MATH_HARNESS_DEPLOYMENT_MODULE
        );

        await harness.setup(2, {
            autoConnect: false,
            customRpc: PingPongRpc,
            customRpcOptions: {
                onRpcHandled: () => harness?.rpcBarrier.signal()
            },
            timeConfig: {
                agreementTime: 10,
                p2pTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 2
            }
        });
        await harness.lifecycle.openChannel();
        await harness.rpc.connectPeers([0, 1]);
        await harness.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        const peer0 = harness.getPeer(0);
        const peer1 = harness.getPeer(1);
        const transport0To1 = await harness.query.waitForPeerTransport(
            0,
            1,
            5000
        );
        const transport1To0 = await harness.query.waitForPeerTransport(
            1,
            0,
            5000
        );

        peer0.stateManager.p2pManager.remoteRpc.pingService
            .ping("from-0")
            .sendOne(transport0To1);
        await harness.rpcBarrier.waitFor(
            () =>
                peer1.stateManager.p2pManager.localRpc.pingService.receivedPingNonces.includes(
                    "from-0"
                ) &&
                peer0.stateManager.p2pManager.localRpc.pingService.receivedPongNonces.includes(
                    "from-0"
                ) &&
                peer0.stateManager.p2pManager.localRpc.relayService.receivedRelayPingNonces.includes(
                    "from-0"
                ),
            {
                timeoutMs: 5000,
                timeoutMessage: "Peer 0 -> peer 1 ping/pong did not complete"
            }
        );

        peer1.stateManager.p2pManager.remoteRpc.pingService
            .ping("from-1")
            .sendOne(transport1To0);
        await harness.rpcBarrier.waitFor(
            () =>
                peer0.stateManager.p2pManager.localRpc.pingService.receivedPingNonces.includes(
                    "from-1"
                ) &&
                peer1.stateManager.p2pManager.localRpc.pingService.receivedPongNonces.includes(
                    "from-1"
                ) &&
                peer1.stateManager.p2pManager.localRpc.relayService.receivedRelayPingNonces.includes(
                    "from-1"
                ),
            {
                timeoutMs: 5000,
                timeoutMessage: "Peer 1 -> peer 0 ping/pong did not complete"
            }
        );

        expect(
            peer1.stateManager.p2pManager.localRpc.pingService
                .receivedPingNonces
        ).to.include("from-0");
        expect(
            peer0.stateManager.p2pManager.localRpc.pingService
                .receivedPongNonces
        ).to.include("from-0");
        expect(
            peer0.stateManager.p2pManager.localRpc.relayService
                .receivedRelayPingNonces
        ).to.include("from-0");

        expect(
            peer0.stateManager.p2pManager.localRpc.pingService
                .receivedPingNonces
        ).to.include("from-1");
        expect(
            peer1.stateManager.p2pManager.localRpc.pingService
                .receivedPongNonces
        ).to.include("from-1");
        expect(
            peer1.stateManager.p2pManager.localRpc.relayService
                .receivedRelayPingNonces
        ).to.include("from-1");
    });
});
