import {
    RECORDED_ACCOUNT_INFO,
    withSubstrateNode,
    type SubstrateContract,
    type SubstrateNode
} from "../../fixtures/node/SubstrateChildTrieNode";
import { ChainMovedError } from "@/utils/node/storageDiff/backfillBlocks/ABackfillBlockSource";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import { expect } from "chai";

const ADDRESS = "0x99ee73298423dcf5da3059a5e48bda20bfbcd01b";
const TIP = { number: 1_000_000n, hash: "0xeth" };

/** A chain shape for the recorded contract, with the tip's hash per question. */
function chain(overrides: Partial<SubstrateContract> = {}): SubstrateContract {
    return {
        address: ADDRESS,
        changes: [],
        deployed: 0,
        tipNumber: Number(TIP.number),
        tipHash: () => "0xtip",
        info: RECORDED_ACCOUNT_INFO,
        entries: 0,
        ...overrides
    };
}

const NO_UPSTREAM = {
    request: () => Promise.reject(new Error("The eth upstream is not used")),
    requestBatch: () => []
};

/** Runs `use` with a source on a node of `contract`, closed in `finally`. */
async function withSource<T>(
    contract: SubstrateContract,
    use: (source: ChildTrieBlockSource, reads: SubstrateNode) => Promise<T>
): Promise<T> {
    return await withSubstrateNode(contract, async (node) => {
        const source = new ChildTrieBlockSource(node.url);
        try {
            return await use(source, node);
        } finally {
            source.close();
        }
    });
}

describe("ChildTrieBlockSource", function () {
    it("lists the blocks that changed the contract, reading far fewer roots than blocks", async function () {
        const changes = [400, 401, 500_000, 999_999];
        await withSource(
            chain({ changes, deployed: 400 }),
            async (source, node) => {
                const listing = await source.listBlocks(
                    NO_UPSTREAM,
                    ADDRESS,
                    400n,
                    TIP
                );

                expect(listing.numbers).to.deep.equal(changes.map(BigInt));
                expect(listing.blocks).to.equal(999_601);
                expect(listing.blockReads).to.equal(0);
                expect(listing.rootReads).to.equal(node.rootReads());
                expect(listing.rootReads).to.be.lessThan(200);
            }
        );
    });

    it("lists nothing for a range in which the contract did not change", async function () {
        await withSource(
            chain({ changes: [10], deployed: 10 }),
            async (source) => {
                const listing = await source.listBlocks(
                    NO_UPSTREAM,
                    ADDRESS,
                    11n,
                    TIP
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
                    .listBlocks(NO_UPSTREAM, ADDRESS, 500n, TIP)
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
                .listBlocks(NO_UPSTREAM, ADDRESS, 1n, TIP)
                .then(
                    () => undefined,
                    (reason: unknown) => reason
                );
            expect((error as Error).message).to.equal(
                "The address is not a contract"
            );
        });
    });

    it("counts the entries of the contract's child trie across pages", async function () {
        await withSource(chain({ entries: 2_345 }), async (source) => {
            expect(await source.countStorageEntries(ADDRESS, TIP)).to.equal(
                2_345
            );
        });
    });

    it("counts a child trie that fills a page exactly", async function () {
        await withSource(chain({ entries: 2_000 }), async (source) => {
            expect(await source.countStorageEntries(ADDRESS, TIP)).to.equal(
                2_000
            );
        });
    });

    it("shares the block hash read of counts asked for at one block at the same time", async function () {
        await withSource(chain({ entries: 7 }), async (source, node) => {
            const counts = await Promise.all([
                source.countStorageEntries(ADDRESS, TIP),
                source.countStorageEntries(ADDRESS, TIP),
                source.countStorageEntries(ADDRESS, TIP)
            ]);

            expect(counts).to.deep.equal([7, 7, 7]);
            expect(node.requests().chain_getBlockHash).to.equal(1);
        });
    });

    it("reads the account info once for a contract it counts again", async function () {
        await withSource(chain({ entries: 7 }), async (source, node) => {
            await source.countStorageEntries(ADDRESS, TIP);
            await source.countStorageEntries(ADDRESS, {
                number: TIP.number + 1n
            });

            expect(node.requests().state_getStorage).to.equal(1);
        });
    });
});
