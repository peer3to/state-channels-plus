import {
    hasRevertedFrame,
    touchesOf
} from "@/utils/node/storageDiff/blockStorageDiff";
import { expect } from "chai";
import { toBeHex } from "ethers";

const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const SLOT = toBeHex(1, 32);
const WORD = toBeHex(5, 32);

describe("touchesOf", function () {
    it("names the storage keys of pre and post and flags the scalars post shows", function () {
        const touches = touchesOf([
            {
                result: {
                    pre: {
                        [A]: { balance: "0x1", nonce: 1, code: "0x00" },
                        [B]: { balance: "0x1" }
                    },
                    post: {
                        [A]: { storage: { [SLOT]: WORD } },
                        [B]: { balance: "0x2" }
                    }
                }
            }
        ]);

        expect(touches[A]).to.deep.equal({
            slots: [SLOT],
            changed: { balance: false, nonce: false, code: false }
        });
        expect(touches[B].changed).to.deep.equal({
            balance: true,
            nonce: false,
            code: false
        });
    });

    it("flags every scalar of an account that post leaves out", function () {
        const touches = touchesOf([
            { result: { pre: { [A]: { balance: "0x1" } }, post: {} } }
        ]);

        expect(touches[A].changed).to.deep.equal({
            balance: true,
            nonce: true,
            code: true
        });
    });

    it("keeps a flag set by any transaction of the block", function () {
        const touches = touchesOf([
            { result: { pre: {}, post: { [A]: { nonce: 2 } } } },
            {
                result: {
                    pre: {},
                    post: { [A]: { storage: { [SLOT]: WORD } } }
                }
            }
        ]);

        expect(touches[A].changed.nonce).to.equal(true);
        expect(touches[A].slots).to.deep.equal([SLOT]);
    });
});

describe("hasRevertedFrame", function () {
    const ok = { from: A, to: B, type: "CALL" };

    it("finds no failure in clean frames, nested calls included", function () {
        const trace = [{ result: { ...ok, calls: [{ ...ok, calls: [ok] }] } }];
        expect(hasRevertedFrame(trace, 1)).to.equal(false);
    });

    it("finds a failure on the top frame", function () {
        const trace = [{ result: { ...ok, error: "execution reverted" } }];
        expect(hasRevertedFrame(trace, 1)).to.equal(true);
    });

    it("finds a failure on a nested frame two calls deep", function () {
        const trace = [
            {
                result: {
                    ...ok,
                    calls: [{ ...ok, calls: [{ ...ok, error: "out of gas" }] }]
                }
            }
        ];
        expect(hasRevertedFrame(trace, 1)).to.equal(true);
    });

    it("finds a failure in any transaction of the block", function () {
        const trace = [
            { result: ok },
            { result: { ...ok, calls: [{ ...ok, error: "reverted" }] } }
        ];
        expect(hasRevertedFrame(trace, 2)).to.equal(true);
    });

    it("counts an entry with an error of its own, a missing trace or a wrong length as failed", function () {
        expect(hasRevertedFrame([{ error: "x" }], 1)).to.equal(true);
        expect(hasRevertedFrame(undefined, 1)).to.equal(true);
        expect(hasRevertedFrame([{ result: ok }], 2)).to.equal(true);
    });
});
