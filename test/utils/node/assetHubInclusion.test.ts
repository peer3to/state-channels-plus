import { recorded } from "../../fixtures/node/RecordedPolkadotNodes";
import {
    blake2b256,
    bytesToHex,
    decodeParaHead,
    paraHeadKey,
    reviveBlockHashKey
} from "@/utils/node/storageDiff/includedHead/assetHubInclusion";
import { expect } from "chai";

/** Bytes (i * 7 + 3) mod 256; the digests below come from Python's hashlib. */
function pattern(length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 7 + 3) % 256);
}

describe("assetHubInclusion", function () {
    it("hashes the empty input to the BLAKE2b-256 reference digest", function () {
        expect(bytesToHex(blake2b256(new Uint8Array()))).to.equal(
            "0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"
        );
    });

    it("hashes the RFC 7693 input abc to its BLAKE2b-256 digest", function () {
        expect(bytesToHex(blake2b256(Buffer.from("abc")))).to.equal(
            "0xbddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319"
        );
    });

    it("hashes inputs around the 128-byte block boundary to the reference digests", function () {
        expect(bytesToHex(blake2b256(pattern(127)))).to.equal(
            "0xc9ae3859964b35f04c54b36d33cf299d7290ee621005d28e51598a943560aaaa"
        );
        expect(bytesToHex(blake2b256(pattern(128)))).to.equal(
            "0xf0501d06597880592bc49234eef100ec1ff349058d0e9d9b753504e24af86dd6"
        );
        expect(bytesToHex(blake2b256(pattern(129)))).to.equal(
            "0xa34a4e1e03c541dfbf3099c4b6c143c022ced65c28bd7e8a10e0a098461aecf0"
        );
    });

    it("hashes multi-block inputs to the reference digests", function () {
        expect(bytesToHex(blake2b256(pattern(256)))).to.equal(
            "0xd93ebb9c802f5630ab22516fd82b6c21bc8bd551d531349b715f046ed11ed871"
        );
        expect(bytesToHex(blake2b256(pattern(300)))).to.equal(
            "0x3f712d8870a79a34ed4aed7b4e82123cea195af956e7ebef11d8a9d2f644734e"
        );
    });

    it("derives the recorded Paras::Heads key of Asset Hub from its para id", function () {
        const [first] = recorded.fixtures;
        expect(paraHeadKey(recorded.paraId)).to.equal(
            first.relayNotification.changes[0][0]
        );
    });

    it("derives the recorded Paras::Heads keys of other parachains from their para ids", function () {
        expect(paraHeadKey(2000)).to.equal(recorded.otherParaHeadKeys["2000"]);
        expect(paraHeadKey(3344)).to.equal(recorded.otherParaHeadKeys["3344"]);
    });

    it("derives the recorded Revive::BlockHash keys from the block numbers", function () {
        for (const fixture of recorded.fixtures) {
            expect(reviveBlockHashKey(fixture.number)).to.equal(
                fixture.storageKey
            );
        }
    });

    it("decodes a recorded parachain head to the included block number and Substrate hash", function () {
        for (const fixture of recorded.fixtures) {
            const decoded = decodeParaHead(
                fixture.relayNotification.changes[0][1]
            );
            expect(decoded).to.deep.equal({
                number: fixture.number,
                substrateHash: fixture.substrateHash
            });
        }
    });

    it("refuses a parachain head that is shorter than its declared length", function () {
        const [first] = recorded.fixtures;
        const truncated = first.relayNotification.changes[0][1].slice(0, 80);
        expect(() => decodeParaHead(truncated)).to.throw("Malformed");
    });

    it("refuses a para id that is not a u32", function () {
        expect(() => paraHeadKey(-1)).to.throw("u32");
        expect(() => paraHeadKey(2 ** 32)).to.throw("u32");
    });
});
