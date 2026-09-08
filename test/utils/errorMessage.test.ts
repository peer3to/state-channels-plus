import { errorMessage } from "@/utils/errorMessage";
import { expect } from "chai";

describe("errorMessage", function () {
    it("formats Error", function () {
        expect(errorMessage(new Error("failed"))).to.equal("failed");
    });
    it("formats empty Error", function () {
        expect(errorMessage(new Error(""))).to.equal("");
    });
    it("formats string", function () {
        expect(errorMessage("failed")).to.equal("failed");
    });
    it("formats null", function () {
        expect(errorMessage(null)).to.equal("null");
    });
    it("formats undefined", function () {
        expect(errorMessage(undefined)).to.equal("undefined");
    });
    it("formats number", function () {
        expect(errorMessage(42)).to.equal("42");
    });
    it("formats symbol", function () {
        expect(errorMessage(Symbol("failure"))).to.equal("Symbol(failure)");
    });
    it("formats custom conversion", function () {
        expect(errorMessage({ toString: () => "custom failure" })).to.equal(
            "custom failure"
        );
    });
});
