import {
    recordedChildTrie,
    withRecordedChildTrieNode
} from "../../fixtures/node/RecordedAssetHubChildTrie";
import {
    chain,
    CHILD_TRIE_ADDRESS,
    CHILD_TRIE_TIP,
    NO_UPSTREAM,
    withSource
} from "../../fixtures/node/StorageDiffBackfillFixture";
import { ChainMovedError } from "@/utils/node/storageDiff/backfillBlocks/ABackfillBlockSource";
import {
    ChildTrieBlockSource,
    findChangedBlocks,
    reviveAccountInfoKey,
    trieIdOf
} from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import { expect } from "chai";

describe("ChildTrieBlockSource", function () {
    // The recorded tests replay real Asset Hub answers. The tests below them
    // use a scripted node (SubstrateChildTrieNode) for what the recording
    // cannot hold: a range of a million blocks, page sizes, and a chain that
    // moves during the bisection.
    // Mutation (the three recorded tests): a block that changed the trie is
    // not listed, a key page is miscounted, or the range starts one block late.
    it("lists the blocks of a mainnet contract's transactions as the Asset Hub node recorded its child trie roots", async function () {
        await withRecordedChildTrieNode(async (node) => {
            const source = new ChildTrieBlockSource(node.url);
            try {
                const listing = await source.listBlocks(
                    NO_UPSTREAM,
                    recordedChildTrie.address,
                    BigInt(recordedChildTrie.from),
                    { number: BigInt(recordedChildTrie.tip), hash: "0xeth" }
                );

                expect(listing.numbers).to.deep.equal(
                    recordedChildTrie.changedBlocks.map(BigInt)
                );
                expect(node.unrecorded()).to.deep.equal([]);
            } finally {
                source.close();
            }
        });
    });

    it("lists nothing from the block after the last recorded change", async function () {
        await withRecordedChildTrieNode(async (node) => {
            const source = new ChildTrieBlockSource(node.url);
            try {
                const listing = await source.listBlocks(
                    NO_UPSTREAM,
                    recordedChildTrie.address,
                    BigInt(recordedChildTrie.afterLastChange),
                    { number: BigInt(recordedChildTrie.tip), hash: "0xeth" }
                );

                expect(listing.numbers).to.deep.equal([]);
                expect(node.unrecorded()).to.deep.equal([]);
            } finally {
                source.close();
            }
        });
    });

    it("counts the entries of a mainnet contract's recorded child trie", async function () {
        await withRecordedChildTrieNode(async (node) => {
            const source = new ChildTrieBlockSource(node.url);
            try {
                expect(
                    await source.countStorageEntries(
                        NO_UPSTREAM,
                        recordedChildTrie.address,
                        { number: BigInt(recordedChildTrie.tip) }
                    )
                ).to.equal(recordedChildTrie.entries);
                expect(node.unrecorded()).to.deep.equal([]);
            } finally {
                source.close();
            }
        });
    });

    it("lists the blocks that changed the contract, reading far fewer roots than blocks", async function () {
        const changes = [400, 401, 500_000, 999_999];
        await withSource(
            chain({ changes, deployed: 400 }),
            async (source, node) => {
                const listing = await source.listBlocks(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    400n,
                    CHILD_TRIE_TIP
                );

                expect(listing.numbers).to.deep.equal(changes.map(BigInt));
                // a bisection over 999,601 blocks
                expect(node.rootReads()).to.be.lessThan(200);
            }
        );
    });

    it("lists nothing for a range in which the contract did not change", async function () {
        await withSource(
            chain({ changes: [10], deployed: 10 }),
            async (source) => {
                const listing = await source.listBlocks(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    11n,
                    CHILD_TRIE_TIP
                );
                expect(listing.numbers).to.deep.equal([]);
            }
        );
    });

    it("fails with a chain move when the tip block changed during the bisection", async function () {
        let asked = 0;
        await withSource(
            chain({
                changes: [500],
                deployed: 500,
                tipHash: () => (asked++ < 1 ? "0xtip" : "0xother")
            }),
            async (source) => {
                const error = await source
                    .listBlocks(
                        NO_UPSTREAM,
                        CHILD_TRIE_ADDRESS,
                        500n,
                        CHILD_TRIE_TIP
                    )
                    .then(
                        () => undefined,
                        (reason: unknown) => reason
                    );
                expect(error).to.be.instanceOf(ChainMovedError);
            }
        );
    });

    // Mutation: a null block hash is passed on as the block to read, which
    // the node reads as its older best block.
    it("lists a change in the tip block once a Substrate node that had not reached the tip has", async function () {
        const tip = Number(CHILD_TRIE_TIP.number);
        await withSource(
            chain({
                changes: [400, tip],
                deployed: 400,
                lag: { blocks: 2, ms: 300 }
            }),
            async (source) => {
                const listing = await source.listBlocks(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    400n,
                    CHILD_TRIE_TIP
                );

                expect(listing.numbers).to.deep.equal([400n, BigInt(tip)]);
            }
        );
    });

    // Mutation: a null block hash is passed on as the block to count at.
    it("counts the entries at the asked block once a Substrate node that had not reached it has", async function () {
        const tip = Number(CHILD_TRIE_TIP.number);
        await withSource(
            chain({
                entries: (blockNumber) => (blockNumber >= tip ? 5 : 3),
                lag: { blocks: 2, ms: 300 }
            }),
            async (source) => {
                expect(
                    await source.countStorageEntries(
                        NO_UPSTREAM,
                        CHILD_TRIE_ADDRESS,
                        CHILD_TRIE_TIP
                    )
                ).to.equal(5);
            }
        );
    });

    it("fails with a chain move when the Substrate node stays behind the block it is asked for", async function () {
        await withSource(
            chain({ entries: 5, lag: { blocks: 1, ms: 60_000 } }),
            async (source) => {
                const error = await source
                    .countStorageEntries(
                        NO_UPSTREAM,
                        CHILD_TRIE_ADDRESS,
                        CHILD_TRIE_TIP
                    )
                    .then(
                        () => undefined,
                        (reason: unknown) => reason
                    );
                expect(error).to.be.instanceOf(ChainMovedError);
            }
        );
    });

    it("fails for an address that is not a contract", async function () {
        await withSource(chain({ info: null }), async (source) => {
            const error = await source
                .listBlocks(NO_UPSTREAM, CHILD_TRIE_ADDRESS, 1n, CHILD_TRIE_TIP)
                .then(
                    () => undefined,
                    (reason: unknown) => reason
                );
            expect((error as Error).message).to.equal(
                "The address is not a contract"
            );
        });
    });

    // Mutation: a count of an account without a contract fails like a listing.
    it("counts no entries for an address that is not a contract", async function () {
        await withSource(chain({ info: null }), async (source) => {
            expect(
                await source.countStorageEntries(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    CHILD_TRIE_TIP
                )
            ).to.equal(0);
        });
    });

    it("counts the entries of the contract's child trie across pages", async function () {
        await withSource(chain({ entries: 2_345 }), async (source) => {
            expect(
                await source.countStorageEntries(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    CHILD_TRIE_TIP
                )
            ).to.equal(2_345);
        });
    });

    it("shares the block hash read of counts asked for at one block at the same time", async function () {
        await withSource(chain({ entries: 7 }), async (source, node) => {
            const counts = await Promise.all([
                source.countStorageEntries(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    CHILD_TRIE_TIP
                ),
                source.countStorageEntries(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    CHILD_TRIE_TIP
                ),
                source.countStorageEntries(
                    NO_UPSTREAM,
                    CHILD_TRIE_ADDRESS,
                    CHILD_TRIE_TIP
                )
            ]);

            expect(counts).to.deep.equal([7, 7, 7]);
            expect(node.requests().chain_getBlockHash).to.equal(1);
        });
    });

    it("reads the account info once for a contract it counts again", async function () {
        await withSource(chain({ entries: 7 }), async (source, node) => {
            await source.countStorageEntries(
                NO_UPSTREAM,
                CHILD_TRIE_ADDRESS,
                CHILD_TRIE_TIP
            );
            await source.countStorageEntries(NO_UPSTREAM, CHILD_TRIE_ADDRESS, {
                number: CHILD_TRIE_TIP.number + 1n
            });

            expect(node.requests().state_getStorage).to.equal(1);
        });
    });
});

