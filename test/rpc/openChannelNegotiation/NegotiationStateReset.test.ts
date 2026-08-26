import { expect } from "chai";
import sinon from "sinon";

import { getChecksumAddress } from "@/utils";
import { hasMethod } from "@/utils/ObjectChecks";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import OpenChannelNegotiationRpcMethods from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods";
import { NEGOTIATION_TIMEOUT_MS } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type ATransport from "@/transport/ATransport";
import {
    makeNegotiationService,
    makeRpcMethods
} from "./negotiationTestFactory";

/**
 * Unit coverage for setStakeAmount + resetForNewChannel: they are pure
 * *Service state operations. See negotiationTestFactory.ts for why the
 * p2pManager stand-in is a narrow cast rather than a live P2PManager.
 */
const PEER_ADDRESS = getChecksumAddress("0x" + "11".repeat(20));

function makeService(): OpenChannelNegotiationService {
    return makeNegotiationService().service;
}

describe("OpenChannelNegotiationService - setStakeAmount", function () {
    it("sets myAmount when valid and not negotiating", function () {
        const service = makeService();
        service.setStakeAmount(1000);
        expect(service.state.myAmount).to.equal(1000);
    });

    const invalidAmounts: Array<[string, number]> = [
        ["zero", 0],
        ["negative", -1],
        ["non-integer", 1.5],
        ["NaN", NaN],
        ["above MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 1]
    ];

    for (const [label, amount] of invalidAmounts) {
        it(`throws on ${label} and leaves myAmount unchanged`, function () {
            const service = makeService();
            const before = service.state.myAmount;
            expect(() => service.setStakeAmount(amount)).to.throw();
            expect(service.state.myAmount).to.equal(before);
        });
    }

    it("throws while negotiatingWith is set and leaves myAmount unchanged", function () {
        const service = makeService();
        const before = service.state.myAmount;
        service.state.negotiatingWith = PEER_ADDRESS;
        expect(() => service.setStakeAmount(1000)).to.throw();
        expect(service.state.myAmount).to.equal(before);
    });
});

describe("OpenChannelNegotiationService - resetForNewChannel", function () {
    let clock: sinon.SinonFakeTimers;

    beforeEach(function () {
        clock = sinon.useFakeTimers();
    });

    afterEach(function () {
        clock.restore();
    });

    function armCompletedNegotiationState(
        service: OpenChannelNegotiationService
    ): void {
        service.state.channelOpened = true;
        service.state.negotiatingWith = PEER_ADDRESS;
        service.state.initiatedByMe = true;
        service.state.theirAmount = 700;
        service.state.proposalSent = true;
        service.state.receivedProposal = {
            encodedOpenChannel: "0x1234",
            lowerSignature: "0x5678"
        };
        service.state.startedAtMs = Date.now();
        service.startTimeout();
    }

    it("clears exactly the 8 negotiation fields while preserving myAmount", function () {
        const service = makeService();
        service.state.myAmount = 1234;
        armCompletedNegotiationState(service);

        service.resetForNewChannel();

        expect(service.state.myAmount, "myAmount").to.equal(1234);
        expect(service.state.channelOpened, "channelOpened").to.equal(false);
        expect(service.state.negotiatingWith, "negotiatingWith").to.be
            .undefined;
        expect(service.state.initiatedByMe, "initiatedByMe").to.be.undefined;
        expect(service.state.theirAmount, "theirAmount").to.be.undefined;
        expect(service.state.proposalSent, "proposalSent").to.be.undefined;
        expect(service.state.receivedProposal, "receivedProposal").to.be
            .undefined;
        expect(service.state.startedAtMs, "startedAtMs").to.be.undefined;
        expect(service.state.timeoutHandle, "timeoutHandle").to.be.undefined;
    });

    it("clears the pending timer: no timer remains armed after reset", function () {
        const service = makeService();
        armCompletedNegotiationState(service);

        expect(clock.countTimers(), "timer armed before reset").to.equal(1);
        service.resetForNewChannel();
        expect(clock.countTimers(), "timer armed after reset").to.equal(0);
    });

    it("is idempotent: calling it twice in a row does not throw", function () {
        const service = makeService();
        armCompletedNegotiationState(service);

        expect(() => {
            service.resetForNewChannel();
            service.resetForNewChannel();
        }).to.not.throw();

        expect(service.state.channelOpened).to.equal(false);
        expect(service.state.negotiatingWith).to.be.undefined;
        expect(clock.countTimers()).to.equal(0);
    });

    it("a timer left over from an abandoned negotiation cannot fire against the new negotiation early (retry ladder)", async function () {
        const meAddress = getChecksumAddress("0x" + "aa".repeat(20));
        const oldPeer = getChecksumAddress("0x" + "bb".repeat(20));
        const newPeer = getChecksumAddress("0x" + "cc".repeat(20));
        const { service, abortSpy, sendOneSpy } =
            makeNegotiationService(meAddress);

        // Arm the abandoned negotiation's timer, then let some time pass
        // before abandoning it - so a leaked (not truly cleared) timer would
        // fire noticeably earlier than the new negotiation's own deadline.
        service.state.negotiatingWith = oldPeer;
        service.startTimeout();
        clock.tick(NEGOTIATION_TIMEOUT_MS - 1000);

        service.resetForNewChannel();
        expect(
            clock.countTimers(),
            "no timer survives resetForNewChannel"
        ).to.equal(0);
        // resetForNewChannel's own abandon-abort to oldPeer (stopgap) —
        // assert it, then clear spy history so the assertions below are only
        // about the *new* negotiation's wire traffic.
        expect(
            abortSpy.calledOnceWith("abandoned"),
            "abandon abort sent to old peer"
        ).to.be.true;
        expect(sendOneSpy.calledOnceWith(oldPeer), "abandon abort target").to.be
            .true;
        abortSpy.resetHistory();
        sendOneSpy.resetHistory();

        await service.beginNegotiation(newPeer);
        expect(
            clock.countTimers(),
            "exactly one timer for the new negotiation"
        ).to.equal(1);

        // Advance past where the stale timer would have fired had it leaked,
        // but well before the new negotiation's own NEGOTIATION_TIMEOUT_MS
        // deadline.
        clock.tick(1000);
        expect(abortSpy.notCalled, "no premature abort against the new peer").to
            .be.true;
        expect(
            service.state.negotiatingWith,
            "new negotiation still active"
        ).to.equal(newPeer);

        // The new negotiation's own timer legitimately fires at its full window.
        clock.tick(NEGOTIATION_TIMEOUT_MS - 1000);
        expect(abortSpy.calledOnceWith("timeout"), "legitimate timeout abort")
            .to.be.true;
        expect(sendOneSpy.calledOnceWith(newPeer), "abort sent to new peer").to
            .be.true;
    });
});

describe("OpenChannelNegotiationRpcMethods.abort - sender guard", function () {
    // This guard is load-bearing since resetForNewChannel's stopgap
    // (and the ordinary timeout/deadline paths) now depend on abort() only
    // ever resetting state on behalf of the peer we're actually negotiating
    // with — deleting the `negotiatingWith === from` check would let ANY
    // peer wipe our in-flight negotiation.
    const partner = getChecksumAddress("0x" + "dd".repeat(20));
    const stranger = getChecksumAddress("0x" + "ee".repeat(20));

    it("leaves state untouched when the sender is not the current partner", function () {
        const { service } = makeNegotiationService();
        service.state.negotiatingWith = partner;
        service.state.theirAmount = 700;

        const rpcMethods = makeRpcMethods(service, stranger);
        rpcMethods.abort("stranger says abort");

        expect(service.state.negotiatingWith, "negotiatingWith").to.equal(
            partner
        );
        expect(service.state.theirAmount, "theirAmount").to.equal(700);
    });

    it("resets when the sender is the current partner", function () {
        const { service } = makeNegotiationService();
        service.state.negotiatingWith = partner;
        service.state.theirAmount = 700;

        const rpcMethods = makeRpcMethods(service, partner);
        rpcMethods.abort("partner says abort");

        expect(service.state.negotiatingWith, "negotiatingWith").to.be
            .undefined;
        expect(service.state.theirAmount, "theirAmount").to.be.undefined;
    });
});

describe("OpenChannelNegotiationRpcMethods - wire unreachability", function () {
    it("setStakeAmount and resetForNewChannel are not dispatchable over the wire", function () {
        const service = makeService();
        const transport = {
            peerAddress: PEER_ADDRESS
        } as unknown as ATransport;
        const rpcMethods = new OpenChannelNegotiationRpcMethods(
            transport,
            service
        );

        expect(
            hasMethod(rpcMethods, "setStakeAmount"),
            "setStakeAmount must not be routable"
        ).to.be.false;
        expect(
            hasMethod(rpcMethods, "resetForNewChannel"),
            "resetForNewChannel must not be routable"
        ).to.be.false;
    });
});
