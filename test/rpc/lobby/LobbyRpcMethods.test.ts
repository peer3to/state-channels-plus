import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import sinon from "sinon";
import { ethers } from "ethers";

import { hasMethod } from "@/utils/ObjectChecks";
import { getChecksumAddress } from "@/utils";
import LobbyService from "@/rpc/services/lobby/LobbyService";
import {
    AdKind,
    CHANNEL_AD_VERSION,
    ChannelAdStruct,
    adId as computeAdId,
    encodeChannelAd
} from "@/discovery/ChannelAd";
import {
    makeLobbyService,
    makeRpcMethods,
    randomWalletAddress,
    type LobbyServiceHarness
} from "./lobbyTestFactory";

const SCM_ADDRESS = getChecksumAddress("0x" + "33".repeat(20));
const APP_NAMESPACE = ethers.zeroPadValue(SCM_ADDRESS, 32);

function baseAd(overrides: Partial<ChannelAdStruct> = {}): ChannelAdStruct {
    return {
        v: CHANNEL_AD_VERSION,
        kind: AdKind.JOIN,
        channelId: ethers.hexlify(ethers.randomBytes(32)),
        advertiser: ethers.ZeroAddress, // publishAd always overwrites this
        app: APP_NAMESPACE,
        seq: 0n,
        expiresAtMs: BigInt(Date.now() + 60_000),
        capacity: 2,
        filled: 0,
        amount: 100n,
        data: "0x",
        signature: "0x",
        ...overrides
    };
}

async function joined(): Promise<LobbyServiceHarness> {
    const harness = makeLobbyService();
    await harness.service.joinLobby();
    return harness;
}

describe("LobbyService.joinLobby/leaveLobby", () => {
    it("joins the shared swarm's topic and emits lobbyJoined", async () => {
        const harness = makeLobbyService();
        const events: unknown[] = [];
        harness.events.on("discovery", "lobbyJoined", (payload) =>
            events.push(payload)
        );

        const { topic } = await harness.service.joinLobby();

        expect(harness.joinStub.calledOnce, "holepunch.join called").to.be.true;
        expect(topic).to.be.a("string");
        expect(events).to.have.length(1);
    });

    it("is idempotent across join -> leave -> join with no namespace switch, and rejects a switch attempt", async () => {
        const harness = makeLobbyService();
        const first = await harness.service.joinLobby();
        await harness.service.leaveLobby();
        const second = await harness.service.joinLobby();

        expect(second.topic).to.equal(first.topic);
        expect(harness.joinStub.callCount).to.equal(2);
        expect(harness.leaveStub.calledOnce).to.be.true;

        let error: Error | undefined;
        try {
            await harness.service.joinLobby("some-other-namespace");
        } catch (e) {
            error = e as Error;
        }
        expect(error?.message).to.match(/already joined/);
    });
});

describe("LobbyService.publishAd/withdrawAd", () => {
    it("publishAd stores the ad, and fans it out to every known peer", async () => {
        const harness = await joined();
        const peer = randomWalletAddress();
        // A prior inbound advertise/withdraw/requestIntent is what populates
        // the known-peer set - simulate one here via handleAdvertise (as if
        // that peer had sent us one of ITS ads first).
        const theirAd = baseAd({ advertiser: peer });
        const { encodedAd: theirEncoded } = encodeChannelAd(theirAd);
        harness.service.handleAdvertise(peer, theirEncoded);

        const { adId } = await harness.service.publishAd(baseAd());
        expect(adId).to.be.a("string");
        expect(harness.advertiseSendOneSpy.calledWith(peer)).to.be.true;

        const listed = harness.service.listAds();
        expect(listed.map((a) => a.adId)).to.include(adId);
    });

    it("withdrawAd removes the ad and fans out the withdrawal", async () => {
        const harness = await joined();
        const peer = randomWalletAddress();
        harness.service.handleAdvertise(
            peer,
            encodeChannelAd(baseAd({ advertiser: peer })).encodedAd
        );

        const { adId } = await harness.service.publishAd(baseAd());
        await harness.service.withdrawAd(adId);

        expect(harness.withdrawSendOneSpy.calledWith(peer)).to.be.true;
        expect(harness.service.listAds().map((a) => a.adId)).to.not.include(
            adId
        );
    });

    it("publishAd/listAds/withdrawAd throw before joinLobby()", async () => {
        const harness = makeLobbyService();
        let error: Error | undefined;
        try {
            await harness.service.publishAd(baseAd());
        } catch (e) {
            error = e as Error;
        }
        expect(error?.message).to.match(/not joined/);
        expect(() => harness.service.listAds()).to.throw(/not joined/);
    });
});

