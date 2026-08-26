import { expect } from "chai";
import { describe, it } from "mocha";
import { ethers } from "ethers";

import {
    AdmissionPolicy,
    AdmissionRequest,
    DEFAULT_ADMISSION_POLICY,
    evaluateAdmission
} from "@/discovery/AdmissionPolicy";
import type { IntentDeclineReason } from "@/discovery/LobbyIntentTypes";

// ethers.getAddress() accepts an all-lowercase or all-uppercase address as
// "unchecked" and recomputes the EIP-55 checksum casing for it; an arbitrary
// mixed-case string only validates when it exactly matches that checksum, so
// the three case variants exercised here are: the checksummed form itself,
// all-lowercase, and all-uppercase (hex digits only — the "0x" prefix stays
// lowercase).
const ALICE_CHECKSUM = ethers.Wallet.createRandom().address;
const ALICE_LOWER = ALICE_CHECKSUM.toLowerCase();
const ALICE_MIXED = "0x" + ALICE_CHECKSUM.slice(2).toUpperCase();

const BOB = ethers.Wallet.createRandom().address;
const CAROL = ethers.Wallet.createRandom().address;

const MALFORMED_ADDRESS = "0xnotanaddress";

function baseRequest(
    overrides: Partial<AdmissionRequest> = {}
): AdmissionRequest {
    return {
        kind: "intent",
        peerAddress: ALICE_CHECKSUM,
        ...overrides
    };
}

