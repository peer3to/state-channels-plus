import { recordedTrace } from "../../fixtures/node/RecordedAssetHubTrace";
import {
    hasRevertedFrame,
    mergeTransactionDiffs,
    touchesOf,
    ZERO_WORD
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

// The frames below are the ones Asset Hub eth-rpc answered for a block with one
// transaction to a mainnet contract (assetHubTrace.recorded.json); the tests
// above build their frames by hand.
describe("recorded Asset Hub traces", function () {
    const CONTRACT = "0x99ee73298423dcf5da3059a5e48bda20bfbcd01b";
    const SENDER = "0xaae3888b4f00d29293ff8aeaf79fb4020c2e5752";
    const TOKEN = "0x6e33dd88e159b0239d049486494074cda1858bb4";
    // the slot the transaction cleared: in the recorded `pre`, not in `post`
    const CLEARED_SLOT =
        "0x3b9baa3a8af4d06d8723f9c29d48b56ceba6d1db5ba46e8efdf4de17279e4b5f";

    // Mutation: touchesOf reads `post` only -> the cleared slot is missing.
    it("names the accounts and storage keys of a recorded prestate diff and flags what its post shows", function () {
        const touches = touchesOf(recordedTrace.pre);

        expect(Object.keys(touches).sort()).to.deep.equal(
            [CONTRACT, SENDER, TOKEN].sort()
        );
        expect(touches[CONTRACT].slots).to.have.length(5);
        expect(touches[CONTRACT].slots).to.include(CLEARED_SLOT);
        expect(touches[CONTRACT].changed).to.deep.equal({
            balance: true,
            nonce: false,
            code: false
        });
        expect(touches[SENDER]).to.deep.equal({
            slots: [],
            changed: { balance: true, nonce: true, code: false }
        });
    });

    // Mutation: a slot `post` omits is dropped instead of read as zero.
    it("reads a slot a recorded post omits as cleared to zero", function () {
        const { pre, post } = mergeTransactionDiffs(recordedTrace.pre);

        expect(post[CONTRACT].storage![CLEARED_SLOT]).to.equal(ZERO_WORD);
        expect(pre[CONTRACT].storage![CLEARED_SLOT]).to.not.equal(ZERO_WORD);
    });

    // Mutation: a frame without calls counts as failed.
    it("finds no failure in a recorded call tree with nested calls", function () {
        const [{ result }] = recordedTrace.call;

        expect(result.calls).to.have.length(2);
        expect(hasRevertedFrame(recordedTrace.call, 1)).to.equal(false);
    });

    // Mutation: nested calls are not looked into. The recording holds no
    // reverted sub-call (see its note): the error is injected into a nested
    // frame of the recorded tree.
    it("finds a failure once a nested frame of the recorded call tree carries an error", function () {
        const reverted = structuredClone(recordedTrace.call);
        (reverted[0].result.calls as object[])[1] = {
            ...(reverted[0].result.calls as object[])[1],
            error: "execution reverted"
        };

        expect(hasRevertedFrame(reverted, 1)).to.equal(true);
    });
});
