import {
    KillDelivery,
    planKillDelivery
} from "@/disputeManager/planKillDelivery";
import { expect } from "chai";

// the chain's per-transaction calldata limit (64 KiB)
const LIMIT = 65_536;

describe("Unit: planKillDelivery", function () {
    it("kill and upload fit one transaction -> the kill goes first in the upload's multicall", function () {
        expect(planKillDelivery(20_000, 45_000, LIMIT)).to.equal(
            KillDelivery.InMulticall
        );
    });

    it("the multicall is exactly at the limit -> it still goes as one multicall", function () {
        expect(planKillDelivery(30_000, LIMIT, LIMIT)).to.equal(
            KillDelivery.InMulticall
        );
    });

    it("the multicall is one byte over the limit -> the kill goes alone ahead of the upload", function () {
        expect(planKillDelivery(30_000, LIMIT + 1, LIMIT)).to.equal(
            KillDelivery.Alone
        );
    });

    it("the kill alone is exactly at the limit -> it goes alone", function () {
        expect(planKillDelivery(LIMIT, LIMIT + 5_000, LIMIT)).to.equal(
            KillDelivery.Alone
        );
    });

    it("the kill alone is one byte over the limit -> it is not sent, the upload still goes", function () {
        expect(planKillDelivery(LIMIT + 1, LIMIT + 5_000, LIMIT)).to.equal(
            KillDelivery.NotSent
        );
    });
});
