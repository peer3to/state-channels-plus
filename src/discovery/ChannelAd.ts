import { ethers } from "ethers";
import { Codec, Type } from "@/utils/Codec";
import { config } from "@/utils/config";

/**
 * Wire envelope for a channel discovery ad. This is the canonical
 * ad shape for the lobby protocol and for poker's `data` codec.
 *
 * `seq` and `signature` are RESERVED for a future phase: `seq` carries no monotonicity enforcement
 * and `signature` MUST be "0x" in v1 — a v1 receiver must never treat either
 * field as authoritative. `data` is app-opaque; the SDK only checks its byte
 * length, never its contents.
 */
export const CHANNEL_AD_VERSION = 1;

export enum AdKind {
    OPEN = 0,
    JOIN = 1
}

export type ChannelAdStruct = {
    v: number;
    kind: AdKind;
    channelId: string;
    advertiser: string;
    app: string;
    seq: bigint | number;
    expiresAtMs: bigint | number;
    capacity: number;
    filled: number;
    amount: bigint | number;
    data: string; // hex, app-opaque, <= LOBBY_AD_MAX_DATA_BYTES
    signature: string; // RESERVED, must be "0x" in v1
};

export type AdId = string; // keccak256(encodedAd)

/** ABI-encodes a ChannelAdStruct. Returns the encoded ad wrapped, never a bare string. */
export function encodeChannelAd(ad: ChannelAdStruct): { encodedAd: string } {
    return { encodedAd: Codec.encode(ad, Type.ChannelAd) as string };
}

/**
 * ABI-decodes an encoded ad back into a ChannelAdStruct. Throws on
 * truncated/garbage input.
 *
 * ethers decodes every uint field as bigint, but v/kind/capacity/filled are
 * declared `number` (each is <= uint16, safely within Number range) — coerce
 * those four so the returned struct matches its declared types. seq/
 * expiresAtMs/amount stay `bigint | number` per the contract.
 */
export function decodeChannelAd(encodedAd: string): ChannelAdStruct {
    const decoded = Codec.decode(encodedAd, Type.ChannelAd);
    return {
        ...decoded,
        v: Number(decoded.v),
        kind: Number(decoded.kind) as AdKind,
        capacity: Number(decoded.capacity),
        filled: Number(decoded.filled)
    };
}

/** withdrawAd keys on adId (keccak256 of the encoded ad), not channelId. */
export function adId(encodedAd: string): AdId {
    return ethers.keccak256(encodedAd);
}

export type AdRejectReason =
    | "version"
    | "kind"
    | "data-size"
    | "expired"
    | "ttl-cap"
    | "advertiser-mismatch"
    | "app-mismatch"
    | "signature-reserved";

/** Byte length of a hex string's data payload, excluding the "0x" prefix. */
function hexByteLength(hex: string): number {
    const body = hex.startsWith("0x") ? hex.slice(2) : hex;
    return body.length / 2;
}

/**
 * Pure validation of a received ad against the receiving context. No I/O, no
 * clock reads other than the injected `nowMs` — callable from a unit test
 * with no network.
 */
export function validateReceivedAd(
    ad: ChannelAdStruct,
    ctx: { expectedAdvertiser: string; expectedApp: string; nowMs: number }
): AdRejectReason | undefined {
    if (BigInt(ad.v) !== BigInt(CHANNEL_AD_VERSION)) return "version";
    if (BigInt(ad.kind) !== 0n && BigInt(ad.kind) !== 1n) return "kind";
    if (ad.signature !== "0x") return "signature-reserved";
    if (ad.advertiser !== ctx.expectedAdvertiser) return "advertiser-mismatch";
    if (ad.app !== ctx.expectedApp) return "app-mismatch";
    if (hexByteLength(ad.data) > config.LOBBY_AD_MAX_DATA_BYTES)
        return "data-size";

    const expiresAtMs = BigInt(ad.expiresAtMs);
    const nowMs = BigInt(ctx.nowMs);
    if (expiresAtMs <= nowMs) return "expired";
    if (expiresAtMs - nowMs > BigInt(config.LOBBY_AD_MAX_TTL_MS))
        return "ttl-cap";

    return undefined;
}
