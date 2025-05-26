import { expect } from "chai";
import { SignatureCollectionMap } from "@/utils/SignatureCollectionMap";
import sinon from "sinon";

describe("SignatureCollectionMap", () => {
    let map: SignatureCollectionMap;
    let clock: sinon.SinonFakeTimers;

    // Test data
    const testKey = "test-key";
    const address1 = "0x1234567890123456789012345678901234567890";
    const address2 = "0x0987654321098765432109876543210987654321";
    const address3 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const signature1 = "0xsignature1";
    const signature2 = "0xsignature2";

    beforeEach(() => {
        map = new SignatureCollectionMap();
        clock = sinon.useFakeTimers();
    });

    afterEach(() => {
        clock.restore();
    });

    it("should insert a new signature", () => {
        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });

        expect(map.has(testKey)).to.be.true;
        expect(map.hasSignature(testKey, address1)).to.be.true;
        expect(map.getSignatures(testKey)).to.deep.equal([signature1]);
    });

    it("should insert multiple signatures for the same key", () => {
        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });
        map.tryInsert(testKey, {
            signerAddress: address2,
            signature: signature2
        });

        expect(map.hasSignature(testKey, address1)).to.be.true;
        expect(map.hasSignature(testKey, address2)).to.be.true;
        expect(map.getSignatures(testKey)).to.have.lengthOf(2);
    });

    it("should prevent duplicate signatures from the same address", () => {
        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });
        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature2 // Different signature, same address
        });

        expect(map.getSignatures(testKey)).to.have.lengthOf(1);
        expect(map.getSignatures(testKey)).to.deep.equal([signature1]);
    });

    it("should return true when all participants have signed", () => {
        const participants = [address1, address2];

        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });
        map.tryInsert(testKey, {
            signerAddress: address2,
            signature: signature2
        });

        expect(map.didEveryoneSign(testKey, participants)).to.be.true;
    });

    it("should return false when not all participants have signed", () => {
        const participants = [address1, address2, address3];

        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });
        map.tryInsert(testKey, {
            signerAddress: address2,
            signature: signature2
        });

        expect(map.didEveryoneSign(testKey, participants)).to.be.false;
    });

    it("should return false for non-existent key", () => {
        const participants = [address1, address2];
        expect(map.didEveryoneSign("non-existent", participants)).to.be.false;
    });

    it("should delete entries", () => {
        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });

        expect(map.has(testKey)).to.be.true;
        expect(map.delete(testKey)).to.be.true;
        expect(map.has(testKey)).to.be.false;
    });

    it("should clear all entries", () => {
        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });

        expect(map.size()).to.equal(1);
        map.clear();
        expect(map.size()).to.equal(0);
        expect(map.has(testKey)).to.be.false;
    });

    it("should set timeout when provided", () => {
        map.tryInsert(
            testKey,
            {
                signerAddress: address1,
                signature: signature1
            },
            { timeoutMs: 5000 }
        );

        expect(map.has(testKey)).to.be.true;

        clock.tick(4999);
        expect(map.has(testKey)).to.be.true;

        clock.tick(2);
        expect(map.has(testKey)).to.be.false;
    });

    it("should not timeout when no timeout provided", () => {
        map.tryInsert(testKey, {
            signerAddress: address1,
            signature: signature1
        });

        clock.tick(10000);
        expect(map.has(testKey)).to.be.true;
    });

    it("should clear timeout when manually deleting", () => {
        map.tryInsert(
            testKey,
            {
                signerAddress: address1,
                signature: signature1
            },
            { timeoutMs: 5000 }
        );

        expect(map.delete(testKey)).to.be.true;
        expect(map.has(testKey)).to.be.false;

        // Should not cause issues when timeout would have fired
        clock.tick(6000);
    });
});
