import { channelIdToDiscoveryKey, channelIdToTargetedJoinTopic } from "@/utils";
import { requireBytes32 } from "@/utils/bytes32";
import { expect } from "chai";
import { ethers } from "ethers";

describe("discovery key", function () {
    it("uses the exact channel ID bytes and rejects invalid values", function () {
        const channelId = ethers.id("channel-discovery-key");

        expect(channelIdToDiscoveryKey(channelId)).to.equal(channelId);
        expect(() => channelIdToDiscoveryKey("channel-id")).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
        expect(() => channelIdToDiscoveryKey("0x1234")).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
    });

    it("targeted join topic is domain-separated from the raw channel key", function () {
        const channelId = ethers.id("targeted-channel-discovery-key");
        const expected = ethers.solidityPackedKeccak256(
            ["string", "bytes32"],
            ["targeted-channel-join", channelId]
        );

        expect(channelIdToTargetedJoinTopic(channelId)).to.equal(expected);
        expect(channelIdToTargetedJoinTopic(channelId)).to.equal(
            channelIdToTargetedJoinTopic(channelId)
        );
        expect(ethers.dataLength(expected)).to.equal(32);
        expect(expected).not.to.equal(channelIdToDiscoveryKey(channelId));
    });
    it("rejects short IDs in both discovery derivations", function () {
        const channelId = ethers.hexlify(ethers.randomBytes(31));
        expect(() => channelIdToDiscoveryKey(channelId)).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
        expect(() => channelIdToTargetedJoinTopic(channelId)).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
    });
    it("rejects long IDs in both discovery derivations", function () {
        const channelId = ethers.hexlify(ethers.randomBytes(33));
        expect(() => channelIdToDiscoveryKey(channelId)).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
        expect(() => channelIdToTargetedJoinTopic(channelId)).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
    });
    it("rejects malformed IDs in both discovery derivations", function () {
        const channelId = "0xgg";
        expect(() => channelIdToDiscoveryKey(channelId)).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
        expect(() => channelIdToTargetedJoinTopic(channelId)).to.throw(
            "Channel ID must be exactly 32 bytes"
        );
    });
    it("preserves mixed-case channel bytes and targeted derivation", function () {
        const channelId =
            "0x" + ethers.id("mixed-case-discovery").slice(2).toUpperCase();
        expect(channelIdToDiscoveryKey(channelId)).to.equal(
            ethers.hexlify(channelId)
        );
        expect(channelIdToTargetedJoinTopic(channelId)).to.equal(
            ethers.solidityPackedKeccak256(
                ["string", "bytes32"],
                ["targeted-channel-join", channelId]
            )
        );
    });
    it("uses the caller message for undefined bytes32 input", function () {
        expect(() => requireBytes32(undefined, "missing commitment")).to.throw(
            "missing commitment"
        );
    });
    it("validates bytes32 without returning a normalized value", function () {
        expect(requireBytes32(ethers.ZeroHash, "invalid")).to.equal(undefined);
    });
});
