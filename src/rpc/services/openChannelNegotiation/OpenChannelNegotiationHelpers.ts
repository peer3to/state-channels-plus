import { ethers, type BytesLike } from "ethers";
import { getChecksumAddress } from "@/utils";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export type Address = string;

export const DEFAULT_JOIN_AMOUNT = 500;
export const NEGOTIATION_TIMEOUT_MS = 20_000;
// Seconds the proposer adds to the current time for the open-channel deadline.
// The receiver bounds the proposed deadline against this.
export const OPEN_CHANNEL_DEADLINE_SECONDS = 60;

export const compareAddresses = (a: Address, b: Address): number => {
    const aBig = BigInt(getChecksumAddress(a));
    const bBig = BigInt(getChecksumAddress(b));
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
};

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