describe("AdmissionPolicy", () => {
    describe("evaluateAdmission truth table", () => {
        type MembershipCase = "inDeny" | "inAllow" | "inNeither" | "inBoth";
        type AmountCase = "below" | "inRange" | "above" | "noBounds";

        const membershipCases: MembershipCase[] = [
            "inDeny",
            "inAllow",
            "inNeither",
            "inBoth"
        ];
        const amountCases: AmountCase[] = [
            "below",
            "inRange",
            "above",
            "noBounds"
        ];
        const modes: AdmissionPolicy["mode"][] = [
            "allowAll",
            "denyAll",
            "arbitrate"
        ];

        function buildPolicy(
            mode: AdmissionPolicy["mode"],
            membership: MembershipCase,
            amount: AmountCase
        ): AdmissionPolicy {
            const policy: AdmissionPolicy = { mode };
            if (membership === "inDeny") policy.deny = [ALICE_CHECKSUM];
            if (membership === "inAllow") policy.allow = [ALICE_CHECKSUM];
            if (membership === "inBoth") {
                policy.deny = [ALICE_CHECKSUM];
                policy.allow = [ALICE_CHECKSUM];
            }
            // "inNeither": no allow/deny lists at all.

            if (amount !== "noBounds") {
                policy.minAmount = "100";
                policy.maxAmount = "200";
            }
            return policy;
        }

        function buildRequestAmount(amount: AmountCase): string | undefined {
            switch (amount) {
                case "below":
                    return "50";
                case "inRange":
                    return "150";
                case "above":
                    return "250";
                case "noBounds":
                    return undefined;
            }
        }

        function expectedDecision(
            mode: AdmissionPolicy["mode"],
            membership: MembershipCase,
            amount: AmountCase
        ): { allow: boolean; reason?: IntentDeclineReason } {
            if (mode === "arbitrate") return { allow: false, reason: "policy" };
            if (mode === "denyAll") return { allow: false, reason: "policy" };
            // mode === "allowAll"
            if (membership === "inDeny" || membership === "inBoth") {
                return { allow: false, reason: "policy" };
            }
            // allow list present ("inAllow") always contains the requester by
            // construction; "inNeither"/absent allow list means allow-all.
            if (amount === "below" || amount === "above") {
                return { allow: false, reason: "terms" };
            }
            return { allow: true };
        }

        for (const mode of modes) {
            for (const membership of membershipCases) {
                for (const amount of amountCases) {
                    it(`mode=${mode} membership=${membership} amount=${amount}`, () => {
                        const policy = buildPolicy(mode, membership, amount);
                        const req = baseRequest({
                            amount: buildRequestAmount(amount)
                        });
                        const decision = evaluateAdmission(policy, req);
                        const expected = expectedDecision(
                            mode,
                            membership,
                            amount
                        );

                        expect(decision.allow).to.equal(expected.allow);
                        if (!decision.allow) {
                            expect(decision.reason).to.equal(expected.reason);
                        }
                    });
                }
            }
        }
    });

    describe("reason enum discipline", () => {
        it("never returns busy or full — those are produced by call sites, not the evaluator", () => {
            const allDecisions: (
                | { allow: true }
                | { allow: false; reason: IntentDeclineReason }
            )[] = [
                evaluateAdmission({ mode: "denyAll" }, baseRequest()),
                evaluateAdmission({ mode: "arbitrate" }, baseRequest()),
                evaluateAdmission(
                    { mode: "allowAll", deny: [ALICE_CHECKSUM] },
                    baseRequest()
                ),
                evaluateAdmission(
                    { mode: "allowAll", minAmount: "100" },
                    baseRequest({ amount: "1" })
                ),
                evaluateAdmission(
                    { mode: "allowAll" },
                    baseRequest({ peerAddress: MALFORMED_ADDRESS })
                )
            ];

            for (const decision of allDecisions) {
                if (!decision.allow) {
                    expect(decision.reason).to.be.oneOf([
                        "busy",
                        "full",
                        "terms",
                        "policy"
                    ]);
                    expect(decision.reason).to.not.equal("busy");
                    expect(decision.reason).to.not.equal("full");
                }
            }
        });

        it("amount out of range produces 'terms'", () => {
            const decision = evaluateAdmission(
                { mode: "allowAll", minAmount: "100", maxAmount: "200" },
                baseRequest({ amount: "50" })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });

        it("denyAll produces 'policy'", () => {
            const decision = evaluateAdmission(
                { mode: "denyAll" },
                baseRequest()
            );
            expect(decision).to.deep.equal({ allow: false, reason: "policy" });
        });

        it("arbitrate produces 'policy' in Phase 1 (no bus round-trip)", () => {
            const decision = evaluateAdmission(
                { mode: "arbitrate" },
                baseRequest()
            );
            expect(decision).to.deep.equal({ allow: false, reason: "policy" });
        });
    });

    describe("checksummed address comparison", () => {
        it("mixed-case, checksummed, and lowercase requester addresses produce identical decisions", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                deny: [ALICE_MIXED]
            };

            const decisionLower = evaluateAdmission(
                policy,
                baseRequest({ peerAddress: ALICE_LOWER })
            );
            const decisionChecksum = evaluateAdmission(
                policy,
                baseRequest({ peerAddress: ALICE_CHECKSUM })
            );
            const decisionMixed = evaluateAdmission(
                policy,
                baseRequest({ peerAddress: ALICE_MIXED })
            );

            expect(decisionLower).to.deep.equal({
                allow: false,
                reason: "policy"
            });
            expect(decisionChecksum).to.deep.equal(decisionLower);
            expect(decisionMixed).to.deep.equal(decisionLower);
        });

        it("casing on the policy's allow-list entry does not change the decision", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                allow: [ALICE_MIXED]
            };

            const decision = evaluateAdmission(
                policy,
                baseRequest({ peerAddress: ALICE_LOWER })
            );
            expect(decision).to.deep.equal({ allow: true });
        });
    });

    describe("deny-wins and empty-allow-list semantics", () => {
        it("an address in BOTH allow and deny is denied with reason 'policy'", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                allow: [ALICE_CHECKSUM],
                deny: [ALICE_CHECKSUM]
            };
            const decision = evaluateAdmission(policy, baseRequest());
            expect(decision).to.deep.equal({ allow: false, reason: "policy" });
        });

        it("empty allow list means 'no allow-list configured' (allow all), not 'allow nobody'", () => {
            const policy: AdmissionPolicy = { mode: "allowAll", allow: [] };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ peerAddress: BOB })
            );
            expect(decision).to.deep.equal({ allow: true });
        });

        it("a non-empty allow list denies addresses not on it", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                allow: [ALICE_CHECKSUM]
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ peerAddress: CAROL })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "policy" });
        });

        it("a non-empty allow list allows an address that IS on it", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                allow: [ALICE_CHECKSUM, BOB]
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ peerAddress: BOB })
            );
            expect(decision).to.deep.equal({ allow: true });
        });
    });

    describe("malformed input handling (fail closed, never throw)", () => {
        it("a malformed requester address (not 20 bytes) is denied with reason 'policy' and does not throw", () => {
            expect(() =>
                evaluateAdmission(
                    DEFAULT_ADMISSION_POLICY,
                    baseRequest({ peerAddress: MALFORMED_ADDRESS })
                )
            ).to.not.throw();

            const decision = evaluateAdmission(
                DEFAULT_ADMISSION_POLICY,
                baseRequest({ peerAddress: MALFORMED_ADDRESS })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "policy" });
        });

        it("a malformed amount decimal string denies with 'terms' and does not throw", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "100"
            };
            expect(() =>
                evaluateAdmission(
                    policy,
                    baseRequest({ amount: "not-a-number" })
                )
            ).to.not.throw();

            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: "not-a-number" })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });

        it("a missing amount when bounds are configured denies with 'terms'", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "100"
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: undefined })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });

        it("a hex-formatted amount is denied with 'terms' — BigInt's leniency (accepting '0x64' as 100) must not leak through", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "1",
                maxAmount: "1000"
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: "0x64" })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });

        it("an empty-string amount is denied with 'terms' — BigInt('') coercing to 0n must not silently pass a minAmount<=0 bound", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "0"
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: "" })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });

        it("a whitespace-padded amount is denied with 'terms' — BigInt tolerates surrounding whitespace, the strict decimal gate must not", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "1",
                maxAmount: "1000"
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: " 100 " })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });

        it("a negative amount string with bounds configured is denied with 'terms' — negative is malformed for a uint256-dec amount, by design", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "0",
                maxAmount: "1000"
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: "-50" })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });

        it("a very large decimal amount string is compared correctly end-to-end via BigInt: in range", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "1",
                maxAmount: "999999999999999999999999999999999999"
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: "99999999999999999999999999999999" })
            );
            expect(decision).to.deep.equal({ allow: true });
        });

        it("a very large decimal amount string is compared correctly end-to-end via BigInt: out of range", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                maxAmount: "99999999999999999999999999999998"
            };
            const decision = evaluateAdmission(
                policy,
                baseRequest({ amount: "99999999999999999999999999999999" })
            );
            expect(decision).to.deep.equal({ allow: false, reason: "terms" });
        });
    });

    describe("clone-safety (F5)", () => {
        it("JSON.parse(JSON.stringify(policy)) round-trips to an identical policy", () => {
            const policy: AdmissionPolicy = {
                mode: "arbitrate",
                minAmount: "100",
                maxAmount: "200",
                allow: [ALICE_CHECKSUM],
                deny: [BOB],
                decisionTimeoutMs: 5000,
                onTimeout: "deny"
            };

            const roundTripped = JSON.parse(JSON.stringify(policy));
            expect(roundTripped).to.deep.equal(policy);
        });

        it("structuredClone(policy) succeeds and produces an identical policy", () => {
            const policy: AdmissionPolicy = {
                mode: "denyAll",
                allow: [ALICE_CHECKSUM, BOB],
                deny: [CAROL]
            };

            const cloned = structuredClone(policy);
            expect(cloned).to.deep.equal(policy);
        });

        it("DEFAULT_ADMISSION_POLICY is clone-safe", () => {
            expect(structuredClone(DEFAULT_ADMISSION_POLICY)).to.deep.equal(
                DEFAULT_ADMISSION_POLICY
            );
            expect(
                JSON.parse(JSON.stringify(DEFAULT_ADMISSION_POLICY))
            ).to.deep.equal(DEFAULT_ADMISSION_POLICY);
        });
    });

    describe("purity", () => {
        it("does not mutate the policy or request objects", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                deny: [ALICE_CHECKSUM],
                allow: [BOB]
            };
            const req = baseRequest({ amount: "150" });

            const policySnapshot = JSON.parse(JSON.stringify(policy));
            const reqSnapshot = JSON.parse(JSON.stringify(req));

            evaluateAdmission(policy, req);

            expect(policy).to.deep.equal(policySnapshot);
            expect(req).to.deep.equal(reqSnapshot);
        });

        it("produces the same decision for the same inputs on repeated calls", () => {
            const policy: AdmissionPolicy = {
                mode: "allowAll",
                minAmount: "100",
                maxAmount: "200",
                deny: [BOB]
            };
            const req = baseRequest({ amount: "150" });

            const first = evaluateAdmission(policy, req);
            const second = evaluateAdmission(policy, req);
            expect(first).to.deep.equal(second);
        });
    });
});
