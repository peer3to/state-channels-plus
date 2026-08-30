import { expect } from "chai";
import { ethers } from "ethers";

import { channelIdToDiscoveryKey } from "@/utils";

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
});
