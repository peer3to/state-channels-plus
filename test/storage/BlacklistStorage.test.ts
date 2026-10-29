import { BlacklistStorage } from "@/storage/BlacklistStorage";
import { expect } from "chai";
import { ethers } from "ethers";

describe("BlacklistStorage", function () {
    const address = ethers.Wallet.createRandom().address;

    it("records a verdict with its reason and reports it by address", function () {
        const storage = new BlacklistStorage();

        expect(storage.record(address, "malformed frame")).to.equal(true);
        expect(storage.has(address)).to.equal(true);
        expect(storage.get(address)).to.deep.equal({
            address,
            reason: "malformed frame"
        });
        expect(storage.entries()).to.deep.equal([
            { address, reason: "malformed frame" }
        ]);
    });

    it("keeps the first reason when the same address is recorded again", function () {
        const storage = new BlacklistStorage();
        storage.record(address, "first");

        expect(storage.record(address, "second")).to.equal(false);
        expect(storage.get(address)?.reason).to.equal("first");
    });

    it("keys every operation by the checksummed address", function () {
        const storage = new BlacklistStorage();
        storage.record(address.toLowerCase(), "lowercase record");

        expect(storage.has(address)).to.equal(true);
        expect(
            storage.get(address.toUpperCase().replace("0X", "0x"))?.address
        ).to.equal(address);
        expect(storage.remove(address.toLowerCase())).to.equal(true);
        expect(storage.has(address)).to.equal(false);
    });

    it("reports a missing address as absent and a removal of it as a no-op", function () {
        const storage = new BlacklistStorage();

        expect(storage.has(address)).to.equal(false);
        expect(storage.get(address)).to.equal(undefined);
        expect(storage.remove(address)).to.equal(false);
        expect(storage.entries()).to.deep.equal([]);
    });

    it("clears every verdict", function () {
        const storage = new BlacklistStorage();
        storage.record(address, "one");
        storage.record(ethers.Wallet.createRandom().address, "two");

        storage.clear();

        expect(storage.entries()).to.deep.equal([]);
    });
});
