import { channelKey } from "@/utils/channelKey";
import { expect } from "chai";
import { ethers } from "ethers";

describe("channelKey", function () {
    it("shares an identity across hex case variants", function () {
        const channelId = ethers.id("channel-key-case");
        expect(channelKey(channelId.toUpperCase())).to.equal(channelId);
    });
    it("preserves permissive string conversion without validation", function () {
        expect(channelKey("Legacy-Channel")).to.equal("legacy-channel");
        expect(channelKey("")).to.equal("");
    });
});