// The key derivations are checked by the recorded tests above: a wrong key
// or prefix asks the replayed node for something it never answered.
describe("ChildTrieBlockSource helpers", function () {
    it("refuses an address that is not 20 bytes", function () {
        expect(() => reviveAccountInfoKey("0x1234")).to.throw();
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

    it("finds the blocks after which a trie root changes, in few reads", async function () {
        // the root is the number of changes at or before the block
        const changes = [3, 4, 500, 999_999];
        let reads = 0;
        const roots = async (blocks: number[]) => {
            reads += blocks.length;
            return blocks.map((n) =>
                n < 3 ? undefined : String(changes.filter((c) => c <= n).length)
            );
        };

        const changed = await findChangedBlocks(roots, 0, 1_000_000);

        expect(changed).to.deep.equal(changes);
        expect(reads).to.be.lessThan(changes.length * 2 * 21);
    });

    it("finds nothing when the root is the same at both ends", async function () {
        let reads = 0;
        const changed = await findChangedBlocks(
            async (blocks) => {
                reads += blocks.length;
                return blocks.map(() => "0xroot");
            },
            10,
            1_000
        );

        expect(changed).to.deep.equal([]);
        // the two ends only
        expect(reads).to.equal(2);
    });

    it("finds a change in the last block of the range", async function () {
        const changed = await findChangedBlocks(
            async (blocks) => blocks.map((n) => (n >= 64 ? "b" : "a")),
            0,
            64
        );

        expect(changed).to.deep.equal([64]);
    });
});
