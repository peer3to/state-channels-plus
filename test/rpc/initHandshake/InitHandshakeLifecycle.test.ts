import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";

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
});
