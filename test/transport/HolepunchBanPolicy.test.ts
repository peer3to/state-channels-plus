import { expect } from "chai";
import { ethers } from "ethers";
import ProfileManager from "@/ProfileManager";
import PeerProfile from "@/PeerProfile";
import { HolepunchTransport, WebRTCTransport } from "@/transport";
import type P2PManager from "@/P2PManager";
import { createLogger } from "@/utils";

// `HolepunchTransport`/`ProfileManager` only need the narrow `BannablePeerInfo`
// shape (`ban(val)`), never a real hyperswarm peer-info object - this is a
// factory-built domain double for the one method `ProfileManager` is allowed
// to call, not a mock of a collaborator (test/AGENTS.md "no mocks").
function createFakeHolepunchPeerInfo() {
    const banCalls: boolean[] = [];
    return {
        banCalls,
        ban: (val: boolean) => {
            banCalls.push(val);
        }
    };
}

function createFakeHolepunchSocket() {
    return {
        on: () => undefined,
        write: () => undefined,
        destroy: () => undefined
    };
}

// `readyState` stays away from "open" so the constructor does not also kick
// off `startHandshake()` (which needs a real `localRpc`) - this suite only
// exercises the ban-policy wiring, not the handshake protocol.
function createFakeWebRTCChannel() {
    return {
        readyState: "connecting",
        onmessage: undefined,
        onopen: undefined,
        onclose: undefined,
        onerror: undefined,
        send: () => undefined,
        close: () => undefined
    };
}

function createP2pManagerStub(): P2PManager {
    return {
        logger: createLogger({}, {}, { level: "error" }),
        localRpc: {
            initHandshakeService: {
                initHandshake: () => undefined
            }
        },
        stateManager: {
            channelId: "test-channel",
            forkId: 0,
            timeConfig: { agreementTime: 1 },
            timeoutManager: {
                // The upgrade grace-period task (retiring the old transport)
                // is not exercised by this policy suite - record it instead
                // of leaving a real timer running past the test.
                scheduleTask: () =>
                    ({}) as unknown as ReturnType<typeof setTimeout>
            }
        }
    } as unknown as P2PManager;
}

function createRegisteredProfile(p2pManager: P2PManager) {
    const evmAddress = ethers.Wallet.createRandom().address;
    const peerInfo = createFakeHolepunchPeerInfo();
    const holepunchTransport = new HolepunchTransport(
        createFakeHolepunchSocket(),
        peerInfo,
        p2pManager
    );
    const profileManager = new ProfileManager();
    const profile = new PeerProfile(holepunchTransport, evmAddress);
    profileManager.registerProfile(profile);
    return {
        profileManager,
        profile,
        evmAddress,
        peerInfo,
        holepunchTransport
    };
}

describe("ProfileManager - Holepunch ban policy", function () {
    it("does not ban on an ordinary Holepunch transport close (bug fix)", function () {
        const p2pManager = createP2pManagerStub();
        const peerInfo = createFakeHolepunchPeerInfo();
        const transport = new HolepunchTransport(
            createFakeHolepunchSocket(),
            peerInfo,
            p2pManager
        );

        transport._close();

        expect(peerInfo.banCalls).to.deep.equal([]);
    });

    it("bans Holepunch on a successful Holepunch->WebRTC upgrade", function () {
        const p2pManager = createP2pManagerStub();
        const { profileManager, evmAddress, peerInfo } =
            createRegisteredProfile(p2pManager);

        const webRTCTransport = new WebRTCTransport(
            createFakeWebRTCChannel() as any,
            p2pManager
        );
        profileManager.updateTransport(evmAddress, webRTCTransport);

        expect(peerInfo.banCalls).to.deep.equal([true]);
    });

    it("unbans Holepunch once the WebRTC transport closes for a non-blacklisted peer", function () {
        const p2pManager = createP2pManagerStub();
        const { profileManager, evmAddress, peerInfo } =
            createRegisteredProfile(p2pManager);

        const webRTCTransport = new WebRTCTransport(
            createFakeWebRTCChannel() as any,
            p2pManager
        );
        profileManager.updateTransport(evmAddress, webRTCTransport);
        expect(peerInfo.banCalls).to.deep.equal([true]);

        profileManager.releaseHolepunchBanOnWebRtcClose(webRTCTransport);

        expect(peerInfo.banCalls).to.deep.equal([true, false]);
    });

    it("bans on explicit blacklist and keeps the ban across a WebRTC close", function () {
        const p2pManager = createP2pManagerStub();
        const { profileManager, profile, evmAddress, peerInfo } =
            createRegisteredProfile(p2pManager);

        const webRTCTransport = new WebRTCTransport(
            createFakeWebRTCChannel() as any,
            p2pManager
        );
        profileManager.updateTransport(evmAddress, webRTCTransport);
        // The upgrade itself already banned - isolate the blacklist/close
        // assertions from that first ban call.
        peerInfo.banCalls.length = 0;

        profileManager.blacklistProfile(profile);
        expect(peerInfo.banCalls).to.deep.equal([true]);
        expect(profile.isBlackListed).to.equal(true);

        profileManager.releaseHolepunchBanOnWebRtcClose(webRTCTransport);

        // Blacklist wins: the WebRTC close must not lift the ban.
        expect(peerInfo.banCalls).to.deep.equal([true]);
    });

    it("ignores a transport close that is not the WebRTC transport", function () {
        const p2pManager = createP2pManagerStub();
        const { profileManager, peerInfo, holepunchTransport } =
            createRegisteredProfile(p2pManager);

        profileManager.releaseHolepunchBanOnWebRtcClose(holepunchTransport);

        expect(peerInfo.banCalls).to.deep.equal([]);
    });
});
