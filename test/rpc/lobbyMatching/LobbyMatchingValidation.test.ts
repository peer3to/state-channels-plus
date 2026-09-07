import { validateMatchTimeout } from "@/rpc/services/lobbyMatching/LobbyMatchingValidation";
import { expect } from "chai";

describe("LobbyMatchingValidation", function () {
    it("accepts omitted timeout", function () {
        expect(validateMatchTimeout(undefined)).to.equal(undefined);
    });
    it("accepts null timeout", function () {
        expect(validateMatchTimeout(null)).to.equal(undefined);
    });
    it("accepts positive integer timeout", function () {
        expect(validateMatchTimeout(1)).to.equal(1);
    });
    it("accepts largest safe timeout", function () {
        expect(validateMatchTimeout(Number.MAX_SAFE_INTEGER)).to.equal(
            Number.MAX_SAFE_INTEGER
        );
    });
    it("rejects zero timeout", function () {
        expect(() => validateMatchTimeout(0)).to.throw(
            "Lobby match timeout must be a positive integer"
        );
    });
    it("rejects negative timeout", function () {
        expect(() => validateMatchTimeout(-1)).to.throw(
            "Lobby match timeout must be a positive integer"
        );
    });
    it("rejects fractional timeout", function () {
        expect(() => validateMatchTimeout(0.5)).to.throw(
            "Lobby match timeout must be a positive integer"
        );
    });
    it("rejects unsafe timeout", function () {
        expect(() =>
            validateMatchTimeout(Number.MAX_SAFE_INTEGER + 1)
        ).to.throw("Lobby match timeout must be a positive integer");
    });
    it("rejects infinite timeout", function () {
        expect(() => validateMatchTimeout(Infinity)).to.throw(
            "Lobby match timeout must be a positive integer"
        );
    });
    it("rejects NaN timeout", function () {
        expect(() => validateMatchTimeout(NaN)).to.throw(
            "Lobby match timeout must be a positive integer"
        );
    });
});
