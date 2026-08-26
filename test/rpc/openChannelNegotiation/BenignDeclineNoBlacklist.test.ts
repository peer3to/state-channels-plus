import { expect } from "chai";
import sinon from "sinon";
import { Wallet, type HDNodeWallet, type Provider } from "ethers";

import Clock from "@/Clock";
import { SignatureUtils, Codec, Type, getChecksumAddress } from "@/utils";
import OpenChannelNegotiationService from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationService";
import { getOpenChannelProposalMismatch } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { createOpenChannelTestObject } from "../../test_utils/testHelpers";
import {
    makeNegotiationService,
    makeRpcMethods,
    type NegotiationServiceHarness
} from "./negotiationTestFactory";

/**
 * The two benign openProposal rejections ("no negotiation in
 * progress", "no negotiated amount") must decline via the non-punitive
 * abort wire path and reset cleanly, never blacklist. The three fraud-path
 * rejections (isLower, invalid lower signature, terms mismatch) must stay
 * punitive. Also covers the paired hardening: an unsolicited openProposal
 * must never adopt the sender as negotiatingWith.
 *
 * See negotiationTestFactory.ts for why the p2pManager stand-in is a narrow
 * typed cast rather than a live P2PManager.
 */

// A checksum-formatted address guaranteed smaller than any real wallet
// address, so setting it as "me" makes any counterpart the lower address.
const MIN_ADDRESS = getChecksumAddress("0x" + "00".repeat(19) + "01");
// A checksum-formatted address guaranteed larger than any real wallet
// address, so setting it as "me" makes any counterpart the lower address.
const MAX_ADDRESS = getChecksumAddress("0x" + "ff".repeat(20));

// Distinct from the default channelId createOpenChannelTestObject() derives,
// so a proposal built with the default object mismatches this stub's
// channelId (used to exercise the "terms mismatch" fraud path).
const STUB_CHANNEL_ID = new Uint8Array(32).fill(7);

function makeService(meAddress: string): NegotiationServiceHarness {
    return makeNegotiationService(meAddress, STUB_CHANNEL_ID);
}

/** Builds and signs an OpenChannelStruct with the given signer's wallet. */
async function signProposal(
    signerWallet: HDNodeWallet,
    participants: [string, string]
): Promise<{ encodedOpenChannel: string; lowerSignature: string }> {
    const openChannel = createOpenChannelTestObject(participants);
    const { encoded, signature } = await SignatureUtils.signOpenChannel(
        openChannel,
        signerWallet
    );
    return {
        encodedOpenChannel: encoded.toString(),
        lowerSignature: signature.toString()
    };
}

function assertFullReset(service: OpenChannelNegotiationService): void {
    expect(service.state.negotiatingWith, "negotiatingWith").to.be.undefined;
    expect(service.state.initiatedByMe, "initiatedByMe").to.be.undefined;
    expect(service.state.theirAmount, "theirAmount").to.be.undefined;
    expect(service.state.proposalSent, "proposalSent").to.be.undefined;
    expect(service.state.receivedProposal, "receivedProposal").to.be.undefined;
    expect(service.state.startedAtMs, "startedAtMs").to.be.undefined;
    expect(service.state.timeoutHandle, "timeoutHandle").to.be.undefined;
}

describe("OpenChannelNegotiationService.openProposal - benign decline (D2)", function () {
    it("no negotiated amount: declines via abort, never blacklists, and clears all 8 fields", async function () {
        const { service, abortSpy, sendOneSpy, blacklistSpy } =
            makeService(MAX_ADDRESS);
        service.state.myAmount = 500;
        service.state.channelOpened = false;

        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        service.state.negotiatingWith = peer;
        // theirAmount intentionally left unset.

        const { encodedOpenChannel, lowerSignature } = await signProposal(
            peerWallet,
            [MAX_ADDRESS, peer]
        );

        await service.openProposal(peer, encodedOpenChannel, lowerSignature);

        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
        expect(abortSpy.calledOnce, "abort should be sent once").to.be.true;
        expect(abortSpy.firstCall.args[0]).to.match(/^decline:/);
        expect(sendOneSpy.calledOnceWith(peer), "abort sent to peer").to.be
            .true;

        expect(service.state.myAmount, "myAmount").to.equal(500);
        expect(service.state.channelOpened, "channelOpened").to.equal(false);
        assertFullReset(service);
    });

    it("after a benign decline, the same two peers can start a fresh negotiation with no residue", async function () {
        const clock = sinon.useFakeTimers();
        try {
            const { service } = makeService(MAX_ADDRESS);
            const peerWallet = Wallet.createRandom();
            const peer = getChecksumAddress(peerWallet.address);
            service.state.negotiatingWith = peer;

            const { encodedOpenChannel, lowerSignature } = await signProposal(
                peerWallet,
                [MAX_ADDRESS, peer]
            );
            await service.openProposal(
                peer,
                encodedOpenChannel,
                lowerSignature
            );
            assertFullReset(service);

            await service.beginNegotiation(peer);

            expect(service.state.negotiatingWith, "negotiatingWith").to.equal(
                peer
            );
            expect(service.state.initiatedByMe, "initiatedByMe").to.equal(true);
            expect(service.state.timeoutHandle, "timeoutHandle").to.not.be
                .undefined;
        } finally {
            clock.restore();
        }
    });
});

