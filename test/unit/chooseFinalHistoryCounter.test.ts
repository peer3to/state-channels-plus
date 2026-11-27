import { chooseFinalHistoryCounter } from "@/stateManager/dispute/chooseFinalHistoryCounter";
import { Address } from "@/types/types";
import { randomAddress } from "@test/factory";
import { expect } from "chai";

// the chain's per-transaction calldata limit (64 KiB)
const LIMIT = 65_536;
const A = randomAddress();
const B = randomAddress();
const C = randomAddress();

function counter(name: string, slashes: Address[], killBytes: number) {
    return { name, slashes, killBytes };
}

describe("Unit: chooseFinalHistoryCounter", function () {
    it("no counter -> undefined", function () {
        expect(chooseFinalHistoryCounter([], LIMIT)).to.equal(undefined);
    });

    it("two fitting counters -> the one that slashes more addresses, though it comes later", function () {
        const chosen = chooseFinalHistoryCounter(
            [counter("tail", [], 9_000), counter("hop", [A, B], 9_500)],
            LIMIT
        );

        expect(chosen?.name).to.equal("hop");
    });

    it("two fitting counters with equal slash sets -> the earlier one", function () {
        const chosen = chooseFinalHistoryCounter(
            [
                counter("conflict", [A], 9_000),
                counter("regression", [B], 8_000)
            ],
            LIMIT
        );

        expect(chosen?.name).to.equal("conflict");
    });

    it("the larger slash set does not fit one transaction -> the smaller one that fits", function () {
        const chosen = chooseFinalHistoryCounter(
            [
                counter("oversized", [A, B, C], LIMIT + 1),
                counter("fits", [A], LIMIT)
            ],
            LIMIT
        );

        expect(chosen?.name).to.equal("fits");
    });

    it("no counter fits one transaction -> the one with the largest slash set, too large to send", function () {
        const chosen = chooseFinalHistoryCounter(
            [
                counter("small", [A], LIMIT + 10),
                counter("large", [A, B], LIMIT + 20)
            ],
            LIMIT
        );

        expect(chosen?.name).to.equal("large");
    });
});
