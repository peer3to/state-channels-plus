import { expect } from "chai";
import sinon from "sinon";
import { Wallet } from "ethers";

import { getChecksumAddress } from "@/utils";
import { hasMethod } from "@/utils/ObjectChecks";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import {
    makeNegotiationService,
    makeRpcMethods,
    type NegotiationServiceHarness
} from "./negotiationTestFactory";

/**
 * D1: negotiateRequest consults the declarative AdmissionPolicy
 * between the existing busy check and the adoption block. A denied
 * request declines via the existing non-punitive abort("decline:<reason>")
 * wire path and leaves state byte-identical to before — no blacklist, no
 * timer, no adoption. See negotiationTestFactory.ts for why the p2pManager
 * stand-in is a narrow typed cast rather than a live P2PManager.
 */

// A checksum-formatted address guaranteed larger than any real wallet
// address, so setting it as "me" keeps us the higher participant and
// `maybeProgress` never enters the lower-address co-sign branch (which needs
// a real Clock/signer) — this suite only cares about the admission decision.
const ME_ADDRESS = getChecksumAddress("0x" + "ff".repeat(20));
const STUB_CHANNEL_ID = new Uint8Array(32).fill(7);

function makeService(meAddress: string): NegotiationServiceHarness {
    return makeNegotiationService(meAddress, STUB_CHANNEL_ID);
}

function channelIdHex(): string {
    return "0x" + Buffer.from(STUB_CHANNEL_ID).toString("hex");
}

function assertNoResidue(service: OpenChannelNegotiationService): void {
    expect(service.state.negotiatingWith, "negotiatingWith").to.be.undefined;
    expect(service.state.initiatedByMe, "initiatedByMe").to.be.undefined;
    expect(service.state.theirAmount, "theirAmount").to.be.undefined;
    expect(service.state.startedAtMs, "startedAtMs").to.be.undefined;
    expect(service.state.timeoutHandle, "timeoutHandle").to.be.undefined;
}