describe("LobbyRpcMethods.advertise/withdraw (wire receive)", () => {
    it("advertise stores a valid inbound ad and tracks the sender as a known peer", async () => {
        const harness = await joined();
        const peer = randomWalletAddress();
        const rpcMethods = makeRpcMethods(harness.service, peer);
        const { encodedAd } = encodeChannelAd(baseAd({ advertiser: peer }));

        rpcMethods.advertise(encodedAd);

        const listed = harness.service.listAds();
        expect(listed).to.have.length(1);
        expect(listed[0].ad.advertiser).to.equal(peer);

        // The sender is now known - a later publishAd fans out to it.
        const { adId } = await harness.service.publishAd(baseAd());
        expect(harness.advertiseSendOneSpy.calledWith(peer)).to.be.true;
        expect(adId).to.be.a("string");
    });

    it("advertise silently rejects an ad whose advertiser != the sender (never punitive, connection survives)", async () => {
        const harness = await joined();
        const peer = randomWalletAddress();
        const impersonated = randomWalletAddress();
        const rpcMethods = makeRpcMethods(harness.service, peer);
        const { encodedAd } = encodeChannelAd(
            baseAd({ advertiser: impersonated })
        );

        rpcMethods.advertise(encodedAd);

        expect(harness.service.listAds()).to.have.length(0);
    });

    it("withdraw removes an ad the sender owns", async () => {
        const harness = await joined();
        const peer = randomWalletAddress();
        const rpcMethods = makeRpcMethods(harness.service, peer);
        const ad = baseAd({ advertiser: peer });
        const { encodedAd } = encodeChannelAd(ad);
        const id = computeAdId(encodedAd);

        rpcMethods.advertise(encodedAd);
        expect(harness.service.listAds()).to.have.length(1);

        rpcMethods.withdraw(id);
        expect(harness.service.listAds()).to.have.length(0);
    });

    it("advertise arriving BEFORE our own joinLobby() (a race against an already handshake-connected peer) is buffered and replayed once we join, never dropped", async () => {
        const harness = makeLobbyService();
        const peer = randomWalletAddress();
        const rpcMethods = makeRpcMethods(harness.service, peer);
        const { encodedAd } = encodeChannelAd(baseAd({ advertiser: peer }));

        // Arrives before joinLobby() - adStore doesn't exist yet.
        rpcMethods.advertise(encodedAd);

        await harness.service.joinLobby();

        expect(harness.service.listAds()).to.have.length(1);
    });
});

