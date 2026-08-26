import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import sinon from "sinon";
import { ethers } from "ethers";
import { AdKind } from "@/discovery/ChannelAd";
import { LobbyReservations } from "@/discovery/LobbyReservations";

describe("LobbyReservations (pure module)", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
    });

    afterEach(() => {
        clock.restore();
    });

    function makeReservation(
        overrides: Partial<{
            adId: string;
            peerAddress: string;
            channelId: string;
            kind: AdKind;
        }> = {}
    ) {
        return {
            adId: "0xad1",
            peerAddress: ethers.Wallet.createRandom().address,
            channelId: ethers.hexlify(ethers.randomBytes(32)),
            kind: AdKind.JOIN,
            ...overrides
        };
    }

    it("reserve/release: reserve() succeeds when free, release() clears it and returns true, release() of an unknown id returns false and never throws", () => {
        const expired: unknown[] = [];
        const reservations = new LobbyReservations({
            now: () => Date.now(),
            holdMs: 5000,
            onExpire: (r) => expired.push(r)
        });

        const r = makeReservation();
        const result = reservations.reserve(r);
        expect(result).to.deep.equal({ ok: true, holdMs: 5000 });
        expect(reservations.current).to.deep.include(r);

        expect(reservations.release("0x-unknown")).to.equal(false);
        expect(reservations.current).to.deep.include(r);

        expect(reservations.release(r.adId)).to.equal(true);
        expect(reservations.current).to.be.undefined;
        expect(expired).to.deep.equal([]); // release, never onExpire
    });

    it("busy: reserve() while held declines 'busy' without disturbing the held reservation", () => {
        const reservations = new LobbyReservations({
            now: () => Date.now(),
            holdMs: 5000,
            onExpire: () => {}
        });

        const first = makeReservation({ adId: "0xfirst" });
        expect(reservations.reserve(first)).to.deep.equal({
            ok: true,
            holdMs: 5000
        });

        const second = makeReservation({ adId: "0xsecond" });
        expect(reservations.reserve(second)).to.deep.equal({
            ok: false,
            reason: "busy"
        });
        expect(reservations.current).to.deep.include(first);
    });

    it("concurrency: two back-to-back reserve() calls on the same instance yield exactly one ok and one busy, deterministically", () => {
        const reservations = new LobbyReservations({
            now: () => Date.now(),
            holdMs: 5000,
            onExpire: () => {}
        });

        const first = makeReservation({ adId: "0xa" });
        const second = makeReservation({ adId: "0xb" });
        const resultA = reservations.reserve(first);
        const resultB = reservations.reserve(second);

        expect([resultA.ok, resultB.ok].filter(Boolean).length).to.equal(1);
        expect(reservations.current?.adId).to.equal(first.adId);
    });

    it("expiry: onExpire fires exactly once at holdMs with the expired reservation, and current clears", () => {
        const expired: { adId: string }[] = [];
        const reservations = new LobbyReservations({
            now: () => Date.now(),
            holdMs: 1000,
            onExpire: (r) => expired.push(r)
        });
        const r = makeReservation({ adId: "0xexp" });
        reservations.reserve(r);

        clock.tick(999);
        expect(reservations.current).to.not.be.undefined;
        expect(expired).to.deep.equal([]);

        clock.tick(1);
        expect(reservations.current).to.be.undefined;
        expect(expired).to.have.length(1);
        expect(expired[0].adId).to.equal("0xexp");
    });

    it("independence: two reservation instances with DIFFERENT holdMs, on the SAME clock, expire independently - one expiring never shortens/cancels the other", () => {
        const shortExpired: unknown[] = [];
        const longExpired: unknown[] = [];
        const shortHold = new LobbyReservations({
            now: () => Date.now(),
            holdMs: 100,
            onExpire: (r) => shortExpired.push(r)
        });
        const longHold = new LobbyReservations({
            now: () => Date.now(),
            holdMs: 500,
            onExpire: (r) => longExpired.push(r)
        });

        shortHold.reserve(makeReservation({ adId: "0xshort" }));
        longHold.reserve(makeReservation({ adId: "0xlong" }));

        clock.tick(100);
        expect(shortExpired).to.have.length(1);
        expect(longExpired).to.have.length(0);
        expect(longHold.current).to.not.be.undefined;

        clock.tick(400);
        expect(shortExpired).to.have.length(1); // unaffected by the long hold's own expiry
        expect(longExpired).to.have.length(1);
    });

    it("dispose(): clears the timer with no side effects - onExpire never fires even after the hold's duration elapses", () => {
        const expired: unknown[] = [];
        const reservations = new LobbyReservations({
            now: () => Date.now(),
            holdMs: 200,
            onExpire: (r) => expired.push(r)
        });
        reservations.reserve(makeReservation());
        reservations.dispose();
        expect(reservations.current).to.be.undefined;

        clock.tick(1000);
        expect(expired).to.deep.equal([]);
    });
});
