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
/** The balance, nonce and code a backfill read for an account. */
const ACCOUNT = { balance: "0x9", nonce: 2, code: "0x6001" };

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

    // Mutation: a slot missing from a complete account reads as uncached.
    it("reads a slot a complete account never wrote as zero, and an unread slot of another account as uncached", function () {
        const cache = new StateCache();
        cache.setComplete(A, ACCOUNT, { [SLOT]: FIVE });

        expect(cache.get(slot(A, SLOT))).to.equal(FIVE);
        expect(cache.get(slot(A, OTHER_SLOT))).to.equal(ZERO_WORD);
        expect(cache.get(slot(B, SLOT))).to.equal(undefined);
    });

    // Mutation: applyForward writes only slots somebody read, also of a complete account.
    it("moves a slot of a complete account nobody read forward over a block", function () {
        const cache = new StateCache();
        cache.setComplete(A, ACCOUNT, {});

        cache.applyForward({
            pre: { [A]: { storage: { [SLOT]: ZERO_WORD } } },
            post: { [A]: { storage: { [SLOT]: SEVEN } } }
        });

        expect(cache.get(slot(A, SLOT))).to.equal(SEVEN);
        expect(cache.accountOf(A).storage).to.deep.equal({ [SLOT]: SEVEN });
    });

    // Mutation: applyBackward restores only slots the cache holds, so a
    // complete account keeps the zero of a rolled-back block that cleared a slot.
    it("moves a slot of a complete account back to its pre value over a rolled-back block that cleared it", function () {
        const cache = new StateCache();
        // the backfill read the state after the block: the cleared slot is absent
        cache.setComplete(A, ACCOUNT, {});

        cache.applyBackward({
            pre: { [A]: { storage: { [SLOT]: FIVE } } },
            post: { [A]: { storage: { [SLOT]: ZERO_WORD } } }
        });

        expect(cache.get(slot(A, SLOT))).to.equal(FIVE);
        expect(cache.accountOf(A).storage).to.deep.equal({ [SLOT]: FIVE });
        expect(cache.nonZeroSlots(A)).to.equal(1);
    });

    // Mutation: setComplete keeps slots cached before it.
    it("replaces what was cached of an account when it is made complete, and reports it in the shape of a record", function () {
        const cache = new StateCache();
        cache.set(slot(A, OTHER_SLOT), SEVEN);

        cache.setComplete(A, ACCOUNT, { [SLOT]: FIVE });

        expect(cache.isComplete(A)).to.equal(true);
        expect(cache.accountOf(A)).to.deep.equal({
            ...ACCOUNT,
            storage: { [SLOT]: FIVE }
        });
    });

    // Mutation: nonZeroSlots counts zero words.
    it("counts only the non-zero slots of an account", function () {
        const cache = new StateCache();
        cache.setComplete(A, ACCOUNT, { [SLOT]: FIVE });
        cache.applyForward({
            pre: { [A]: { storage: { [SLOT]: FIVE } } },
            post: { [A]: { storage: { [SLOT]: ZERO_WORD } } }
        });
        cache.set(slot(A, OTHER_SLOT), SEVEN);

        expect(cache.nonZeroSlots(A)).to.equal(1);
    });

    // Mutation: markLazy keeps the account complete, or drops its cached slots.
    it("keeps the cached slots of an account marked lazy and reads its other slots as uncached", function () {
        const cache = new StateCache();
        cache.setComplete(A, ACCOUNT, { [SLOT]: FIVE });

        cache.markLazy(A);

        expect(cache.isComplete(A)).to.equal(false);
        expect(cache.get(slot(A, SLOT))).to.equal(FIVE);
        expect(cache.get(slot(A, OTHER_SLOT))).to.equal(undefined);
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

    // Mutation: forget keeps a scalar or the slots, or drops another account's.
    it("forgets every field of one account and keeps another account's", function () {
        const cache = new StateCache();
        for (const address of [A, B]) {
            cache.set({ kind: "balance", address }, "0x1");
            cache.set({ kind: "nonce", address }, 3);
            cache.set({ kind: "code", address }, "0x00");
            cache.set(slot(address, SLOT), FIVE);
        }

        cache.forget(A);

        const fields = (address: string) => [
            cache.get({ kind: "balance", address }),
            cache.get({ kind: "nonce", address }),
            cache.get({ kind: "code", address }),
            cache.get(slot(address, SLOT))
        ];
        expect(fields(A)).to.deep.equal([
            undefined,
            undefined,
            undefined,
            undefined
        ]);
        expect(fields(B)).to.deep.equal(["0x1", 3, "0x00", FIVE]);
    });

    // Mutation: clear keeps the set of complete accounts.
    it("forgets on clear that an account was complete", function () {
        const cache = new StateCache();
        cache.setComplete(A, ACCOUNT, {});

        cache.clear();

        expect(cache.isComplete(A)).to.equal(false);
        expect(cache.get(slot(A, SLOT))).to.equal(undefined);
    });

    // Mutation: forget keeps the account complete -> its unread slot reads as zero.
    it("forgets that a forgotten account was complete", function () {
        const cache = new StateCache();
        cache.setComplete(A, ACCOUNT, {});

        cache.forget(A);

        expect(cache.isComplete(A)).to.equal(false);
        expect(cache.get(slot(A, SLOT))).to.equal(undefined);
    });
});
