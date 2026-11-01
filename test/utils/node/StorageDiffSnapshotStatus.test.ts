import { StorageDiffClient } from "../../fixtures/node/StorageDiffClient";
import {
    asksCallFrames,
    deploySlotWriter,
    slotKey,
    nonZero,
    storageWord,
    writeSlot
} from "../../fixtures/node/StorageDiffContracts";
import {
    fieldReads,
    withStorageDiffSession,
    withStorageDiffUpstream
} from "../../fixtures/node/StorageDiffSession";
import {
    RECORDED_ACCOUNT_INFO,
    withSubstrateNode,
    type SubstrateNode
} from "../../fixtures/node/SubstrateChildTrieNode";
import { sleep } from "@/utils";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import { expect } from "chai";

describe("StorageDiffService snapshot status of a subscription", function () {
    it("says syncing for an account it still has to backfill, and ready once the account is complete", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);

            const first = await client.subscribeWithStatus([writer]);
            await client.nextSnapshot(first.subscription);
            const second = await client.subscribeWithStatus([writer]);

            expect(first.accounts).to.deep.equal({ [writer]: "syncing" });
            expect(second.accounts).to.deep.equal({ [writer]: "ready" });
        });
    });

    it("tells a subscriber that a snapshot it was promised as ready is delayed when a reorg clears the cache", async function () {
        await withStorageDiffSession(
            async ({ client, provider, signer }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                const first = await client.subscribeWithStatus([writer]);
                await client.nextSnapshot(first.subscription);
                const second = await client.subscribeWithStatus([writer]);
                expect(second.accounts).to.deep.equal({ [writer]: "ready" });
                await provider.send("anvil_mine", [4]);
                const head = Number(await provider.send("eth_blockNumber", []));

                // replaces the whole retained window: the cache is cleared and rebuilt
                await provider.send("anvil_reorg", [2, []]);
                await provider.send("evm_mine", []);
                const notices = [
                    await client.nextDelay(),
                    await client.nextDelay()
                ];

                for (const notice of notices) {
                    expect(notice.reason).to.equal("snapshot-delayed");
                    expect(
                        notice.reason === "snapshot-delayed" && notice.accounts
                    ).to.deep.equal([writer]);
                }
                expect(
                    notices.map(
                        (notice) =>
                            notice.reason === "snapshot-delayed" &&
                            notice.subscription
                    )
                ).to.have.members([first.subscription, second.subscription]);
                // the rebuilt account is pushed again
                const rebuilt = await client.nextSnapshot(first.subscription);
                expect(Number(rebuilt.block.number)).to.be.at.least(head);
            },
            { retention: 2 }
        );
    });
});