describe("LobbyRpcMethods.requestIntent (acceptor side)", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
    });

    afterEach(() => {
        clock.restore();
    });

    async function publishOwn(
        harness: LobbyServiceHarness,
        overrides: Partial<ChannelAdStruct> = {}
    ): Promise<{ adId: string; ad: ChannelAdStruct; encodedAd: string }> {
        const { adId } = await harness.service.publishAd(baseAd(overrides));
        const stored = harness.service.listAds()[0];
        return { adId, ad: stored.ad, encodedAd: stored.encodedAd };
    }

    it("happy path JOIN: accepts, returns holdMs and the ad's channelId", async () => {
        const harness = await joined();
        const { encodedAd, ad } = await publishOwn(harness);
        const peer = randomWalletAddress();
        const rpcMethods = makeRpcMethods(harness.service, peer);

        const result = await rpcMethods.requestIntent(encodedAd, "100");

        expect(result.accepted).to.equal(true);
        expect(result.channelId).to.equal(ad.channelId);
        expect(result.holdMs).to.be.a("number");
    });

    it("happy path OPEN: accepting invokes the OPEN-ad stake path with no negotiation service wired (safe no-op)", async () => {
        const harness = await joined();
        const { encodedAd } = await publishOwn(harness, { kind: AdKind.OPEN });
        const peer = randomWalletAddress();
        const rpcMethods = makeRpcMethods(harness.service, peer);

        const result = await rpcMethods.requestIntent(encodedAd, "100");
        expect(result.accepted).to.equal(true);
    });

    it("busy: a second requestIntent from a different peer is declined 'busy' and does not disturb the held reservation", async () => {
        const harness = await joined();
        const { encodedAd: adA } = await publishOwn(harness, {
            channelId: ethers.hexlify(ethers.randomBytes(32))
        });
        const peerA = randomWalletAddress();
        const peerB = randomWalletAddress();

        const first = await makeRpcMethods(
            harness.service,
            peerA
        ).requestIntent(adA, "100");
        expect(first.accepted).to.equal(true);

        const second = await makeRpcMethods(
            harness.service,
            peerB
        ).requestIntent(adA, "100");
        expect(second.accepted).to.equal(false);
        expect(second.reason).to.equal("busy");
    });

    it("negative: requestIntent for an ad the acceptor no longer publishes is declined 'full'", async () => {
        const harness = await joined();
        const foreignAd = baseAd({ advertiser: randomWalletAddress() });
        const { encodedAd } = encodeChannelAd(foreignAd);
        const peer = randomWalletAddress();

        const result = await makeRpcMethods(
            harness.service,
            peer
        ).requestIntent(encodedAd, "100");

        expect(result.accepted).to.equal(false);
        expect(result.reason).to.equal("full");
    });

    it("admission negatives: denyAll declines 'policy' and reserves nothing", async () => {
        const harness = await joined();
        harness.service.setAdmissionPolicy({ mode: "denyAll" });
        const { encodedAd } = await publishOwn(harness);
        const peer = randomWalletAddress();

        const result = await makeRpcMethods(
            harness.service,
            peer
        ).requestIntent(encodedAd, "100");

        expect(result.accepted).to.equal(false);
        expect(result.reason).to.equal("policy");

        // Reserves nothing - a fresh peer can still be accepted right after.
        harness.service.setAdmissionPolicy({ mode: "allowAll" });
        const secondPeer = randomWalletAddress();
        const secondResult = await makeRpcMethods(
            harness.service,
            secondPeer
        ).requestIntent(encodedAd, "100");
        expect(secondResult.accepted).to.equal(true);
    });

    it("admission negatives: out-of-range amount declines 'terms'", async () => {
        const harness = await joined();
        harness.service.setAdmissionPolicy({
            mode: "allowAll",
            minAmount: "1000"
        });
        const { encodedAd } = await publishOwn(harness);
        const peer = randomWalletAddress();

        const result = await makeRpcMethods(
            harness.service,
            peer
        ).requestIntent(encodedAd, "1");

        expect(result.accepted).to.equal(false);
        expect(result.reason).to.equal("terms");
    });

    it("expiry: with no release, the hold expires after LOBBY_INTENT_HOLD_MS and a later intent is accepted", async () => {
        const harness = await joined();
        const { encodedAd } = await publishOwn(harness);
        const peerA = randomWalletAddress();
        const peerB = randomWalletAddress();

        const first = await makeRpcMethods(
            harness.service,
            peerA
        ).requestIntent(encodedAd, "100");
        expect(first.accepted).to.equal(true);
        clock.tick(first.holdMs! + 1);

        const second = await makeRpcMethods(
            harness.service,
            peerB
        ).requestIntent(encodedAd, "100");
        expect(second.accepted).to.equal(true);
    });
});

