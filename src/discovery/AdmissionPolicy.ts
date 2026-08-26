import { getChecksumAddress } from "@/utils/address";

import type { IntentDeclineReason } from "./LobbyIntentTypes";

export type AdmissionMode = "allowAll" | "denyAll" | "arbitrate";

/**
 * Declarative, layer-1-only admission policy. Plain data only —
 * no BigInt/functions/RegExp — so it is structuredClone-able end to end.
 * Amounts are decimal strings on the policy; the evaluator compares them as
 * BigInt internally.
 */
export type AdmissionPolicy = {
    mode: AdmissionMode;
    minAmount?: string; // decimal string
    maxAmount?: string; // decimal string
    allow?: string[]; // addresses; empty/absent => no allow-list (allow all)
    deny?: string[]; // addresses; deny wins over allow
    decisionTimeoutMs?: number; // reserved, not consumed yet
    onTimeout?: "deny" | "allow"; // reserved, not consumed yet
};

export type AdmissionRequestKind = "intent" | "negotiate" | "join";

export type AdmissionRequest = {
    kind: AdmissionRequestKind;
    peerAddress: string;
    amount?: string; // decimal string
    channelId?: string;
    encodedAd?: string;
};

export type AdmissionDecision =
    | { allow: true }
    | { allow: false; reason: IntentDeclineReason };

export const DEFAULT_ADMISSION_POLICY: AdmissionPolicy = { mode: "allowAll" };

/** Checksums an address, returning undefined (never throwing) if it is malformed. */
function tryChecksum(address: string): string | undefined {
    try {
        return getChecksumAddress(address);
    } catch {
        return undefined;
    }
}

/** Checksums every entry of an address list, dropping any that fail to normalize. */
function checksumList(addresses: string[] | undefined): Set<string> {
    if (!addresses || addresses.length === 0) return new Set();
    const out = new Set<string>();
    for (const address of addresses) {
        const checksummed = tryChecksum(address);
        if (checksummed !== undefined) out.add(checksummed);
    }
    return out;
}

/**
 * Pure evaluator: (policy, request) -> decision. No clock, no I/O, no logging.
 * decisionTimeoutMs/onTimeout are carried on the policy for a future
 * interactive mode but are NOT consumed here.
 *
 * Fails closed: any malformed input (bad address, non-integer amount) denies
 * with reason "policy" rather than throwing or silently allowing.
 */
export function evaluateAdmission(
    policy: AdmissionPolicy,
    req: AdmissionRequest
): AdmissionDecision {
    // TODO: arbitrate mode should round-trip through the admissionRequested
    // bus event / resolveAdmission. This evaluator has no bus access, so it
    // must never hang or silently allow — deny with "policy".
    if (policy.mode === "arbitrate") {
        return { allow: false, reason: "policy" };
    }

    if (policy.mode === "denyAll") {
        return { allow: false, reason: "policy" };
    }

    const requesterAddress = tryChecksum(req.peerAddress);
    if (requesterAddress === undefined) {
        return { allow: false, reason: "policy" };
    }

    // Deny is evaluated BEFORE allow: an address in both lists is denied.
    const denyList = checksumList(policy.deny);
    if (denyList.has(requesterAddress)) {
        return { allow: false, reason: "policy" };
    }

    // An empty/absent allow list means "no allow-list configured" (allow
    // all), NOT "allow nobody".
    const allowList = checksumList(policy.allow);
    if (allowList.size > 0 && !allowList.has(requesterAddress)) {
        return { allow: false, reason: "policy" };
    }

    const amountDecision = evaluateAmountBounds(policy, req.amount);
    if (amountDecision !== undefined) return amountDecision;

    return { allow: true };
}

// Amounts are uint256 decimal strings (LobbyIntentTypes's `amount: string /*
// uint256 dec */`), so negative is malformed per this domain — unsigned
// digits only. Native BigInt(string) is lenient (accepts "0x64" as hex,
// "" as 0, and tolerates surrounding whitespace), which would silently
// admit non-decimal input; this regex is the gate BigInt never gets to see.
const UNSIGNED_DECIMAL = /^\d+$/;

/** Parses a strict, unsigned decimal string to BigInt, or undefined if it isn't one. */
function tryParseUnsignedDecimal(value: string): bigint | undefined {
    if (!UNSIGNED_DECIMAL.test(value)) return undefined;
    return BigInt(value);
}

/** Returns a deny decision if the request amount is outside the policy bounds, else undefined. */
function evaluateAmountBounds(
    policy: AdmissionPolicy,
    amount: string | undefined
): AdmissionDecision | undefined {
    if (policy.minAmount === undefined && policy.maxAmount === undefined) {
        return undefined;
    }
    if (amount === undefined) {
        return { allow: false, reason: "terms" };
    }

    // Fail closed: any malformed decimal string (on either the request or
    // the policy itself) denies with "terms" rather than throwing.
    const amountBigInt = tryParseUnsignedDecimal(amount);
    if (amountBigInt === undefined) {
        return { allow: false, reason: "terms" };
    }

    if (policy.minAmount !== undefined) {
        const minBigInt = tryParseUnsignedDecimal(policy.minAmount);
        if (minBigInt === undefined || amountBigInt < minBigInt) {
            return { allow: false, reason: "terms" };
        }
    }
    if (policy.maxAmount !== undefined) {
        const maxBigInt = tryParseUnsignedDecimal(policy.maxAmount);
        if (maxBigInt === undefined || amountBigInt > maxBigInt) {
            return { allow: false, reason: "terms" };
        }
    }
    return undefined;
}
