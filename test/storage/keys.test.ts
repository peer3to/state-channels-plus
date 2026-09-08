import { coordinateKey } from "@/storage/keys";
import { expect } from "chai";
import { ethers } from "ethers";

describe("coordinateKey", function () {
    it("preserves zero-height coordinates", function () {
        const forkId = ethers.id("coordinate-zero");
        expect(coordinateKey(forkId, 0)).to.equal(`${forkId}:0`);
    });
    it("separates positive heights and fork identities", function () {
        const forkId = ethers.id("coordinate-positive");
        expect(coordinateKey(forkId, 7)).to.equal(`${forkId}:7`);
        expect(coordinateKey(forkId, 7)).not.to.equal(coordinateKey(forkId, 8));
        expect(coordinateKey(forkId, 7)).not.to.equal(
            coordinateKey(ethers.id("other-fork"), 7)
        );
    });
});