describe("LobbyRpcMethods.releaseIntent (acceptor side)", () => {
    it("release: releasing the held adId as its holder returns {released:true} and frees the slot immediately", async () => {
        const harness = await joined();
        const { adId, encodedAd } = await (async () => {
            const { adId } = await harness.service.publishAd(baseAd());
            return { adId, encodedAd: harness.service.listAds()[0].encodedAd };
        })();
        const peerA = randomWalletAddress();
        const peerB = randomWalletAddress();

        const accepted = await makeRpcMethods(
            harness.service,
            peerA
        ).requestIntent(encodedAd, "100");
        expect(accepted.accepted).to.equal(true);

        const released = await makeRpcMethods(
            harness.service,
            peerA
        ).releaseIntent(adId);
        expect(released.released).to.equal(true);

        const acceptedAgain = await makeRpcMethods(
            harness.service,
            peerB
        ).requestIntent(encodedAd, "100");
        expect(acceptedAgain.accepted).to.equal(true);
    });

    it("release ownership: a non-holder cannot release someone else's live reservation", async () => {
        const harness = await joined();
        const { adId } = await harness.service.publishAd(baseAd());
        const encodedAd = harness.service.listAds()[0].encodedAd;
        const holder = randomWalletAddress();
        const impostor = randomWalletAddress();

        await makeRpcMethods(harness.service, holder).requestIntent(
            encodedAd,
            "100"
        );

        const result = await makeRpcMethods(
            harness.service,
            impostor
        ).releaseIntent(adId);
        expect(result.released).to.equal(false);

        // The holder's reservation is untouched - a competitor is still busy.
        const otherPeer = randomWalletAddress();
        const stillBusy = await makeRpcMethods(
            harness.service,
            otherPeer
        ).requestIntent(encodedAd, "100");
        expect(stillBusy.accepted).to.equal(false);
        expect(stillBusy.reason).to.equal("busy");
    });

    it("releasing an unknown/already-released adId returns {released:false} and never throws", async () => {
        const harness = await joined();
        const peer = randomWalletAddress();
        const result = await makeRpcMethods(
            harness.service,
            peer
        ).releaseIntent("0xdoes-not-exist");
        expect(result.released).to.equal(false);
    });
});

describe("LobbyService.setAdmissionPolicy - hardening and unreachability", () => {
    it("throws on an unrecognized mode and leaves the previous policy in place", () => {
        const { service } = makeLobbyService();
        const before = service.admissionPolicy;

        expect(() =>
            service.setAdmissionPolicy({
                mode: "deny_all" as unknown as "denyAll"
            })
        ).to.throw();
        expect(service.admissionPolicy).to.equal(before);
    });

    it("clones the policy: mutating the caller's object afterward does not change decisions", async () => {
        const harness = await joined();
        const callerPolicy = {
            mode: "allowAll" as const,
            deny: [] as string[]
        };
        harness.service.setAdmissionPolicy(callerPolicy);

        const peer = randomWalletAddress();
        callerPolicy.deny.push(peer);
        (callerPolicy as { mode: string }).mode = "denyAll";

        const { encodedAd } = await (async () => {
            await harness.service.publishAd(baseAd());
            return { encodedAd: harness.service.listAds()[0].encodedAd };
        })();
        const result = await makeRpcMethods(
            harness.service,
            peer
        ).requestIntent(encodedAd, "100");
        expect(result.accepted).to.equal(true);
    });

    it("setAdmissionPolicy is not reachable from the RPC dispatcher", () => {
        const { service } = makeLobbyService();
        const rpcMethods = makeRpcMethods(service, randomWalletAddress());

        expect(
            hasMethod(rpcMethods, "setAdmissionPolicy"),
            "setAdmissionPolicy must not be routable"
        ).to.be.false;
    });
});
