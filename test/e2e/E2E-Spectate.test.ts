import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";
import { ATransport } from "@/transport";
import { StateSnapshot } from "@/models";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { SyncRequest } from "@/rpc/services/spectate/SpectateService";

describe("E2E: SpectateService", function () {
    let harness: PeerTestHarness<MathStateMachine> | undefined;

    beforeEach(async function () {
        harness = new PeerTestHarness<MathStateMachine>();
    });

    afterEach(async function () {
        if (harness) {
            await harness.cleanup();
            harness = undefined;
        }
    });

    it("should NOT allow spectate RPC before handshake completes", async function () {
        harness = new PeerTestHarness<MathStateMachine>();
        await harness.setup(2, {
            autoConnect: false,
            timeConfig: {
                agreementTime: 10,
                p2pTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 2
            }
        });

        const h = harness;
        if (!h) {
            throw new Error("Harness not initialized");
        }

        const peer0 = h.peers[0];
        const peer1 = h.peers[1];

        // Ensure a deterministic "handshake incomplete" window on peer1 by
        // temporarily preventing it from initiating its own handshake.
        const peer1InitHandshakeService =
            peer1.stateManager.p2pManager.localRpc.initHandshakeService;
        const originalPeer1InitHandshake =
            peer1InitHandshakeService.initHandshake.bind(
                peer1InitHandshakeService
            );
        peer1InitHandshakeService.initHandshake = () => {
            // intentionally noop
        };

        // Capture the transport that peer0 uses to talk to peer1 (same trick as PingService E2E).
        const peer0InitHandshakeService =
            peer0.stateManager.p2pManager.localRpc.initHandshakeService;
        const originalPeer0InitHandshake =
            peer0InitHandshakeService.initHandshake.bind(
                peer0InitHandshakeService
            );
        let capturedPeer0Transport: ATransport | undefined;
        peer0InitHandshakeService.initHandshake = (transport: ATransport) => {
            capturedPeer0Transport = capturedPeer0Transport ?? transport;
            return originalPeer0InitHandshake(transport);
        };

        // Instrument spectate guard failure on peer1 (receiver).
        let peer1GuardFailureCount = 0;
        const peer1SpectateService =
            peer1.p2pInstance.p2pSigner.p2pManager.localRpc.spectateService;
        (peer1SpectateService as any).guards = [
            new HandshakeCompletedGuard(peer1SpectateService as any, {
                onFailure: () => {
                    peer1GuardFailureCount++;
                }
            })
        ];

        await h.openChannel();

        h.connectAllPeers(); // don't await

        await h.waitForCondition(() => !!capturedPeer0Transport, 5000, 25);
        if (!capturedPeer0Transport) {
            throw new Error(
                "Expected to capture peer0 transport during initHandshake"
            );
        }

        const initiatorSpectateService =
            peer0.p2pInstance.p2pSigner.p2pManager.localRpc.spectateService;

        // Act: attempt to sync; receiver guard should block and initiator should timeout.
        initiatorSpectateService.remoteRpc.spectateService
            .onSpectateRequest({} as SyncRequest)
            .sendOne(capturedPeer0Transport); // sync the handhsahke is not completed calling sync(address) would not send the RPC since address has not been verified -> need to send by transport directly

        const sawGuardFailure = await h.waitForCondition(
            () => peer1GuardFailureCount >= 1,
            5000,
            25
        );
        expect(sawGuardFailure).to.equal(true);

        // Cleanup: restore peer1 handshake initiation.
        peer1InitHandshakeService.initHandshake = originalPeer1InitHandshake;

        // Cleanup: restore peer0 initHandshake instrumentation.
        peer0InitHandshakeService.initHandshake = originalPeer0InitHandshake;
    });

    it("should spectate successfully when on-chain snapshot is already on the same fork", async function () {
        // Create 3 peers normally (default setup + open flow).
        await harness!.setup(3);

        const h = harness;
        if (!h) {
            throw new Error("Harness not initialized");
        }

        const forkId = await h.openChannel();

        const initialParticipants =
            await h.peers[0].stateManager.diamondStateMachine.getParticipants();
        expect(initialParticipants.length).to.equal(3);

        // Do 3 normal state transitions.
        await h.submitNextTransaction((contract) => contract.add(1), {
            waitForTurn: true,
            waitForPeers: [0, 1, 2],
            waitForSync: true
        });
        await h.submitNextTransaction((contract) => contract.add(2), {
            waitForTurn: true,
            waitForPeers: [0, 1, 2],
            waitForSync: true
        });
        await h.submitNextTransaction((contract) => contract.add(3), {
            waitForTurn: true,
            waitForPeers: [0, 1, 2],
            waitForSync: true
        });

        // Create a 4th peer later and connect it to the same channelId.
        await h.addPeer();
        await h.waitForP2PConnections(5000);

        await h.waitForSync({ timeout: 5000 });

        // Continue transitioning 3 more times.
        await h.submitNextTransaction((contract) => contract.add(4), {
            waitForTurn: true,
            waitForPeers: [0, 1, 2, 3],
            waitForSync: true
        });
        await h.submitNextTransaction((contract) => contract.add(5), {
            waitForTurn: true,
            waitForPeers: [0, 1, 2, 3],
            waitForSync: true
        });
        await h.submitNextTransaction((contract) => contract.add(6), {
            waitForTurn: true,
            waitForPeers: [0, 1, 2, 3],
            waitForSync: true
        });

        h.assertAllPeersInSync({ peerIndices: [0, 1, 2, 3] });
        // Participant count and set should remain the same as initial (3).
        const participants =
            await h.peers[3].stateManager.diamondStateMachine.getParticipants();

        expect(participants.length).to.equal(3);

        // Sanity: on-chain snapshot is still on the original fork (spectate uses staticCall).
        const onChainSnapshot = StateSnapshot.from(
            await h.channelManager.getStateSnapshot(h.channelId)
        );
        expect(onChainSnapshot.forkID).to.equal(forkId);
    });

    it("should spectate successfully even when it must traverse forks (dispute -> reduced fork)", async function () {
        await harness!.setup(5, {
            timeConfig: {
                p2pTime: 30,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 3
            }
        });
        const forkId = await harness!.openChannel();

        await harness!.submitNextTransaction((contract) => contract.add(1));
        await harness!.submitNextTransaction((contract) => contract.add(2));
        await harness!.submitNextTransaction((contract) => contract.add(3));
        await harness!.submitNextTransaction((contract) => contract.add(3));
        await harness!.submitNextTransaction((contract) => contract.add(3));

        harness!.assertAllPeersInSync();

        const maliciousPeer = harness!.peers[2];
        await harness!.createAndResolveInvalidStateTransitionDispute(
            maliciousPeer.index,
            {
                forkId,
                forkSettleTimeoutMs: 15000
            }
        );

        await harness!.submitNextTransaction((contract) => contract.add(2), {
            waitForTurn: true,
            waitForPeers: [0, 1, 3, 4],
            waitForSync: true
        });
        await harness!.submitNextTransaction((contract) => contract.add(2), {
            waitForTurn: true,
            waitForPeers: [0, 1, 3, 4],
            waitForSync: true
        });
        await harness!.submitNextTransaction((contract) => contract.add(2), {
            waitForTurn: true,
            waitForPeers: [0, 1, 3, 4],
            waitForSync: true
        });

        await harness!.addPeer();
        await harness!.waitForP2PConnections(5000);

        await harness!.waitForSync({
            timeout: 5000,
            peerIndices: [0, 1, 3, 4, 5]
        });

        await harness!.submitNextTransaction((contract) => contract.add(2), {
            waitForTurn: true,
            waitForPeers: [0, 1, 3, 4, 5],
            waitForSync: true
        });
        await harness!.submitNextTransaction((contract) => contract.add(2), {
            waitForTurn: true,
            waitForPeers: [0, 1, 3, 4, 5],
            waitForSync: true
        });

        harness!.assertAllPeersInSync({ peerIndices: [0, 1, 3, 4, 5] });
        // Participant count and set should remain the same as initial (3).
        const participants =
            await harness!.peers[5].stateManager.diamondStateMachine.getParticipants();

        expect(participants.length).to.equal(4);

        // Sanity: on-chain snapshot is still on the original fork (spectate uses staticCall).
        const onChainSnapshot = StateSnapshot.from(
            await harness!.channelManager.getStateSnapshot(harness!.channelId)
        );
        expect(onChainSnapshot.forkID).to.equal(forkId);
    });
});
