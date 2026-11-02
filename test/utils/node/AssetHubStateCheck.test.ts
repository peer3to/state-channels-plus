import {
    childStorageKey,
    findChangedBlocks,
    reviveAccountInfoKey,
    trieIdOf
} from "@/utils/node/storageDiff/assetHubStateCheck";
import { expect } from "chai";

/** `Revive::AccountInfoOf` of a mainnet contract and the value Asset Hub held for it. */
const RECORDED_ADDRESS = "0x99ee73298423dcf5da3059a5e48bda20bfbcd01b";
const RECORDED_KEY =
    "0x735f040a5d490f1107ad9c56f5ca00d2ae37ff0591fdbbcd9c2406df7147a9dc99ee73298423dcf5da3059a5e48bda20bfbcd01b";
const RECORDED_INFO =
    "0x0080534cf48ba03bfd9aad907397c556b60630666df566b309489b078f1ea2462806df37580a5890e6391148efc9cbc03c58a4b737422ca66bb8a9ae1928f39bacb5406a0000a901000001e81fa200000000000000000000000001b5a3fa0100000000000000000000005084b5e80000000000000000000000000000000000000000";
const RECORDED_TRIE_ID =
    "0x534cf48ba03bfd9aad907397c556b60630666df566b309489b078f1ea2462806";

describe("Asset Hub state check helpers", function () {
    it("derives the AccountInfoOf key of an address as the node holds it", function () {
        expect(reviveAccountInfoKey(RECORDED_ADDRESS)).to.equal(RECORDED_KEY);
        expect(
            reviveAccountInfoKey(
                RECORDED_ADDRESS.toUpperCase().replace("0X", "0x")
            )
        ).to.equal(RECORDED_KEY);
    });

    it("refuses an address that is not 20 bytes", function () {
        expect(() => reviveAccountInfoKey("0x1234")).to.throw();
    });

    it("reads the child trie id of a contract's account info", function () {
        expect(trieIdOf(RECORDED_INFO)).to.equal(RECORDED_TRIE_ID);
    });

    it("reads no trie id from an account that is not a contract", function () {
        expect(trieIdOf("0x0100000000")).to.equal(undefined);
    });

    // Mutation: a multi-byte compact length is read as a one-byte one.
    it("refuses a contract's account info whose trie id length is not a one-byte compact", function () {
        // variant 0, then compact mode 1: a two-byte length
        expect(() => trieIdOf("0x000101" + "ab".repeat(64))).to.throw(
            "Unexpected trie id length encoding"
        );
    });

    // Mutation: a short value yields the bytes it has as the trie id.
    it("refuses a contract's account info shorter than the trie id it claims", function () {
        // variant 0 claiming 32 bytes (0x80 = 32 << 2) with only 10 present
        expect(() => trieIdOf("0x0080" + "ab".repeat(10))).to.throw(
            "Truncated account info"
        );
    });

    it("names the child trie by the prefixed storage key", function () {
        expect(childStorageKey(RECORDED_TRIE_ID)).to.equal(
            "0x3a6368696c645f73746f726167653a64656661756c743a" +
                RECORDED_TRIE_ID.slice(2)
        );
    });

    it("finds the blocks after which a trie root changes, in few reads", async function () {
        // the root is the number of changes at or before the block
        const changes = [3, 4, 500, 999_999];
        const roots = async (blocks: number[]) =>
            blocks.map((n) =>
                n < 3 ? undefined : String(changes.filter((c) => c <= n).length)
            );

        const result = await findChangedBlocks(roots, 0, 1_000_000);

        expect(result.changed).to.deep.equal(changes);
        expect(result.rootReads).to.be.lessThan(changes.length * 2 * 21);
    });

    it("finds nothing when the root is the same at both ends", async function () {
        const result = await findChangedBlocks(
            async (blocks) => blocks.map(() => "0xroot"),
            10,
            1_000
        );
        expect(result.changed).to.deep.equal([]);
        expect(result.roundTrips).to.equal(1);
    });

    it("finds a change in the last block of the range", async function () {
        const result = await findChangedBlocks(
            async (blocks) => blocks.map((n) => (n >= 64 ? "b" : "a")),
            0,
            64
        );
        expect(result.changed).to.deep.equal([64]);
    });
});
