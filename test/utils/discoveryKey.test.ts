import { expect } from "chai";
import { ethers } from "ethers";

import { channelIdToDiscoveryKey, channelIdToTargetedJoinTopic } from "@/utils";

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
});