describe("OpenChannelNegotiationRpcMethods.negotiateRequest - admission policy (D1)", function () {
    let clock: sinon.SinonFakeTimers;

    beforeEach(function () {
        clock = sinon.useFakeTimers();
    });

    afterEach(function () {
        clock.restore();
    });

    it("mode allowAll (default): unconditional acceptance, negotiateAccept still sent", async function () {
        const { service, abortSpy, blacklistSpy, negotiateAcceptSendOneSpy } =
            makeService(ME_ADDRESS);
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 500);

        expect(abortSpy.notCalled, "abort should not be sent").to.be.true;
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
        expect(
            negotiateAcceptSendOneSpy.calledOnceWith(peer),
            "negotiateAccept sent"
        ).to.be.true;
        expect(service.state.negotiatingWith, "negotiatingWith").to.equal(peer);
        expect(service.state.theirAmount, "theirAmount").to.equal(500);
        expect(service.state.timeoutHandle, "timer armed").to.not.be.undefined;
    });

    it("mode denyAll: declines with abort(decline:policy), no accept, no adoption, no timer, no blacklist", async function () {
        const {
            service,
            abortSpy,
            sendOneSpy,
            blacklistSpy,
            negotiateAcceptSendOneSpy
        } = makeService(ME_ADDRESS);
        service.setAdmissionPolicy({ mode: "denyAll" });

        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 500);

        expect(abortSpy.calledOnceWith("decline:policy"), "abort reason").to.be
            .true;
        expect(sendOneSpy.calledOnceWith(peer), "abort sent to peer").to.be
            .true;
        expect(negotiateAcceptSendOneSpy.notCalled, "no accept sent").to.be
            .true;
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
        assertNoResidue(service);
    });

    const denyListCasings: Array<[string, (address: string) => string]> = [
        ["checksum-case", (a) => a],
        ["lowercase", (a) => a.toLowerCase()],
        // All-uppercase hex digits (with a lowercase "0x" prefix) is a valid
        // ethers address that skips checksum verification entirely — unlike
        // an arbitrary partial-case string, which ethers rejects as an
        // invalid checksum.
        ["mixed-case", (a) => a.toUpperCase().replace("0X", "0x")]
    ];

    for (const [label, transform] of denyListCasings) {
        it(`deny list containing the sender (${label}): denied with reason policy`, async function () {
            const { service, abortSpy, sendOneSpy, blacklistSpy } =
                makeService(ME_ADDRESS);
            const peerWallet = Wallet.createRandom();
            const peer = getChecksumAddress(peerWallet.address);
            service.setAdmissionPolicy({
                mode: "allowAll",
                deny: [transform(peer)]
            });

            const rpcMethods = makeRpcMethods(service, peer);
            await rpcMethods.negotiateRequest(channelIdHex(), 500);

            expect(abortSpy.calledOnceWith("decline:policy"), "abort reason").to
                .be.true;
            expect(sendOneSpy.calledOnceWith(peer), "abort sent to peer").to.be
                .true;
            expect(blacklistSpy.notCalled, "blacklist should not be called").to
                .be.true;
            assertNoResidue(service);
        });
    }

    it("allow list not containing the sender: denied with reason policy", async function () {
        const { service, abortSpy, blacklistSpy } = makeService(ME_ADDRESS);
        const allowedWallet = Wallet.createRandom();
        service.setAdmissionPolicy({
            mode: "allowAll",
            allow: [getChecksumAddress(allowedWallet.address)]
        });

        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 500);

        expect(abortSpy.calledOnceWith("decline:policy"), "abort reason").to.be
            .true;
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
        assertNoResidue(service);
    });

    it("allow list containing the sender: accepted", async function () {
        const { service, abortSpy, negotiateAcceptSendOneSpy } =
            makeService(ME_ADDRESS);
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        service.setAdmissionPolicy({ mode: "allowAll", allow: [peer] });

        const rpcMethods = makeRpcMethods(service, peer);
        await rpcMethods.negotiateRequest(channelIdHex(), 500);

        expect(abortSpy.notCalled, "abort should not be sent").to.be.true;
        expect(
            negotiateAcceptSendOneSpy.calledOnceWith(peer),
            "negotiateAccept sent"
        ).to.be.true;
        expect(service.state.negotiatingWith, "negotiatingWith").to.equal(peer);
    });

    it("amount below minAmount: denied with reason terms", async function () {
        const { service, abortSpy, blacklistSpy } = makeService(ME_ADDRESS);
        service.setAdmissionPolicy({
            mode: "allowAll",
            minAmount: "100",
            maxAmount: "1000"
        });
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 99);

        expect(abortSpy.calledOnceWith("decline:terms"), "abort reason").to.be
            .true;
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
        assertNoResidue(service);
    });

    it("amount above maxAmount: denied with reason terms", async function () {
        const { service, abortSpy, blacklistSpy } = makeService(ME_ADDRESS);
        service.setAdmissionPolicy({
            mode: "allowAll",
            minAmount: "100",
            maxAmount: "1000"
        });
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 1001);

        expect(abortSpy.calledOnceWith("decline:terms"), "abort reason").to.be
            .true;
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
        assertNoResidue(service);
    });

    it("amount exactly at the lower bound: accepted (inclusive)", async function () {
        const { service, abortSpy, negotiateAcceptSendOneSpy } =
            makeService(ME_ADDRESS);
        service.setAdmissionPolicy({
            mode: "allowAll",
            minAmount: "100",
            maxAmount: "1000"
        });
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 100);

        expect(abortSpy.notCalled, "abort should not be sent").to.be.true;
        expect(
            negotiateAcceptSendOneSpy.calledOnceWith(peer),
            "negotiateAccept sent"
        ).to.be.true;
        expect(service.state.negotiatingWith, "negotiatingWith").to.equal(peer);
    });

    it("amount exactly at the upper bound: accepted (inclusive)", async function () {
        const { service, abortSpy, negotiateAcceptSendOneSpy } =
            makeService(ME_ADDRESS);
        service.setAdmissionPolicy({
            mode: "allowAll",
            minAmount: "100",
            maxAmount: "1000"
        });
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 1000);

        expect(abortSpy.notCalled, "abort should not be sent").to.be.true;
        expect(
            negotiateAcceptSendOneSpy.calledOnceWith(peer),
            "negotiateAccept sent"
        ).to.be.true;
        expect(service.state.negotiatingWith, "negotiatingWith").to.equal(peer);
    });

    it("negative: a denied peer can immediately be accepted after setAdmissionPolicy({mode: 'allowAll'}) with no residue and no blacklist", async function () {
        const { service, abortSpy, blacklistSpy, negotiateAcceptSendOneSpy } =
            makeService(ME_ADDRESS);
        service.setAdmissionPolicy({ mode: "denyAll" });

        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        await rpcMethods.negotiateRequest(channelIdHex(), 500);
        assertNoResidue(service);
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;

        service.setAdmissionPolicy({ mode: "allowAll" });
        await rpcMethods.negotiateRequest(channelIdHex(), 500);

        expect(abortSpy.calledOnce, "only the first request was aborted").to.be
            .true;
        expect(
            negotiateAcceptSendOneSpy.calledOnceWith(peer),
            "negotiateAccept sent on retry"
        ).to.be.true;
        expect(service.state.negotiatingWith, "negotiatingWith").to.equal(peer);
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
    });

    it("busy check runs BEFORE the admission consult: a second peer gets negotiateBusy, not decline:policy, even under denyAll", async function () {
        const {
            service,
            abortSpy,
            negotiateBusySendOneSpy,
            negotiateAcceptSendOneSpy
        } = makeService(ME_ADDRESS);
        service.setAdmissionPolicy({ mode: "denyAll" });

        const peerAWallet = Wallet.createRandom();
        const peerA = getChecksumAddress(peerAWallet.address);
        service.state.negotiatingWith = peerA;

        const peerBWallet = Wallet.createRandom();
        const peerB = getChecksumAddress(peerBWallet.address);
        const rpcMethods = makeRpcMethods(service, peerB);

        await rpcMethods.negotiateRequest(channelIdHex(), 500);

        expect(
            negotiateBusySendOneSpy.calledOnceWith(peerB),
            "negotiateBusy sent to the second peer"
        ).to.be.true;
        expect(
            abortSpy.notCalled,
            "no decline sent — busy short-circuits first"
        ).to.be.true;
        expect(negotiateAcceptSendOneSpy.notCalled, "no accept sent").to.be
            .true;
        expect(
            service.state.negotiatingWith,
            "negotiatingWith unchanged"
        ).to.equal(peerA);
    });

    it("asymmetric deny: denying a peer we are ALREADY negotiating with resets our slot so we don't answer everyone else negotiateBusy for the rest of the timeout", async function () {
        const { service, abortSpy, sendOneSpy } = makeService(ME_ADDRESS);

        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        service.state.negotiatingWith = peer;
        service.state.initiatedByMe = false;
        service.startTimeout();
        expect(clock.countTimers(), "timer armed before deny").to.equal(1);

        // Narrow the policy mid-negotiation (e.g. terms tightened) so the
        // peer we already hold the single slot for is now denied.
        service.setAdmissionPolicy({ mode: "denyAll" });

        const rpcMethods = makeRpcMethods(service, peer);
        await rpcMethods.negotiateRequest(channelIdHex(), 500);

        expect(abortSpy.calledOnceWith("decline:policy"), "abort reason").to.be
            .true;
        expect(sendOneSpy.calledOnceWith(peer), "abort sent to peer").to.be
            .true;
        assertNoResidue(service);
        expect(clock.countTimers(), "no timer survives the deny").to.equal(0);
    });

    describe("amount validation (closes the DEFAULT-policy wedge)", function () {
        const badAmounts: Array<[string, number]> = [
            ["NaN", NaN],
            ["Infinity", Infinity],
            ["-Infinity", -Infinity],
            ["a float", 1.5],
            ["negative", -1],
            ["above MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 1]
        ];

        for (const [label, amount] of badAmounts) {
            it(`${label}: denied with reason terms under the DEFAULT allowAll policy, no state mutation`, async function () {
                const { service, abortSpy, blacklistSpy } =
                    makeService(ME_ADDRESS);
                const peerWallet = Wallet.createRandom();
                const peer = getChecksumAddress(peerWallet.address);
                const rpcMethods = makeRpcMethods(service, peer);

                await rpcMethods.negotiateRequest(channelIdHex(), amount);

                expect(abortSpy.calledOnceWith("decline:terms"), "abort reason")
                    .to.be.true;
                expect(blacklistSpy.notCalled, "blacklist should not be called")
                    .to.be.true;
                assertNoResidue(service);
            });
        }

        it("zero is a valid amount: accepted", async function () {
            const { service, abortSpy, negotiateAcceptSendOneSpy } =
                makeService(ME_ADDRESS);
            const peerWallet = Wallet.createRandom();
            const peer = getChecksumAddress(peerWallet.address);
            const rpcMethods = makeRpcMethods(service, peer);

            await rpcMethods.negotiateRequest(channelIdHex(), 0);

            expect(abortSpy.notCalled, "abort should not be sent").to.be.true;
            expect(
                negotiateAcceptSendOneSpy.calledOnceWith(peer),
                "negotiateAccept sent"
            ).to.be.true;
        });

        it("an invalid amount from our current partner resets our slot (same asymmetric-deny fix as the policy path)", async function () {
            const { service, abortSpy, sendOneSpy } = makeService(ME_ADDRESS);
            const peerWallet = Wallet.createRandom();
            const peer = getChecksumAddress(peerWallet.address);
            service.state.negotiatingWith = peer;
            service.state.initiatedByMe = false;
            service.startTimeout();

            const rpcMethods = makeRpcMethods(service, peer);
            await rpcMethods.negotiateRequest(channelIdHex(), NaN);

            expect(abortSpy.calledOnceWith("decline:terms"), "abort reason").to
                .be.true;
            expect(sendOneSpy.calledOnceWith(peer), "abort sent to peer").to.be
                .true;
            assertNoResidue(service);
            expect(clock.countTimers(), "no timer survives the deny").to.equal(
                0
            );
        });
    });
});

