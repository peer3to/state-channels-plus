import {
    backfilled,
    backfillWith,
    until,
    WRITE_ADDS_ENTRY
} from "../../fixtures/node/StorageDiffBackfillFixture";
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
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffSession";
import { sleep } from "@/utils";
import { expect } from "chai";
import { toQuantity } from "ethers";

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
                // every code probe fails: the backfill starts over until it gives up
                relay.failNext("eth_getCode", 50);

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

    // Mutation: a failed backfill tells only the subscribers of the moment.
    it("tells a later subscriber that an account whose backfill failed is lazy, and does not backfill it again", async function () {
        await withStorageDiffSession(
            async ({ client, relay, service, signer }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                // every code probe fails: the backfill starts over until it gives up
                relay.failNext("eth_getCode", 50);
                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);
                const probes = relay.requestCount("eth_getCode");
                const traces = relay.requestCount("debug_traceBlockByNumber");

                const later = await StorageDiffClient.connect(service.url);
                try {
                    const second = await later.subscribeWithStatus([writer]);
                    const notice = await later.nextSnapshot(
                        second.subscription
                    );
                    await sleep(300);

                    expect(second.accounts).to.deep.equal({ [writer]: "lazy" });
                    expect(notice.lazy).to.deep.equal([writer]);
                    expect(notice.accounts).to.deep.equal({});
                    expect(relay.requestCount("eth_getCode")).to.equal(probes);
                    expect(
                        relay.requestCount("debug_traceBlockByNumber")
                    ).to.equal(traces);
                } finally {
                    later.close();
                }
            }
        );
    });

    // Mutation: an unsubscribed account stays marked as sent to the peer.
    it("pushes the snapshot again to a peer that subscribes again after it unsubscribed", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            const first = await client.subscribe([writer]);
            await client.nextSnapshot(first);
            await client.unsubscribe(first);
            // the peer gets no record of this block
            const written = await writeSlot(signer, writer, 1, 8n);
            await client.request("scp_getHead", [
                toQuantity(written.blockNumber)
            ]);

            const again = await client.subscribeWithStatus([writer]);
            const snapshot = await Promise.race([
                client.nextSnapshot(again.subscription),
                sleep(3000).then(() => undefined)
            ]);

            expect(again.accounts).to.deep.equal({ [writer]: "ready" });
            expect(nonZero(snapshot?.accounts[writer].storage)).to.deep.equal({
                [slotKey(1)]: storageWord(8n)
            });
        });
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

    // Mutation: the count of an account without code fails the backfill.
    it("pushes an account without code with its balance and nonce where the Substrate node holds no contract for it", async function () {
        await backfillWith(2, async ({ session, client }) => {
            const sender = (await session.signer.getAddress()).toLowerCase();

            const first = await client.subscribeWithStatus([sender]);
            const snapshot = await client.nextSnapshot(first.subscription);

            expect(first.accounts).to.deep.equal({ [sender]: "syncing" });
            expect(snapshot.lazy).to.equal(undefined);
            expect(snapshot.accounts[sender].code).to.equal("0x");
            expect(BigInt(snapshot.accounts[sender].balance!)).to.equal(
                await session.provider.getBalance(sender)
            );
            expect(
                session.warnings.filter(({ message }) =>
                    message.includes("Backfill failed")
                )
            ).to.deep.equal([]);
        });
    });

    // Mutation: a null block hash is passed on, so the listing and the count
    // are of the lagging node's best block, and the account is pushed as
    // ready without the slots written after it.
    it("pushes the slots written in blocks a lagging Substrate node had not reached yet", async function () {
        let tip = Number.MAX_SAFE_INTEGER;
        await backfillWith(
            // the slots are written in the block before the tip and at the tip
            (blockNumber) =>
                blockNumber >= tip ? 2 : blockNumber >= tip - 1 ? 1 : 0,
            async ({ session, writer, client, head }) => {
                tip = head.number;

                const first = await client.subscribeWithStatus([writer]);
                const snapshot = await client.nextSnapshot(first.subscription);

                expect(first.accounts).to.deep.equal({ [writer]: "syncing" });
                expect(snapshot.lazy).to.equal(undefined);
                expect(
                    nonZero(snapshot.accounts[writer].storage)
                ).to.deep.equal({
                    [slotKey(1)]: storageWord(5n),
                    [slotKey(2)]: storageWord(7n)
                });
                expect(
                    session.warnings.filter(({ message }) =>
                        message.includes("stays lazy")
                    )
                ).to.deep.equal([]);
            },
            { lag: { blocks: 2, ms: 300 } }
        );
    });

    // Mutation: a count that fails demotes the account.
    it("keeps an account complete, and warns, when the count after a write fails", async function () {
        await backfillWith(2, async ({ node, session, writer, client }) => {
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            await backfilled(session);
            node.failKeyPages(true);

            await writeSlot(session.signer, writer, 1, 11n);
            const warned = () =>
                session.warnings.some(({ message }) =>
                    message.includes("Cannot count an account's entries")
                );
            // the count's reads are retried before it gives up
            expect(await until(warned, 10_000)).to.equal(true);
            node.failKeyPages(false);
            const later = await client.subscribeWithStatus([writer]);

            expect(later.accounts).to.deep.equal({ [writer]: "ready" });
            expect(client.unreadSnapshots(subscription)).to.deep.equal([]);
        });
    });

    // Mutation: a mismatching count of a block a reorg dropped demotes the account.
    it("keeps an account complete when a count that differs is of a block a reorg dropped", async function () {
        let dropped = Number.MAX_SAFE_INTEGER;
        await backfillWith(
            (blockNumber) => (blockNumber === dropped ? 99 : 2),
            async ({ node, session, writer, client }) => {
                const { provider, signer } = session;
                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);
                await backfilled(session);
                const held = node.holdKeyPages();
                dropped =
                    Number(await provider.send("eth_blockNumber", [])) + 1;
                await writeSlot(signer, writer, 1, 11n);
                await held.arrived;

                // the counted block is replaced by an empty one
                await provider.send("anvil_reorg", [1, []]);
                const replacement = await provider.send(
                    "eth_getBlockByNumber",
                    [toQuantity(dropped), false]
                );
                for (;;) {
                    const served = (await client.request("scp_getBlock", [
                        toQuantity(dropped)
                    ])) as { hash: string } | null;
                    if (served?.hash === replacement.hash) break;
                    await sleep(20);
                }
                held.release();
                await sleep(300);

                const later = await client.subscribeWithStatus([writer]);
                expect(later.accounts).to.deep.equal({ [writer]: "ready" });
                expect(
                    session.warnings.filter(({ message }) =>
                        message.includes("write left fewer storage entries")
                    )
                ).to.deep.equal([]);
                expect(client.unreadSnapshots(subscription)).to.deep.equal([]);
            }
        );
    });

    // Mutation: every written block starts its own count (no coalescing).
    it("counts a complete account once more, at the newest written block, for the blocks written while a count runs", async function () {
        await backfillWith(2, async ({ node, session, writer, client }) => {
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            await backfilled(session);
            const before = node.keyPageBlocks().length;
            const held = node.holdKeyPages();

            const first = await writeSlot(session.signer, writer, 1, 11n);
            await client.recordAt(subscription, first.blockNumber);
            await held.arrived;
            await writeSlot(session.signer, writer, 1, 12n);
            const last = await writeSlot(session.signer, writer, 1, 13n);
            await client.recordAt(subscription, last.blockNumber);
            await sleep(200);
            // one count at a time: the later writes wait for the first
            expect(node.keyPageBlocks().length - before).to.equal(1);
            held.release();

            expect(
                await until(() => node.keyPageBlocks().length - before >= 2)
            ).to.equal(true);
            await sleep(200);
            expect(node.keyPageBlocks().slice(before)).to.deep.equal([
                first.blockNumber,
                last.blockNumber
            ]);
        });
    });
});
