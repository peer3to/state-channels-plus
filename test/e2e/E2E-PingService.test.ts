import { expect } from "chai";
import { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";

import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { defineRpcServices } from "@/rpc/registry";
import { ATransport } from "@/transport";
import type P2PManager from "@/P2PManager";

type PingPongFactories = {
    pingService: (p2pManager: P2PManager<PingPongFactories>) => PingService;
    relayService: (p2pManager: P2PManager<PingPongFactories>) => RelayService;
};

type PingPongP2PManager = P2PManager<PingPongFactories>;

class PingService extends ARpcService<PingRpcMethods, PingPongP2PManager> {
    public guardFailureCount = 0;
    public receivedPingNonces: string[] = [];
    public receivedPongNonces: string[] = [];

    constructor(
        p2pManager: PingPongP2PManager,
        private readonly onGuardFailure?: () => void
    ) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ module: "PingService" })
        );

        this.guards = [
            new HandshakeCompletedGuard(this, {
                onFailure: () => {
                    this.guardFailureCount++;
                    this.onGuardFailure?.();
                }
            })
        ];
    }

    public createRPCMethods(transport: ATransport): PingRpcMethods {
        return new PingRpcMethods(transport, this);
    }
}

class PingRpcMethods extends ARpcMethods<PingPongP2PManager> {
    constructor(
        transport: ATransport,
        private readonly service: PingService
    ) {
        super(transport, service.p2pManager);
    }

    public async ping(nonce: string) {
        this.service.receivedPingNonces.push(nonce);

        // pingService -> pingService (pong)
        this.remoteRpc.pingService.pong(nonce).sendOne(this.senderTransport);

        // pingService -> relayService (cross-service call)
        this.remoteRpc.relayService
            .recordPing(nonce)
            .sendOne(this.senderTransport);
    }

    public async pong(nonce: string) {
        this.service.receivedPongNonces.push(nonce);
    }
}

class RelayService extends ARpcService<RelayRpcMethods, PingPongP2PManager> {
    public receivedRelayPingNonces: string[] = [];

    constructor(p2pManager: PingPongP2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ module: "RelayService" })
        );
    }

    public createRPCMethods(transport: ATransport): RelayRpcMethods {
        return new RelayRpcMethods(transport, this);
    }
}

class RelayRpcMethods extends ARpcMethods<PingPongP2PManager> {
    constructor(
        transport: ATransport,
        private readonly service: RelayService
    ) {
        super(transport, service.p2pManager);
    }

    public async recordPing(nonce: string) {
        this.service.receivedRelayPingNonces.push(nonce);

        // relayService -> pingService (cross-service call)
        this.remoteRpc.pingService.pong(nonce).sendOne(this.senderTransport);
    }
}

