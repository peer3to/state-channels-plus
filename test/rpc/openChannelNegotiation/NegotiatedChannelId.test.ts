import { expect } from "chai";
import { ethers } from "ethers";

import { deriveNegotiatedChannelId } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type { LobbyMatch } from "@/rpc/services";

const selector = "0x1000000000000000000000000000000000000001";
const advertiser = "0x2000000000000000000000000000000000000002";

function match(overrides: Partial<LobbyMatch> = {}): LobbyMatch {
    return {
        peerAddress: advertiser,
        attemptNonce: ethers.id("attempt-one"),
        selectorAddress: selector,
        advertiserAddress: advertiser,
        selectorChallenge: ethers.id("selector-one"),
        advertiserChallenge: ethers.id("advertiser-one"),
        ...overrides
    };
}

describe("negotiated channel ID", function () {
    it("derives the same ID from both peer views of one committed transcript", function () {
        const selectorView = match();
        const advertiserView = match({ peerAddress: selector });

        expect(deriveNegotiatedChannelId(selectorView)).to.equal(
            deriveNegotiatedChannelId(advertiserView)
        );
    });

    it("derives distinct IDs for fresh challenge rounds between the same pair", function () {
        const first = deriveNegotiatedChannelId(match());
        const second = deriveNegotiatedChannelId(
            match({
                attemptNonce: ethers.id("attempt-two"),
                selectorChallenge: ethers.id("selector-two")
            })
        );

        expect(second).not.to.equal(first);
        expect(second).not.to.equal(ethers.ZeroHash);
    });

    it("rejects self matches and malformed or zero challenges", function () {
        expect(() =>
            deriveNegotiatedChannelId(match({ advertiserAddress: selector }))
        ).to.throw("two different peers");
        expect(() =>
            deriveNegotiatedChannelId(
                match({ selectorChallenge: ethers.ZeroHash })
            )
        ).to.throw("nonzero bytes32");
        expect(() =>
            deriveNegotiatedChannelId(match({ advertiserChallenge: "0x12" }))
        ).to.throw("nonzero bytes32");
    });

    it("keeps the lobby match payload free of any supplied channel ID", function () {
        expect(match()).not.to.have.property("channelId");
    });
});