describe("OpenChannelNegotiationRpcMethods.openProposal - unsolicited proposal (D2 hardening)", function () {
    it("declines with abort(decline:policy), adopts no negotiation partner, arms no timer, writes no receivedProposal, never blacklists", async function () {
        const { service, abortSpy, sendOneSpy, blacklistSpy } =
            makeService(MAX_ADDRESS);
        const strangerWallet = Wallet.createRandom();
        const stranger = getChecksumAddress(strangerWallet.address);
        const rpcMethods = makeRpcMethods(service, stranger);

        const { encodedOpenChannel, lowerSignature } = await signProposal(
            strangerWallet,
            [MAX_ADDRESS, stranger]
        );

        await rpcMethods.openProposal(encodedOpenChannel, lowerSignature);

        expect(service.state.negotiatingWith, "negotiatingWith").to.be
            .undefined;
        expect(service.state.timeoutHandle, "timeoutHandle").to.be.undefined;
        expect(service.state.receivedProposal, "receivedProposal").to.be
            .undefined;
        expect(blacklistSpy.notCalled, "blacklist should not be called").to.be
            .true;
        expect(abortSpy.calledOnceWith("decline:policy"), "abort reason").to.be
            .true;
        expect(sendOneSpy.calledOnceWith(stranger), "abort sent to stranger").to
            .be.true;
    });
});

describe("OpenChannelNegotiationService.openProposal - fraud paths stay punitive (regression)", function () {
    before(async function () {
        // The terms-mismatch path reads Clock.getTimeInSeconds() to bound the
        // proposal deadline. A single-block synthetic provider is enough to
        // sync it without a real chain: block 0 keeps syncClock's recursive
        // averaging path from running.
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const fakeProvider = {
            getBlock: async () => ({ number: 0, timestamp: currentTimestamp })
        } as unknown as Provider;
        await Clock.init(fakeProvider);
    });

    after(function () {
        // Clock is a process-wide singleton; leaving it initialized with this
        // fake provider would leak into any test file sharing this process
        // (e.g. the legacy in-process `yarn test` run). Force a fresh
        // uninitialized state so the next real Clock.init() re-syncs against
        // its own provider instead of silently reusing this stub.
        (Clock as unknown as { instance?: unknown }).instance = undefined;
        (Clock as unknown as { initialization?: unknown }).initialization =
            undefined;
    });

    it("still blacklists when called by the lower address", async function () {
        const { service, abortSpy, blacklistSpy } = makeService(MIN_ADDRESS);
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        service.state.negotiatingWith = peer;

        const { encodedOpenChannel, lowerSignature } = await signProposal(
            peerWallet,
            [MIN_ADDRESS, peer]
        );

        await service.openProposal(peer, encodedOpenChannel, lowerSignature);

        expect(blacklistSpy.calledOnceWith(peer), "blacklist called").to.be
            .true;
        expect(abortSpy.notCalled, "abort should not be sent").to.be.true;
    });

    it("still blacklists on an invalid lower signature", async function () {
        const { service, abortSpy, blacklistSpy } = makeService(MAX_ADDRESS);
        const peerWallet = Wallet.createRandom();
        const attackerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        service.state.negotiatingWith = peer;

        // Signed by someone other than the claimed lower participant.
        const { encodedOpenChannel, lowerSignature } = await signProposal(
            attackerWallet,
            [MAX_ADDRESS, peer]
        );

        await service.openProposal(peer, encodedOpenChannel, lowerSignature);

        expect(blacklistSpy.calledOnceWith(peer), "blacklist called").to.be
            .true;
        expect(abortSpy.notCalled, "abort should not be sent").to.be.true;
    });

    it("still blacklists on mismatched terms (pinned to the channelId field)", async function () {
        const { service, abortSpy, blacklistSpy } = makeService(MAX_ADDRESS);
        const peerWallet = Wallet.createRandom();
        const peer = getChecksumAddress(peerWallet.address);
        service.state.negotiatingWith = peer;
        service.state.theirAmount = 500;

        // Participants are ordered [lower, higher] to match exactly what
        // getParticipantsAndBalances(peer) reconstructs for [peer, MAX_ADDRESS]
        // (peer is lower), so channelId is the ONLY expected field that
        // differs — pinning this test to the channelId branch of
        // getOpenChannelProposalMismatch instead of an incidental
        // participant-order mismatch (which would mask the channelId check
        // being deleted).
        const { encodedOpenChannel, lowerSignature } = await signProposal(
            peerWallet,
            [peer, MAX_ADDRESS]
        );

        await service.openProposal(peer, encodedOpenChannel, lowerSignature);

        expect(blacklistSpy.calledOnceWith(peer), "blacklist called").to.be
            .true;
        expect(abortSpy.notCalled, "abort should not be sent").to.be.true;

        // Confirm the actual mismatch reason the service would have computed
        // is specifically the channelId branch, not some other field.
        const decoded = Codec.decode(
            encodedOpenChannel,
            Type.OpenChannel
        ) as OpenChannelStruct;
        const reason = getOpenChannelProposalMismatch(
            decoded,
            {
                channelId: STUB_CHANNEL_ID,
                participants: [peer, MAX_ADDRESS],
                balances: [
                    { amount: 500, data: "0x" },
                    { amount: 500, data: "0x" }
                ]
            },
            {
                nowSeconds: Math.floor(Date.now() / 1000),
                maxSeconds: Math.floor(Date.now() / 1000) + 1000
            }
        );
        expect(reason).to.equal("channelId mismatch");
    });
});