describe("E2E: PingService (custom RPC)", function () {
    let harness: PeerTestHarness<MathStateMachine, any> | undefined;

    afterEach(async function () {
        await harness?.cleanup();
    });

    const hasVerifiedProfile = (
        ownerPeer: TestPeer<MathStateMachine>,
        counterparty: TestPeer<MathStateMachine>
    ): boolean => {
        const profile =
            ownerPeer.stateManager.p2pManager.profileManager.getProfileByEvmAddress(
                counterparty.address
            );
        return !!profile;
    };

    it("should block ping until handshake completes, then allow ping/pong", async function () {
        let peer1GuardFailureSignalCount = 0;

        const rpcServiceFactories = defineRpcServices<PingPongFactories>({
            pingService: (p2p) =>
                new PingService(p2p, () => {
                    // This callback runs on the receiver when HandshakeCompletedGuard blocks.
                    peer1GuardFailureSignalCount++;
                }),
            relayService: (p2p) => new RelayService(p2p)
        });

        const harness = new PeerTestHarness<
            MathStateMachine,
            typeof rpcServiceFactories
        >();
        await harness.setup(2, {
            autoConnect: false,
            rpcServiceFactories,
            timeConfig: {
                agreementTime: 10 // seconds
            }
        });

        const peer0 = harness.peers[0];
        const peer1 = harness.peers[1];

        const p2p0 = peer0.p2pInstance.p2pSigner.p2pManager;
        const p2p1 = peer1.p2pInstance.p2pSigner.p2pManager;

        const ping0 = p2p0.localRpc.pingService;
        const ping1 = p2p1.localRpc.pingService;
        const relay0 = p2p0.localRpc.relayService;
        const relay1 = p2p1.localRpc.relayService;

        // -------------------------------------------------------------
        // Type-safety demonstration (compile-time only)
        // -------------------------------------------------------------
        if (false) {
            p2p0.remoteRpc.pingService.ping("ok");
            p2p0.remoteRpc.relayService.recordPing("ok");

            // @ts-expect-error - ping expects a string
            p2p0.remoteRpc.pingService.ping(123);

            // @ts-expect-error - recordPing expects a string
            p2p0.remoteRpc.relayService.recordPing(123);

            // @ts-expect-error - service does not exist
            p2p0.remoteRpc.doesNotExistService;

            ping0.guardFailureCount;
            relay0.receivedRelayPingNonces;
        }

        // Ensure a deterministic "handshake incomplete" window on peer1 by
        // temporarily preventing it from initiating its own handshake.
        const peer0InitHandshakeService =
            peer0.stateManager.p2pManager.localRpc.initHandshakeService;
        const peer1InitHandshakeService =
            peer1.stateManager.p2pManager.localRpc.initHandshakeService;

        const originalPeer0InitHandshake =
            peer0InitHandshakeService.initHandshake.bind(
                peer0InitHandshakeService
            );
        const originalPeer1InitHandshake =
            peer1InitHandshakeService.initHandshake.bind(
                peer1InitHandshakeService
            );

        let capturedPeer0Transport: ATransport | undefined;
        let capturedPeer1Transport: ATransport | undefined;

        peer0InitHandshakeService.initHandshake = (transport: ATransport) => {
            capturedPeer1Transport = capturedPeer1Transport ?? transport;
            originalPeer0InitHandshake(transport);
        };

        peer1InitHandshakeService.initHandshake = (transport: ATransport) => {
            // intentionally noop
            capturedPeer0Transport = capturedPeer0Transport ?? transport;
        };

        await harness.openChannel();

        harness.connectAllPeers(); // don't await

        // Wait until we have transports on both sides. We need both so we can
        // later trigger peer1's handshake quickly (before peer0's ack-timeout).
        await harness.waitForCondition(
            () => !!capturedPeer0Transport && !!capturedPeer1Transport,
            5000,
            25
        );
        if (!capturedPeer0Transport) {
            throw new Error(
                "Expected to capture peer0 transport during initHandshake"
            );
        }
        if (!capturedPeer1Transport) {
            throw new Error(
                "Expected to capture peer1 transport during noop initHandshake"
            );
        }

        // Wait until peer1 responds to peer0
        let ok = await harness.waitForCondition(
            () => peer0InitHandshakeService.didRespond(capturedPeer1Transport!),
            5000,
            50
        );
        expect(ok).to.equal(true);
        expect(hasVerifiedProfile(peer0, peer1)).to.equal(false);

        // Send ping from peer0 -> peer1; it should arrive but be blocked by HandshakeCompletedGuard on peer1.
        const nonce1 = `nonce-${Date.now()}-1`;
        p2p0.remoteRpc.pingService.ping(nonce1).sendOne(capturedPeer1Transport);

        ok = await harness.waitForCondition(
            () =>
                ping1.guardFailureCount >= 1 &&
                peer1GuardFailureSignalCount >= 1,
            2000,
            25
        );
        expect(ok).to.equal(true);
        expect(ping1.receivedPingNonces).to.deep.equal([]);

        // Restore and force peer1 to initiate its own handshake so the guard will pass.
        peer1InitHandshakeService.initHandshake = originalPeer1InitHandshake;
        originalPeer1InitHandshake(capturedPeer0Transport);

        ok = await harness.waitForCondition(
            () => hasVerifiedProfile(peer0, peer1),
            5000,
            50
        );
        expect(ok).to.equal(true);

        ok = await harness.waitForCondition(
            () => hasVerifiedProfile(peer1, peer0),
            5000,
            50
        );
        expect(ok).to.equal(true);

        // Now ping should succeed and the cross-service calls should execute.
        const nonce2 = `nonce-${Date.now()}-2`;
        // Use the current profile transport after verification (it may differ from
        // the originally captured transport in some timing windows).
        const peer1To0Transport =
            peer1.stateManager.p2pManager.profileManager.getTransportByEvmAddress(
                peer0.address
            ) ?? capturedPeer0Transport;

        p2p1.remoteRpc.pingService.ping(nonce2).sendOne(peer1To0Transport);

        const allSignalsReceived = await harness.waitForCondition(
            () =>
                ping1.receivedPongNonces.includes(nonce2) &&
                relay1.receivedRelayPingNonces.includes(nonce2) &&
                ping0.receivedPongNonces.includes(nonce2),
            7000,
            50
        );
        expect(allSignalsReceived).to.equal(true);
        expect(ping1.guardFailureCount).to.be.at.least(1);
        expect(ping1.receivedPongNonces).to.include(nonce2);
        expect(relay1.receivedRelayPingNonces).to.include(nonce2);
        expect(ping0.receivedPongNonces).to.include(nonce2);
    });
});
