import { ethers, type BytesLike } from "ethers";
import { getChecksumAddress } from "@/utils";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { LobbyMatch } from "@/rpc/services/lobbyMatching/LobbyMatchingTypes";

export type Address = string;

export const DEFAULT_JOIN_AMOUNT = 500;
export const NEGOTIATION_TIMEOUT_MS = 20_000;
// Seconds the proposer adds to the current time for the open-channel deadline.
// The receiver bounds the proposed deadline against this.
export const OPEN_CHANNEL_DEADLINE_SECONDS = 60;
export const NEGOTIATED_CHANNEL_DOMAIN = ethers.id(
    "peer3.state-channel.negotiated-channel.v1"
);

export const compareAddresses = (a: Address, b: Address): number => {
    const aBig = BigInt(getChecksumAddress(a));
    const bBig = BigInt(getChecksumAddress(b));
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
};

export function deriveNegotiatedChannelId(match: LobbyMatch): string {
    const selector = getChecksumAddress(match.selectorAddress);
    const advertiser = getChecksumAddress(match.advertiserAddress);
    if (selector === advertiser) {
        throw new Error("Negotiated channel requires two different peers");
    }
    if (
        !ethers.isHexString(match.selectorChallenge, 32) ||
        !ethers.isHexString(match.advertiserChallenge, 32) ||
        match.selectorChallenge === ethers.ZeroHash ||
        match.advertiserChallenge === ethers.ZeroHash
    ) {
        throw new Error(
            "Negotiated channel challenges must be nonzero bytes32"
        );
    }
    if (!ethers.isHexString(match.attemptNonce, 32)) {
        throw new Error("Negotiated channel attempt must be bytes32");
    }
    const [lower, higher] =
        compareAddresses(selector, advertiser) < 0
            ? [selector, advertiser]
            : [advertiser, selector];
    const lowerChallenge =
        lower === selector
            ? match.selectorChallenge
            : match.advertiserChallenge;
    const higherChallenge =
        higher === selector
            ? match.selectorChallenge
            : match.advertiserChallenge;
    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "address", "address", "bytes32", "bytes32"],
            [
                NEGOTIATED_CHANNEL_DOMAIN,
                lower,
                higher,
                lowerChallenge,
                higherChallenge
            ]
        )
    );
}

/**
 * Returns a reason string if a peer-proposed OpenChannel does not match the
 * locally negotiated terms, or null if it matches. The receiver must only
 * co-sign the exact terms it negotiated, never the peer's arbitrary fields.
 */
export function getOpenChannelProposalMismatch(
    decoded: OpenChannelStruct,
    expected: {
        channelId: BytesLike;
        participants: [Address, Address];
        balances: OpenChannelStruct["balances"];
    },
    deadline: { nowSeconds: number; maxSeconds: number }
): string | null {
    if (
        ethers.hexlify(decoded.channelId) !== ethers.hexlify(expected.channelId)
    ) {
        return "channelId mismatch";
    }
    if (decoded.participants.length !== expected.participants.length) {
        return "participants length mismatch";
    }
    for (let i = 0; i < expected.participants.length; i++) {
        if (
            getChecksumAddress(String(decoded.participants[i])) !==
            getChecksumAddress(expected.participants[i])
        ) {
            return `participant ${i} mismatch`;
        }
    }
    if (decoded.balances.length !== expected.balances.length) {
        return "balances length mismatch";
    }
    for (let i = 0; i < expected.balances.length; i++) {
        if (
            BigInt(decoded.balances[i].amount) !==
            BigInt(expected.balances[i].amount)
        ) {
            return `balance ${i} amount mismatch`;
        }
        if (
            ethers.hexlify(decoded.balances[i].data) !==
            ethers.hexlify(expected.balances[i].data)
        ) {
            return `balance ${i} data mismatch`;
        }
    }
    if (decoded.isAtomic !== true) {
        return "isAtomic must be true";
    }
    if (ethers.hexlify(decoded.data) !== "0x") {
        return "data must be empty";
    }
    const deadlineSeconds = Number(decoded.deadlineTimestamp);
    if (
        !Number.isFinite(deadlineSeconds) ||
        deadlineSeconds <= deadline.nowSeconds ||
        deadlineSeconds > deadline.maxSeconds
    ) {
        return "deadline out of range";
    }
    return null;
}
