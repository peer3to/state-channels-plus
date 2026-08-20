import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { Status } from "@/types";

/**
 * Maps to: src/rpc/services/initHandshake/InitHandshakeService.ts
 *          src/P2PManager.ts
 *          src/P2pEventHooks.ts
 *
 * Handshake completion (identity verification + `ProfileManager`
 * registration) must be independent from channel-connection promotion
 * (`P2PManager.openConnections`). `InitHandshakeService` only emits
 * `handshakeCompleted`; `P2PManager` is the sole subscriber that decides to
 * promote. These tests exercise the real wire handshake (never reimplement
 * it) and prove both halves of the split.
 */
describe("E2E: Init Handshake lifecycle neutrality", function () {
    it("registers the profile without promoting the transport when nothing subscribes to handshakeCompleted", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: false });

        const peer0 = h.getPeer(0);
        const peer1Address = h.getPeer(1).address;

        // Detach P2PManager's own promotion subscription on peer 0 only, so
        // the real wire handshake still runs end to end but nothing ever
        // calls `addConnection`. This isolates the invariant: registering a
        // profile must not, by itself, grant channel traffic.
        await h.execOnHost(peer0, (sm) => {
            (
                sm.p2pManager as unknown as {
                    unsubscribeHandshakeCompleted: () => void;
                }
            ).unsubscribeHandshakeCompleted();
        });

        await h.rpc.connectPeers([0, 1]);

        // No `onConnection`/openConnections signal will ever fire for peer 0
        // now, so poll the profile directly instead of an event barrier.
        const deadline = Date.now() + 5000;
        let isCompleted = false;
        while (Date.now() < deadline) {
            isCompleted = await h.rpc.isHandshakeCompleted(0, peer1Address);
            if (isCompleted) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(isCompleted, "handshake should still complete").to.equal(true);

        const result = await h.execOnHost(
            peer0,
            (sm, args) => {
                const profile =
                    sm.p2pManager.profileManager.getProfileByEvmAddress(
                        args.peer1Address
                    );
                return {
                    profileRegistered: !!profile,
                    handshakeCompleted: !!profile?.getIsHandshakeCompleted(),
                    isOpenConnection: sm.p2pManager.openConnections.some(
                        (transport) =>
                            transport.peerAddress === args.peer1Address
                    )
                };
            },
            { peer1Address }
        );

        expect(
            result.profileRegistered,
            "ProfileManager should still register the verified peer"
        ).to.equal(true);
        expect(
            result.handshakeCompleted,
            "the profile should be marked handshake-completed"
        ).to.equal(true);
        expect(
            result.isOpenConnection,
            "a peer with no channel-connection subscriber must never be promoted into openConnections"
        ).to.equal(false);
    });

    it("still promotes into openConnections and syncs on the normal channel path", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: false });
        await h.rpc.connectPeers([0, 1]);
        await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);
        await h.assert.rpc.handshakeCompleted({ peer1: 0, peer2: 1 });

        const peer0 = h.getPeer(0);
        const peer1Address = h.getPeer(1).address;

        const result = await h.execOnHost(
            peer0,
            (sm, args) => ({
                isOpenConnection: sm.p2pManager.openConnections.some(
                    (transport) => transport.peerAddress === args.peer1Address
                )
            }),
            { peer1Address }
        );

        expect(
            result.isOpenConnection,
            "the channel-connection path must still promote a verified peer"
        ).to.equal(true);
    });

    /**
     * Maps to: src/P2PManager.ts (onHandshakeCompleted gate)
     *          src/rpc/services/spectate/SpectateRpcMethods.ts
     *
     * The gate is broader than "dispute participant": a handshaked peer that
     * is neither a participant nor a spectator relationship must never reach
     * `openConnections` (it would otherwise receive channel broadcasts it has
     * no business seeing), while an accepted spectator must be promoted even
     * though it is not a dispute participant.
     */
    it("registers a non-participant, non-spectator peer without promoting it into openConnections", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: false });
        // Wire discovery for the two real participants before the third peer
        // joins - mirrors the "still promotes" test above, and is a
        // prerequisite for the discovery registry to pair the third peer with
        // them below.
        await h.rpc.connectPeers([0, 1]);
        await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        // Add a third peer that never becomes a channel participant. Detach
        // its own handshakeCompleted subscription BEFORE it connects, so it
        // never auto-fires `spectateService.sync` toward the participants -
        // isolating the "handshaked but never asked to spectate" case. Build
        // the peer manually (instead of `join.addSpectator`) so the
        // unsubscribe lands before `connectToChannel` starts the handshake.
        const spectatorIndex = h.peers.length;
        await h.createPeer(
            spectatorIndex,
            h.signerFor(slotAccountIndex(spectatorIndex))
        );
        const spectatorPeer = h.getPeer(spectatorIndex);

        await h.execOnHost(spectatorPeer, (sm) => {
            (
                sm.p2pManager as unknown as {
                    unsubscribeHandshakeCompleted: () => void;
                }
            ).unsubscribeHandshakeCompleted();
        });

        await h
            .control(spectatorPeer)
            .network.connectToChannel(h.channelId!.toString())
            .request();

        const peer0 = h.getPeer(0);
        const spectatorAddress = spectatorPeer.address;

        // Wait for the handshake to complete against BOTH participants (not
        // just peer0) before asserting - an outstanding peer1<->spectator
        // handshake left in flight would otherwise race the session teardown
        // below and surface as a spurious "Clock not initialized" failure.
        const deadline = Date.now() + 5000;
        let isCompletedWithPeer0 = false;
        let isCompletedWithPeer1 = false;
        while (Date.now() < deadline) {
            isCompletedWithPeer0 = await h.rpc.isHandshakeCompleted(
                0,
                spectatorAddress
            );
            isCompletedWithPeer1 = await h.rpc.isHandshakeCompleted(
                1,
                spectatorAddress
            );
            if (isCompletedWithPeer0 && isCompletedWithPeer1) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(
            isCompletedWithPeer0,
            "handshake between peer0 and the never-spectating peer should still complete"
        ).to.equal(true);
        expect(
            isCompletedWithPeer1,
            "handshake between peer1 and the never-spectating peer should still complete"
        ).to.equal(true);

        const result = await h.execOnHost(
            peer0,
            (sm, args) => {
                const profile =
                    sm.p2pManager.profileManager.getProfileByEvmAddress(
                        args.spectatorAddress
                    );
                return {
                    profileRegistered: !!profile,
                    isOpenConnection: sm.p2pManager.openConnections.some(
                        (transport) =>
                            transport.peerAddress === args.spectatorAddress
                    )
                };
            },
            { spectatorAddress }
        );

        expect(
            result.profileRegistered,
            "the peer's identity should still be known to ProfileManager"
        ).to.equal(true);
        expect(
            result.isOpenConnection,
            "a non-participant that never established a spectate relationship must not receive channel traffic"
        ).to.equal(false);
    });

    it("promotes an accepted spectator into openConnections even though it is not a dispute participant", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: false });
        await h.network.connectAllPeers();
        await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        const spectator = await h.join.addSpectatorWait();

        const peer0 = h.getPeer(0);
        const spectatorAddress = spectator.address;

        const result = await h.execOnHost(
            peer0,
            async (sm, args) => {
                const isParticipant =
                    await sm.diamondStateMachine.localDiamondContract.canParticipateInDisputes(
                        sm.channelId,
                        args.spectatorAddress
                    );
                return {
                    isOpenConnection: sm.p2pManager.openConnections.some(
                        (transport) =>
                            transport.peerAddress === args.spectatorAddress
                    ),
                    isParticipant
                };
            },
            { spectatorAddress }
        );

        expect(
            result.isParticipant,
            "sanity: the joined spectator must not be a dispute participant"
        ).to.equal(false);
        expect(
            result.isOpenConnection,
            "an accepted spectator must be promoted into openConnections to keep receiving block broadcasts"
        ).to.equal(true);
    });

    /**
     * Maps to: src/P2PManager.ts (`onHandshakeCompleted`,
     * `reevaluatePendingChannelMembership`)
     *
     * A handshake with a peer that isn't (yet) resolvable as a participant is
     * deferred, never promoted speculatively - not even when the reason it
     * can't resolve is that WE ourselves are not yet a participant. Our own
     * status changing later (e.g. joining the channel) must only promote a
     * deferred peer that has itself become a participant or accepted
     * spectator by then - it must never retroactively grant broadcast rights
     * to a peer that still hasn't.
     */
    it("does not retroactively promote a stranger once we ourselves become a participant", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0, { autoConnect: false });
        await h.rpc.connectPeers([0, 1]);
        await h.event.waitUntilEventOccurs("onConnection", 5000, [0, 1]);

        // A stranger that never becomes a participant. It spectates the real
        // participants (peer0/peer1 accept it, case 3), but it is not itself
        // a participant of - or accepted spectator of - the future
        // participant below, so neither side of that specific pair ever
        // promotes the other. Registered first, so the future participant's
        // own registration (below) discovers it via the discovery registry's
        // "full known-peer list" reply, rather than depending on a broadcast
        // reaching an already-registered client.
        const stranger = await h.join.addSpectatorWait();
        const strangerAddress = stranger.address;

        // Starts as a plain spectator - not a channel participant, exactly
        // the "we are not in a channel" case from the method comment.
        const futureParticipant = await h.join.addSpectatorWait();

        const deadline = Date.now() + 5000;
        let isCompleted = false;
        while (Date.now() < deadline) {
            isCompleted = await h.rpc.isHandshakeCompleted(
                futureParticipant.index,
                strangerAddress
            );
            if (isCompleted) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(
            isCompleted,
            "handshake between the future participant and the stranger should complete"
        ).to.equal(true);

        const before = await h.execOnHost(
            h.getPeer(futureParticipant.index),
            (sm, args) => ({
                isOpenConnection: sm.p2pManager.openConnections.some(
                    (transport) =>
                        transport.peerAddress === args.strangerAddress
                )
            }),
            { strangerAddress }
        );
        expect(
            before.isOpenConnection,
            "the stranger must not be promoted while we are not yet a participant"
        ).to.equal(false);

        // The future participant now joins the channel for real - our own
        // status changing (NOT_OPENED/SYNCED -> PENDING_PARTICIPANT) is
        // exactly the trigger that re-evaluates deferred promotions.
        await h.join.joinChannelWait({ joiner: futureParticipant });
        expect(
            await h.control(futureParticipant).query.getStatus().request()
        ).to.equal(Status.PENDING_PARTICIPANT);

        const after = await h.execOnHost(
            h.getPeer(futureParticipant.index),
            (sm, args) => ({
                isOpenConnection: sm.p2pManager.openConnections.some(
                    (transport) =>
                        transport.peerAddress === args.strangerAddress
                )
            }),
            { strangerAddress }
        );
        expect(
            after.isOpenConnection,
            "becoming a participant must not retroactively promote a peer that never became one itself"
        ).to.equal(false);
    });
});