describe("StorageDiffService backfill checked against the chain", function () {
    /** A node of the writer's chain with `entries` child trie entries. */
    async function backfillWith(
        entries: number | ((blockNumber: number) => number),
        run: (context: {
            node: SubstrateNode;
            session: Parameters<
                Parameters<typeof withStorageDiffUpstream>[0]
            >[0];
            writer: string;
            client: StorageDiffClient;
            head: { number: number; hash: string };
        }) => Promise<void>
    ): Promise<void> {
        await withStorageDiffUpstream(async (session) => {
            const { provider, signer, start } = session;
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            await writeSlot(signer, writer, 2, 7n);
            const block = (await provider.getBlock("latest"))!;
            await withSubstrateNode(
                {
                    address: writer,
                    changes: [block.number - 2, block.number - 1, block.number],
                    deployed: block.number - 2,
                    tipNumber: block.number,
                    tipHash: () => "0xtip",
                    info: RECORDED_ACCOUNT_INFO,
                    entries
                },
                async (node) => {
                    const service = await start({
                        backfillBlocks: new ChildTrieBlockSource(node.url)
                    });
                    const client = await StorageDiffClient.connect(service.url);
                    try {
                        await run({
                            node,
                            session,
                            writer,
                            client,
                            head: { number: block.number, hash: block.hash! }
                        });
                    } finally {
                        client.close();
                    }
                }
            );
        });
    }

    async function backfilled(
        session: Parameters<Parameters<typeof withStorageDiffUpstream>[0]>[0]
    ): Promise<void> {
        while (session.backfills.length === 0) await sleep(20);
    }

    it("keeps an account lazy and warns with both counts when the chain holds more entries than the history named", async function () {
        await backfillWith(3, async ({ session, writer, client, head }) => {
            const first = await client.subscribeWithStatus([writer]);
            const subscription = first.subscription;
            await backfilled(session);
            await sleep(300);

            // the service says at once that no snapshot is coming
            const notice = await client.nextSnapshot(subscription);
            expect(notice.accounts).to.deep.equal({});
            expect(notice.lazy).to.deep.equal([writer]);
            expect(notice.block.hash).to.equal(head.hash);
            expect(client.unreadSnapshots(subscription)).to.deep.equal([]);
            const warning = session.warnings.find(({ message }) =>
                message.includes("stays lazy")
            );
            expect(warning?.meta[0]).to.include({
                backfilled: 2,
                onChain: 3
            });
            // a later subscriber is told the account is lazy
            const later = await client.subscribeWithStatus([writer]);
            expect(first.accounts).to.deep.equal({ [writer]: "syncing" });
            expect(later.accounts).to.deep.equal({ [writer]: "lazy" });
            // a slot the history never named is fetched when asked for
            const reads = fieldReads(session.relay);
            const state = await client.getState(head.hash, [
                { address: writer, slots: [slotKey(1), slotKey(9)] }
            ]);
            expect(state.accounts[writer].storage).to.deep.equal({
                [slotKey(1)]: storageWord(5n),
                [slotKey(9)]: storageWord(0n)
            });
            expect(fieldReads(session.relay) - reads).to.equal(1);
        });
    });

    it("tells a subscriber of a lazy account that no snapshot is coming also when it subscribes after the backfill", async function () {
        await backfillWith(3, async ({ session, writer, client }) => {
            await client.subscribe([writer]);
            await backfilled(session);

            const later = await client.subscribe([writer]);
            const notice = await client.nextSnapshot(later);

            expect(notice.lazy).to.deep.equal([writer]);
        });
    });

    it("tells the subscriber at once when the backfill fails", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer, warnings }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                relay.failNext("debug_traceBlockByNumber", 50);

                const subscription = await client.subscribe([writer]);
                const notice = await client.nextSnapshot(subscription);

                expect(notice.lazy).to.deep.equal([writer]);
                expect(notice.accounts).to.deep.equal({});
                expect(
                    warnings.some(({ message }) =>
                        message.includes("Backfill failed")
                    )
                ).to.equal(true);
            }
        );
    });

    it("does not backfill a lazy account again when it is subscribed again", async function () {
        await backfillWith(3, async ({ session, writer, client }) => {
            await client.subscribe([writer]);
            await backfilled(session);

            await client.subscribe([writer]);
            await sleep(300);

            expect(session.backfills).to.have.length(1);
        });
    });

    it("pushes the snapshot and answers every slot from the cache when the chain holds just the entries the history named", async function () {
        await backfillWith(2, async ({ session, writer, client, head }) => {
            const subscription = await client.subscribe([writer]);
            const snapshot = await client.nextSnapshot(subscription);

            expect(nonZero(snapshot.accounts[writer].storage)).to.deep.equal({
                [slotKey(1)]: storageWord(5n),
                [slotKey(2)]: storageWord(7n)
            });
            const reads = fieldReads(session.relay);
            await client.getState(head.hash, [
                { address: writer, slots: [slotKey(9)] }
            ]);
            expect(fieldReads(session.relay)).to.equal(reads);
            expect(
                session.warnings.filter(({ message }) =>
                    message.includes("stays lazy")
                )
            ).to.deep.equal([]);
        });
    });

    // the chain holds one more entry from the block of the write on
    const WRITE_ADDS_ENTRY = (firstBlock: () => number) => (n: number) =>
        n >= firstBlock() ? 3 : 2;

    /** Waits until `done` holds, up to a bound. */
    async function until(done: () => boolean): Promise<boolean> {
        for (let i = 0; i < 150 && !done(); i++) await sleep(20);
        return done();
    }

    // The scripted Substrate node (SubstrateChildTrieNode) and the trace that
    // omits the write are fault injections: the recorded exchange is in
    // assetHubChildTrie.recorded.json, and Asset Hub's omission is
    // paritytech/polkadot-sdk#13663.
    it("keeps an account lazy and tells its subscriber when a block's trace omits a write the chain holds", async function () {
        let writeBlock = Number.MAX_SAFE_INTEGER;
        await backfillWith(
            WRITE_ADDS_ENTRY(() => writeBlock),
            async ({ session, writer, client }) => {
                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);
                await backfilled(session);
                // the trace of the next block lists the account but not the slot it wrote
                session.relay.tamper(
                    "debug_traceBlockByNumber",
                    (result, params) =>
                        asksCallFrames(params)
                            ? result
                            : (
                                  result as {
                                      result: {
                                          pre: object;
                                          post: Record<string, object>;
                                      };
                                  }[]
                              ).map((entry) => ({
                                  ...entry,
                                  result: {
                                      pre: entry.result.pre,
                                      post: {
                                          ...entry.result.post,
                                          [writer]: { storage: {} }
                                      }
                                  }
                              }))
                );

                // the chain holds the entry from the next block on
                writeBlock = (await session.provider.getBlockNumber()) + 1;
                await writeSlot(session.signer, writer, 3, 9n);
                const notice = await Promise.race([
                    client.nextSnapshot(subscription),
                    sleep(3000).then(() => undefined)
                ]);

                expect(notice?.lazy).to.deep.equal([writer]);
                expect(notice?.accounts).to.deep.equal({});
                const warning = session.warnings.find(({ message }) =>
                    message.includes("write left fewer storage entries")
                );
                expect(warning?.meta[0]).to.include({
                    address: writer,
                    cached: 2,
                    onChain: 3
                });
                // lazy from now on: an unnamed slot is fetched when asked for
                const reads = fieldReads(session.relay);
                const head = await client.getDiffs([writer], writeBlock);
                await client.getState(head[0].hash, [
                    { address: writer, slots: [slotKey(9)] }
                ]);
                expect(fieldReads(session.relay) - reads).to.equal(1);
            }
        );
    });

    it("keeps an account complete when the count after a write matches, at the cost of one hash read and one key page", async function () {
        let writeBlock = Number.MAX_SAFE_INTEGER;
        await backfillWith(
            WRITE_ADDS_ENTRY(() => writeBlock),
            async ({ node, session, writer, client }) => {
                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);
                await backfilled(session);
                const before = node.requests();

                // the chain holds the entry from the next block on
                writeBlock = (await session.provider.getBlockNumber()) + 1;
                await writeSlot(session.signer, writer, 3, 9n);
                const counted = () =>
                    (node.requests().childstate_getKeysPaged ?? 0) -
                    (before.childstate_getKeysPaged ?? 0);
                expect(await until(() => counted() >= 1)).to.equal(true);
                await sleep(200);

                const after = node.requests();
                const cost = (method: string) =>
                    (after[method] ?? 0) - (before[method] ?? 0);
                // the trie id is cached: no account info read, no root read
                expect({
                    blockHash: cost("chain_getBlockHash"),
                    keyPages: cost("childstate_getKeysPaged"),
                    accountInfo: cost("state_getStorage")
                }).to.deep.equal({ blockHash: 1, keyPages: 1, accountInfo: 0 });
                expect(
                    session.warnings.filter(({ message }) =>
                        message.includes("write left fewer storage entries")
                    )
                ).to.deep.equal([]);
                expect(client.unreadSnapshots(subscription)).to.deep.equal([]);
            }
        );
    });
});