describe("OpenChannelNegotiationRpcMethods - setAdmissionPolicy unreachability (D1)", function () {
    it("setAdmissionPolicy is not reachable from the RPC dispatcher", function () {
        const { service } = makeService(ME_ADDRESS);
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        const rpcMethods = makeRpcMethods(service, peer);

        expect(
            hasMethod(rpcMethods, "setAdmissionPolicy"),
            "setAdmissionPolicy must not be routable"
        ).to.be.false;
    });
});

describe("OpenChannelNegotiationService.setAdmissionPolicy - hardening", function () {
    it("throws on an unrecognized mode and leaves the previous policy in place", function () {
        const { service } = makeService(ME_ADDRESS);
        const before = service.admissionPolicy;

        expect(() =>
            service.setAdmissionPolicy({
                mode: "deny_all" as unknown as "denyAll"
            })
        ).to.throw();
        expect(service.admissionPolicy, "policy unchanged").to.equal(before);
    });

    it("clones the policy: mutating the caller's object after the call does not change decisions", async function () {
        const clock = sinon.useFakeTimers();
        try {
            const { service, abortSpy } = makeService(ME_ADDRESS);
            const peerWallet = Wallet.createRandom();
            const peer = getChecksumAddress(peerWallet.address);

            const callerPolicy = {
                mode: "allowAll" as const,
                deny: [] as string[]
            };
            service.setAdmissionPolicy(callerPolicy);
            // Mutate the caller's own object after handing it to the service.
            callerPolicy.deny.push(peer);
            (callerPolicy as { mode: string }).mode = "denyAll";

            const rpcMethods = makeRpcMethods(service, peer);
            await rpcMethods.negotiateRequest(channelIdHex(), 500);

            expect(
                abortSpy.notCalled,
                "decision unaffected by the later mutation"
            ).to.be.true;
        } finally {
            clock.restore();
        }
    });
});
