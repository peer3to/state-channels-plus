import { expect } from "chai";

import { getOpenChannelProposalMismatch } from "@/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";

/**
 * Regression: openProposal must only co-sign the exact OpenChannel it
 * negotiated. A valid lower signature only proves the peer signed *those*
 * bytes, not that they match local terms — so the receiver compares every
 * security-sensitive field before signing.
 */
const A = "0x" + "11".repeat(20);
const B = "0x" + "22".repeat(20);
const CHANNEL_ID = "0x" + "33".repeat(32);
const NOW = 1000;

const expected = {
    channelId: CHANNEL_ID,
    participants: [A, B] as [string, string],
    balances: [
        { amount: 500, data: "0x" },
        { amount: 700, data: "0x" }
    ]
};
const deadline = {
    nowSeconds: NOW,
    maxSeconds: NOW + 60 + 10
};

// A proposal that matches the negotiated terms exactly.
const matchingProposal = (): OpenChannelStruct =>
    ({
        channelId: CHANNEL_ID,
        participants: [A, B],
        balances: [
            { amount: 500n, data: "0x" },
            { amount: 700n, data: "0x" }
        ],
        deadlineTimestamp: 1030n,
        isAtomic: true,
        data: "0x"
    }) as unknown as OpenChannelStruct;

describe("getOpenChannelProposalMismatch", function () {
    it("accepts a proposal that matches the negotiated terms", function () {
        expect(
            getOpenChannelProposalMismatch(
                matchingProposal(),
                expected,
                deadline
            )
        ).to.equal(null);
    });

    it("rejects a tampered balance amount (no fund redirection)", function () {
        const decoded = matchingProposal();
        decoded.balances[1].amount = 999_999n;
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/balance 1 amount mismatch/);
    });

    it("rejects tampered balance data", function () {
        const decoded = matchingProposal();
        decoded.balances[0].data = "0xdeadbeef";
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/balance 0 data mismatch/);
    });

    it("rejects a different participant set", function () {
        const decoded = matchingProposal();
        decoded.participants = [A, "0x" + "44".repeat(20)];
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/participant 1 mismatch/);
    });

    it("rejects a different channelId", function () {
        const decoded = matchingProposal();
        decoded.channelId = "0x" + "55".repeat(32);
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/channelId mismatch/);
    });

    it("rejects non-atomic opens", function () {
        const decoded = matchingProposal();
        decoded.isAtomic = false;
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/isAtomic/);
    });

    it("rejects arbitrary opening data", function () {
        const decoded = matchingProposal();
        decoded.data = "0xc0ffee";
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/data must be empty/);
    });

    it("rejects a deadline in the past", function () {
        const decoded = matchingProposal();
        decoded.deadlineTimestamp = BigInt(NOW - 1);
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/deadline out of range/);
    });

    it("rejects a deadline beyond the allowed window", function () {
        const decoded = matchingProposal();
        decoded.deadlineTimestamp = BigInt(deadline.maxSeconds + 1);
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.match(/deadline out of range/);
    });

    it("matches participants and channelId irrespective of address casing", function () {
        const decoded = matchingProposal();
        decoded.participants = [A.toUpperCase().replace("0X", "0x"), B];
        expect(
            getOpenChannelProposalMismatch(decoded, expected, deadline)
        ).to.equal(null);
    });
});
