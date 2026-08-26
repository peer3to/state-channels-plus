import { expect } from "chai";
import { EventBus } from "@/events/EventBus";
import type { DiscoveryEventMap } from "@/events/DiscoveryEvents";

describe("EventBus discovery kind (component)", function () {
    it("type-checks a declared discovery listener and rejects wrong arity at compile time", function () {
        const bus = new EventBus();
        let received: unknown;
        let wrongArityCalls = 0;
        bus.on("discovery", "ad", (ad) => {
            received = ad;
        });

        // @ts-expect-error wrong arity for the declared "ad" tuple
        bus.on("discovery", "ad", (ad, extra) => {
            wrongArityCalls += 1;
        });

        bus.emit("discovery", "ad", [
            { adId: "0xad", encodedAd: "0xbeef", advertiser: "0xabc" }
        ]);
        expect(received).to.deep.equal({
            adId: "0xad",
            encodedAd: "0xbeef",
            advertiser: "0xabc"
        });
        // The wrong-arity listener still ran at runtime (TS erases the
        // arity check) -- it exists only to prove the ts-expect-error fires.
        expect(wrongArityCalls).to.equal(1);
    });

    it("delivers a discovery event to a named listener, a kind-wide listener, and the bridge tap in that order", function () {
        const bus = new EventBus();
        const order: string[] = [];
        bus.on("discovery", "intentResult", () => {
            order.push("named");
        });
        bus.onKind("discovery", (eventName) => {
            order.push(`kind:${eventName}`);
        });
        bus.setBridgeTap((kind, eventName) => {
            order.push(`bridge:${kind}:${eventName}`);
        });

        bus.emit("discovery", "intentResult", [
            { adId: "0xad", accepted: true, holdMs: 5000 }
        ]);

        expect(order).to.deep.equal([
            "named",
            "kind:intentResult",
            "bridge:discovery:intentResult"
        ]);
    });

    it("isolates a throwing discovery listener: other listeners and the bridge tap still run", function () {
        const errors: string[] = [];
        const bus = new EventBus((kind, eventName, error) =>
            errors.push(
                `${kind}:${eventName}:${error instanceof Error ? error.message : String(error)}`
            )
        );
        let delivered = 0;
        let bridged = 0;
        bus.on("discovery", "lobbyPeer", () => {
            throw new Error("boom");
        });
        bus.on("discovery", "lobbyPeer", () => {
            delivered += 1;
        });
        bus.setBridgeTap(() => {
            bridged += 1;
        });

        bus.emit("discovery", "lobbyPeer", [
            { address: "0xabc", connected: true, peerCount: 2 }
        ]);

        expect(delivered).to.equal(1);
        expect(bridged).to.equal(1);
        expect(errors).to.deep.equal(["discovery:lobbyPeer:boom"]);
    });

    it("structuredClone()s every declared discovery event payload", function () {
        const payloads: {
            [K in keyof DiscoveryEventMap]: DiscoveryEventMap[K][0];
        } = {
            lobbyJoined: { topic: "0xtopic", appNamespace: "poker" },
            lobbyLeft: { topic: "0xtopic" },
            lobbyPeer: { address: "0xabc", connected: true, peerCount: 3 },
            ad: { adId: "0xad", encodedAd: "0xbeef", advertiser: "0xabc" },
            adExpired: { adId: "0xad", reason: "ttl" },
            intentResult: {
                adId: "0xad",
                accepted: false,
                reason: "full",
                holdMs: 5000
            },
            acquireStage: {
                adId: "0xad",
                stage: "connect",
                outcome: "pending",
                reason: undefined
            },
            probeStage: {
                channelId: "0xchannel",
                stage: "rendezvous",
                outcome: "ok",
                reason: undefined
            }
        };

        for (const [eventName, payload] of Object.entries(payloads)) {
            let cloneError: unknown;
            try {
                structuredClone(payload);
            } catch (error) {
                cloneError = error;
            }
            expect(
                cloneError,
                `structuredClone failed for discovery event "${eventName}"`
            ).to.equal(undefined);
        }
    });
});
