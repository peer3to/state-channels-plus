import { expect } from "chai";
import { ethers } from "ethers";
import { config } from "@/utils/config";
import {
    AdKind,
    CHANNEL_AD_VERSION,
    ChannelAdStruct,
    adId,
    decodeChannelAd,
    encodeChannelAd,
    validateReceivedAd
} from "@/discovery/ChannelAd";
import * as factory from "../factory";

function bytes32(): string {
    return ethers.hexlify(ethers.randomBytes(32));
}

function dataOfLength(bytesLen: number): string {
    return `0x${"ab".repeat(bytesLen)}`;
}

function baseAd(overrides: Partial<ChannelAdStruct> = {}): ChannelAdStruct {
    return {
        v: CHANNEL_AD_VERSION,
        kind: AdKind.OPEN,
        channelId: bytes32(),
        advertiser: factory.randomWallet().address,
        app: bytes32(),
        seq: 0n,
        expiresAtMs: 1_000_000n,
        capacity: 2,
        filled: 0,
        amount: 100n,
        data: dataOfLength(16),
        signature: "0x",
        ...overrides
    };
}

describe("ChannelAd", () => {
    describe("Round-trip encoding/decoding", () => {
        it("round-trips a JOIN ad including a 512-byte data payload", () => {
            const original = baseAd({
                kind: AdKind.JOIN,
                data: dataOfLength(512)
            });

            const { encodedAd } = encodeChannelAd(original);
            const decoded = decodeChannelAd(encodedAd);

            expect(BigInt(decoded.v)).to.equal(BigInt(original.v));
            expect(BigInt(decoded.kind)).to.equal(BigInt(original.kind));
            expect(decoded.channelId).to.equal(original.channelId);
            expect(decoded.advertiser).to.equal(original.advertiser);
            expect(decoded.app).to.equal(original.app);
            expect(BigInt(decoded.seq)).to.equal(BigInt(original.seq));
            expect(BigInt(decoded.expiresAtMs)).to.equal(
                BigInt(original.expiresAtMs)
            );
            expect(BigInt(decoded.capacity)).to.equal(
                BigInt(original.capacity)
            );
            expect(BigInt(decoded.filled)).to.equal(BigInt(original.filled));
            expect(BigInt(decoded.amount)).to.equal(BigInt(original.amount));
            expect(decoded.data).to.equal(original.data);
            expect(decoded.signature).to.equal(original.signature);
        });

        it("round-trips an OPEN ad including a 512-byte data payload", () => {
            const original = baseAd({
                kind: AdKind.OPEN,
                data: dataOfLength(512)
            });

            const { encodedAd } = encodeChannelAd(original);
            const decoded = decodeChannelAd(encodedAd);

            expect(BigInt(decoded.kind)).to.equal(BigInt(AdKind.OPEN));
            expect(decoded.data).to.equal(original.data);
        });

        it("normalizes v/kind/capacity/filled to number (not bigint) so strict-equality comparisons work", () => {
            const original = baseAd({ kind: AdKind.JOIN });
            const { encodedAd } = encodeChannelAd(original);
            const decoded = decodeChannelAd(encodedAd);

            expect(typeof decoded.v).to.equal("number");
            expect(typeof decoded.kind).to.equal("number");
            expect(typeof decoded.capacity).to.equal("number");
            expect(typeof decoded.filled).to.equal("number");

            expect(decoded.kind === AdKind.JOIN).to.be.true;
            expect(decoded.v === CHANNEL_AD_VERSION).to.be.true;
            expect(decoded.capacity === original.capacity).to.be.true;
            expect(decoded.filled === original.filled).to.be.true;
        });

        it("throws when decoding truncated/garbage hex rather than yielding a partial struct", () => {
            expect(() => decodeChannelAd("0xdeadbeef")).to.throw();
        });
    });

    describe("adId", () => {
        it("equals keccak256(encodedAd) and is stable across encode/decode round-trips", () => {
            const original = baseAd();
            const { encodedAd } = encodeChannelAd(original);

            expect(adId(encodedAd)).to.equal(ethers.keccak256(encodedAd));

            const decoded = decodeChannelAd(encodedAd);
            const { encodedAd: reEncodedAd } = encodeChannelAd(decoded);
            expect(adId(reEncodedAd)).to.equal(adId(encodedAd));
        });
    });

    describe("validateReceivedAd", () => {
        const expectedAdvertiser = factory.randomWallet().address;
        const expectedApp = bytes32();
        const nowMs = 1_000_000;

        const baseCtx = { expectedAdvertiser, expectedApp, nowMs };
        function ctx(overrides: Partial<typeof baseCtx> = {}) {
            return { ...baseCtx, ...overrides };
        }

        function validAd(
            overrides: Partial<ChannelAdStruct> = {}
        ): ChannelAdStruct {
            return baseAd({
                advertiser: expectedAdvertiser,
                app: expectedApp,
                expiresAtMs: nowMs + 1000,
                ...overrides
            });
        }

        it("accepts a well-formed ad", () => {
            expect(validateReceivedAd(validAd(), ctx())).to.be.undefined;
        });

        it("accepts a well-formed ad at exactly the data-size cap (boundary, inclusive)", () => {
            const ad = validAd({
                data: dataOfLength(config.LOBBY_AD_MAX_DATA_BYTES)
            });
            expect(validateReceivedAd(ad, ctx())).to.be.undefined;
        });

        it("accepts a well-formed ad at exactly the TTL cap (boundary, inclusive)", () => {
            const ad = validAd({
                expiresAtMs: nowMs + config.LOBBY_AD_MAX_TTL_MS
            });
            expect(validateReceivedAd(ad, ctx())).to.be.undefined;
        });

        it("rejects data.length > LOBBY_AD_MAX_DATA_BYTES with 'data-size'", () => {
            const ad = validAd({
                data: dataOfLength(config.LOBBY_AD_MAX_DATA_BYTES + 1)
            });
            expect(validateReceivedAd(ad, ctx())).to.equal("data-size");
        });

        it("rejects expiresAtMs <= nowMs with 'expired'", () => {
            const ad = validAd({ expiresAtMs: nowMs });
            expect(validateReceivedAd(ad, ctx())).to.equal("expired");
        });

        it("rejects expiresAtMs - nowMs > LOBBY_AD_MAX_TTL_MS with 'ttl-cap'", () => {
            const ad = validAd({
                expiresAtMs: nowMs + config.LOBBY_AD_MAX_TTL_MS + 1
            });
            expect(validateReceivedAd(ad, ctx())).to.equal("ttl-cap");
        });

        it("rejects advertiser !== expectedAdvertiser with 'advertiser-mismatch'", () => {
            const ad = validAd({ advertiser: factory.randomWallet().address });
            expect(validateReceivedAd(ad, ctx())).to.equal(
                "advertiser-mismatch"
            );
        });

        it("rejects app !== expectedApp with 'app-mismatch'", () => {
            const ad = validAd({ app: bytes32() });
            expect(validateReceivedAd(ad, ctx())).to.equal("app-mismatch");
        });

        it("rejects kind not in {0,1} with 'kind'", () => {
            const ad = validAd({ kind: 2 as AdKind });
            expect(validateReceivedAd(ad, ctx())).to.equal("kind");
        });

        it("rejects v !== CHANNEL_AD_VERSION with 'version'", () => {
            const ad = validAd({ v: CHANNEL_AD_VERSION + 1 });
            expect(validateReceivedAd(ad, ctx())).to.equal("version");
        });

        it("rejects signature !== '0x' with 'signature-reserved'", () => {
            const ad = validAd({ signature: `0x${"11".repeat(65)}` });
            expect(validateReceivedAd(ad, ctx())).to.equal(
                "signature-reserved"
            );
        });
    });
});
