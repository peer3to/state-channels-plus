import { expect } from "chai";

import { TransportType } from "@/transport";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";

describe("ProfileManager Holepunch ban policy", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("bans an explicitly blacklisted unauthenticated Holepunch profile", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUnauthenticatedBlacklist()
            .request();

        expect(result.banCalls).to.deep.equal([true]);
        expect(result.socketDestroyed).to.equal(true);
        expect(result.profileBlacklisted).to.equal(true);
    });

    it("drops an ordinary unauthenticated Holepunch profile without banning it", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUnauthenticatedClose()
            .request();

        expect(result.banCalls).to.deep.equal([]);
        expect(result.socketDestroyed).to.equal(true);
        expect(result.profileBlacklisted).to.equal(false);
    });

    it("bans the Holepunch fallback after a WebRTC upgrade", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUpgradeBanPolicy(fixture.address(1))
            .request();

        expect(result.banCallsAfterUpgrade).to.deep.equal([true]);
    });

    it("does not release the fallback ban when a replaced WebRTC transport closes", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUpgradeBanPolicy(fixture.address(1))
            .request();

        expect(result.banCallsAfterStaleClose).to.deep.equal([true]);
    });

    it("releases the fallback ban when the current WebRTC transport closes", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUpgradeBanPolicy(fixture.address(1))
            .request();

        expect(result.banCallsAfterCurrentClose).to.deep.equal([true, false]);
    });

    it("releases the fallback ban when WebRTC falls back to Holepunch", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUpgradeBanPolicy(fixture.address(1))
            .request();

        expect(result.banCallsAfterFallback).to.deep.equal([
            true,
            false,
            false
        ]);
    });

    it("keeps an explicit blacklist banned when the current WebRTC transport closes", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeExplicitBlacklist(fixture.address(1))
            .request();

        expect(result.profileBlacklisted).to.equal(true);
        expect(result.banCalls).to.deep.equal([true]);
    });

    it("unblacklisting with selected WebRTC keeps the Holepunch ban", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUnblacklistBanPolicy(
                fixture.address(1),
                "selected-webrtc"
            )
            .request();

        expect(result.selectedTransportType).to.equal(TransportType.WEBRTC);
        expect(result.liveWebRtcCount).to.equal(1);
        expect(result.profileBlacklistedAfterBlacklist).to.equal(true);
        expect(result.profileBlacklistedAfterUnblacklist).to.equal(false);
        expect(result.banCalls).to.deep.equal([true]);
    });

    it("unblacklisting with selected Holepunch and live WebRTC keeps the Holepunch ban", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUnblacklistBanPolicy(
                fixture.address(1),
                "selected-holepunch-with-live-webrtc"
            )
            .request();

        expect(result.selectedTransportType).to.equal(TransportType.HOLEPUNCH);
        expect(result.liveWebRtcCount).to.equal(1);
        expect(result.profileBlacklistedAfterBlacklist).to.equal(true);
        expect(result.profileBlacklistedAfterUnblacklist).to.equal(false);
        expect(result.banCalls).to.deep.equal([true]);
    });

    it("unblacklisting with selected Holepunch and no live WebRTC releases the Holepunch ban", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeUnblacklistBanPolicy(
                fixture.address(1),
                "selected-holepunch-without-live-webrtc"
            )
            .request();

        expect(result.selectedTransportType).to.equal(TransportType.HOLEPUNCH);
        expect(result.liveWebRtcCount).to.equal(0);
        expect(result.profileBlacklistedAfterBlacklist).to.equal(true);
        expect(result.profileBlacklistedAfterUnblacklist).to.equal(false);
        expect(result.banCalls).to.deep.equal([true, false]);
    });

    it("rejects an authenticated Holepunch fallback while WebRTC is healthy", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHealthyWebRtcRejectsHolepunch(
                fixture.address(1)
            )
            .request();

        expect(result.admitted).to.equal(false);
        expect(result.attemptedClosed).to.equal(true);
        expect(result.attemptedSocketDestroyed).to.equal(true);
        expect(result.currentTransportType).to.equal(TransportType.WEBRTC);
        expect(result.activePeerConnections).to.equal(1);
        expect(result.originalBanCalls).to.deep.equal([true]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.handshakeCompleted).to.equal(false);
        expect(result.disconnectionHookCalls).to.equal(0);
        expect(result.usableTrafficSent).to.equal(false);
    });

    it("accepts an authenticated usable Holepunch fallback after current WebRTC closes", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeWebRtcCloseAcceptsHolepunch(
                fixture.address(1)
            )
            .request();

        expect(result.admitted).to.equal(true);
        expect(result.attemptedClosed).to.equal(false);
        expect(result.attemptedSocketDestroyed).to.equal(false);
        expect(result.currentTransportType).to.equal(TransportType.HOLEPUNCH);
        expect(result.activePeerConnections).to.equal(1);
        expect(result.originalBanCalls).to.deep.equal([true, false]);
        expect(result.attemptedBanCalls).to.deep.equal([]);
        expect(result.profileBlacklisted).to.equal(false);
        expect(result.handshakeCompleted).to.equal(true);
        expect(result.disconnectionHookCalls).to.equal(0);
        expect(result.usableTrafficSent).to.equal(true);
    });

    it("rejects and bans a later Holepunch fallback for an excluded identity", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeBlacklistRejectsHolepunch(fixture.address(1))
            .request();

        expect(result.admitted).to.equal(false);
        expect(result.attemptedClosed).to.equal(true);
        expect(result.attemptedSocketDestroyed).to.equal(true);
        expect(result.activePeerConnections).to.equal(0);
        expect(result.originalBanCalls).to.deep.equal([true, true]);
        expect(result.attemptedBanCalls).to.deep.equal([true]);
        expect(result.profileBlacklisted).to.equal(true);
        expect(result.handshakeCompleted).to.equal(false);
        expect(result.disconnectionHookCalls).to.equal(0);
        expect(result.usableTrafficSent).to.equal(false);
    });
});
