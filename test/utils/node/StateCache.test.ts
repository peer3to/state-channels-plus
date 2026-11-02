import { ZERO_WORD } from "@/utils/node/storageDiff/blockStorageDiff";
import {
    StateCache,
    type StateField
} from "@/utils/node/storageDiff/StateCache";
import { expect } from "chai";
import { toBeHex } from "ethers";

const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const SLOT = toBeHex(1, 32);
const OTHER_SLOT = toBeHex(2, 32);
const FIVE = toBeHex(5, 32);
const SEVEN = toBeHex(7, 32);

const slot = (address: string, key: string): StateField => ({
    kind: "slot",
    address,
    slot: key
});

describe("StateCache", function () {
    // Mutation: applyForward inserts a field nobody read.
    it("moves cached fields forward over a block and leaves the fields nobody read uncached", function () {
        const cache = new StateCache();
        cache.set(slot(A, SLOT), FIVE);

        cache.applyForward({
            pre: {},
            post: {
                [A]: { storage: { [SLOT]: SEVEN, [OTHER_SLOT]: SEVEN } },
                [B]: { balance: "0x5" }
            }
        });

        expect(cache.get(slot(A, SLOT))).to.equal(SEVEN);
        expect(cache.get(slot(A, OTHER_SLOT))).to.equal(undefined);
        expect(cache.get({ kind: "balance", address: B })).to.equal(undefined);
    });

    // Mutation: a balance cached as the block wrote it, not normalized.
    it("keeps a balance a block writes in its canonical form", function () {
        const cache = new StateCache();
        cache.set({ kind: "balance", address: A }, "0x1");

        cache.applyForward({ pre: {}, post: { [A]: { balance: "0x0005" } } });

        expect(cache.get({ kind: "balance", address: A })).to.equal("0x5");
    });

    // Mutation: applyBackward keeps the post value of an orphaned block.
    it("moves a cached slot back to its pre value over a rolled-back block", function () {
        const cache = new StateCache();
        cache.set(slot(A, SLOT), SEVEN);

        cache.applyBackward({
            pre: { [A]: { storage: { [SLOT]: FIVE } } },
            post: { [A]: { storage: { [SLOT]: SEVEN } } }
        });

        expect(cache.get(slot(A, SLOT))).to.equal(FIVE);
    });

    // Mutation: an account only in post keeps its values when rolled back.
    it("empties the cached fields of an account a rolled-back block created", function () {
        const cache = new StateCache();
        cache.set({ kind: "balance", address: A }, "0x5");
        cache.set({ kind: "nonce", address: A }, 1);
        cache.set({ kind: "code", address: A }, "0x60");
        cache.set(slot(A, SLOT), SEVEN);

        cache.applyBackward({
            pre: {},
            post: {
                [A]: { nonce: 1, code: "0x60", storage: { [SLOT]: SEVEN } }
            }
        });

        expect([
            cache.get({ kind: "balance", address: A }),
            cache.get({ kind: "nonce", address: A }),
            cache.get({ kind: "code", address: A }),
            cache.get(slot(A, SLOT))
        ]).to.deep.equal(["0x0", 0, "0x", ZERO_WORD]);
    });

    // Mutation: clear keeps scalars or slots.
    it("forgets every field on clear", function () {
        const cache = new StateCache();
        cache.set({ kind: "nonce", address: A }, 3);
        cache.set(slot(A, SLOT), FIVE);

        cache.clear();

        expect(cache.get({ kind: "nonce", address: A })).to.equal(undefined);
        expect(cache.get(slot(A, SLOT))).to.equal(undefined);
    });
});
