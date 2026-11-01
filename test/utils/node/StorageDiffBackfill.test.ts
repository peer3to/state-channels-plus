import {
    asksCallFrames,
    deploySlotWriter,
    dumpedAccount,
    fieldReads,
    slotKey,
    storageWord,
    withStorageDiffSession,
    withStorageDiffUpstream,
    StorageDiffClient,
    writeSlot
} from "../../fixtures/node/StorageDiffService.fixture";
import {
    RECORDED_ACCOUNT_INFO,
    withSubstrateNode,
    type SubstrateNode
} from "../../fixtures/node/SubstrateChildTrieNode";
import { sleep } from "@/utils";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import { ZERO_WORD } from "@/utils/node/storageDiff/blockStorageDiff";
import { expect } from "chai";
import { Wallet, toQuantity } from "ethers";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The slots of `storage` that hold a value: a zero word and no entry are the same. */
function nonZero(storage: Record<string, string> | undefined) {
    return Object.fromEntries(
        Object.entries(storage ?? {})
            .filter(([, word]) => BigInt(word) !== 0n)
            .map(([slot, word]) => [slot, storageWord(BigInt(word))])
    );
}

describe("StorageDiffService backfill", function () {
    it("pushes the complete storage of a contract at the head when it is first subscribed, as anvil dumps it", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            await writeSlot(signer, writer, 2, 7n);
            await writeSlot(signer, writer, 1, 9n);
            await writeSlot(signer, writer, 2, 0n);
            await writeSlot(signer, writer, 40, 3n);

            const subscription = await client.subscribe([writer]);
            const snapshot = await client.nextSnapshot(subscription);

            const dumped = await dumpedAccount(provider, writer);
            const pushed = snapshot.accounts[writer];
            expect(nonZero(pushed.storage)).to.deep.equal(
                nonZero(dumped.storage)
            );
            expect(nonZero(pushed.storage)).to.deep.equal({
                [slotKey(1)]: storageWord(9n),
                [slotKey(40)]: storageWord(3n)
            });
            expect(pushed.code).to.equal(dumped.code);
            expect(BigInt(pushed.balance!)).to.equal(BigInt(dumped.balance));
            expect(pushed.nonce).to.equal(dumped.nonce);
            const head = await provider.send("eth_getBlockByNumber", [
                "latest",
                false
            ]);
            expect(snapshot.block).to.deep.equal({
                number: head.number,
                hash: head.hash
            });
        });
    });

    it("finds the deploy block by bisection and traces only the blocks with transactions since", async function () {
        await withStorageDiffSession(
            async ({ client, provider, backfills, signer }) => {
                // blocks without transactions before the deploy, and between writes
                for (let i = 0; i < 20; i++)
                    await provider.send("evm_mine", []);
                const writer = await deploySlotWriter(signer);
                const deployed = Number(
                    (await provider.getTransactionReceipt(
                        (
                            await provider.send("eth_getBlockByNumber", [
                                "latest",
                                false
                            ])
                        ).transactions[0]
                    ))!.blockNumber
                );
                await writeSlot(signer, writer, 1, 5n);
                await provider.send("evm_mine", []);
                await provider.send("evm_mine", []);
                await writeSlot(signer, writer, 2, 6n);
                const head = Number(await provider.send("eth_blockNumber", []));

                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);

                const [cost] = backfills;
                expect(cost.deployBlock).to.equal(toQuantity(deployed));
                // a probe at the head, then about log2(head) probes of the bisection
                expect(cost.codeProbes).to.be.at.most(
                    Math.ceil(Math.log2(head + 1)) + 1
                );
                expect(cost.blocks).to.equal(head - deployed + 1);
                // the deploy block and the two writes
                expect(cost.tracedBlocks).to.equal(3);
                expect(cost.traces).to.equal(3);
            }
        );
    });

    it("answers a read of a never-written slot of a complete contract without asking the upstream", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            const receipt = await writeSlot(signer, writer, 1, 5n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            const head = await client.getDiffs([writer], receipt.blockNumber);
            const reads = fieldReads(relay);

            const state = await client.getState(head[0].hash, [
                { address: writer, slots: [slotKey(77), slotKey(1)] }
            ]);

            expect(state.accounts[writer].storage).to.deep.equal({
                [slotKey(77)]: ZERO_WORD,
                [slotKey(1)]: storageWord(5n)
            });
            expect(fieldReads(relay) - reads).to.equal(0);
        });
    });

    it("keeps a complete contract current from the records and does not push its snapshot again", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);

            const receipt = await writeSlot(signer, writer, 1, 8n);
            await client.recordAt(subscription, receipt.blockNumber);
            const again = await client.subscribe([
                writer,
                Wallet.createRandom().address.toLowerCase()
            ]);
            const second = await client.nextSnapshot(again);

            const head = await client.getDiffs([writer], receipt.blockNumber);
            const state = await client.getState(head[0].hash, [
                { address: writer, slots: [slotKey(1)] }
            ]);
            expect(state.accounts[writer].storage).to.deep.equal({
                [slotKey(1)]: storageWord(8n)
            });
            // the second subscription only carries the new account
            expect(Object.keys(second.accounts)).to.not.include(writer);
        });
    });

    it("pushes an account without code with its balance and nonce", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const sender = (await signer.getAddress()).toLowerCase();
            const subscription = await client.subscribe([sender]);

            const snapshot = await client.nextSnapshot(subscription);

            expect(snapshot.accounts[sender].code).to.equal("0x");
            expect(snapshot.accounts[sender].storage).to.deep.equal({});
            expect(BigInt(snapshot.accounts[sender].balance!)).to.equal(
                await provider.getBalance(sender)
            );
        });
    });

    it("includes a block mined while the history is being traced", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const writer = await deploySlotWriter(signer);
                const first = await writeSlot(signer, writer, 1, 5n);
                const held = relay.holdNext(
                    "debug_traceBlockByNumber",
                    toQuantity(first.blockNumber)
                );
                const subscription = await client.subscribe([writer]);
                await held.arrived;

                await writeSlot(signer, writer, 1, 6n);
                held.release();
                const snapshot = await client.nextSnapshot(subscription);

                expect(snapshot.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(6n)
                });
                const head = await provider.send("eth_getBlockByNumber", [
                    "latest",
                    false
                ]);
                expect(snapshot.block.hash).to.equal(head.hash);
            }
        );
    });

    it("starts over when a reorg drops the block the history was read to", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                const checkpoint = await provider.send("evm_snapshot", []);
                const dropped = await writeSlot(signer, writer, 1, 6n);
                const held = relay.holdNext(
                    "debug_traceBlockByNumber",
                    toQuantity(dropped.blockNumber)
                );
                const subscription = await client.subscribe([writer]);
                await held.arrived;

                await provider.send("evm_revert", [checkpoint]);
                await writeSlot(signer, writer, 1, 7n);
                held.release();
                const snapshot = await client.nextSnapshot(subscription);

                expect(snapshot.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(7n)
                });
            }
        );
    });
});

describe("StorageDiffService backfill beyond the window", function () {
    it("reads on, in more rounds, the blocks mined past the retained window while the history was being traced", async function () {
        await withStorageDiffSession(
            async ({ client, relay, backfills, signer }) => {
                const writer = await deploySlotWriter(signer);
                const first = await writeSlot(signer, writer, 1, 5n);
                const held = relay.holdNext(
                    "debug_traceBlockByNumber",
                    toQuantity(first.blockNumber)
                );
                const subscription = await client.subscribe([writer]);
                await held.arrived;

                await writeSlot(signer, writer, 1, 6n);
                for (let i = 0; i < 4; i++)
                    await writeSlot(signer, writer, 2, BigInt(i + 1));
                held.release();
                const snapshot = await client.nextSnapshot(subscription);

                expect(
                    nonZero(snapshot.accounts[writer].storage)
                ).to.deep.equal({
                    [slotKey(1)]: storageWord(6n),
                    [slotKey(2)]: storageWord(4n)
                });
                expect(backfills[0].roundTrips).to.be.greaterThan(4);
            },
            { retention: 2 }
        );
    });
});

describe("StorageDiffService persisted cache", function () {
    it("resumes a complete contract from disk without reading its history again", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(
                async ({ signer, start, backfills }) => {
                    const writer = await deploySlotWriter(signer);
                    await writeSlot(signer, writer, 1, 5n);
                    const first = await start({ cacheDir });
                    const client = await StorageDiffClient.connect(first.url);
                    const subscription = await client.subscribe([writer]);
                    await client.nextSnapshot(subscription);
                    client.close();
                    await first.close();

                    const second = await start({ cacheDir });
                    const again = await StorageDiffClient.connect(second.url);
                    const resumed = await again.subscribe([writer]);
                    const snapshot = await again.nextSnapshot(resumed);
                    again.close();

                    expect(snapshot.accounts[writer].storage).to.deep.equal({
                        [slotKey(1)]: storageWord(5n)
                    });
                    // Mutation: not restoring the saved cache -> the second service backfills.
                    expect(backfills).to.have.length(1);
                }
            );
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });

    it("rolls the saved cache back when the saved head is no longer on the chain, then catches up", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(
                async ({ provider, signer, start, backfills }) => {
                    const writer = await deploySlotWriter(signer);
                    await writeSlot(signer, writer, 1, 5n);
                    const checkpoint = await provider.send("evm_snapshot", []);
                    const first = await start({ cacheDir });
                    const client = await StorageDiffClient.connect(first.url);
                    const subscription = await client.subscribe([writer]);
                    await client.nextSnapshot(subscription);
                    const orphan = await writeSlot(signer, writer, 1, 6n);
                    await client.recordAt(subscription, orphan.blockNumber);
                    client.close();
                    await first.close();

                    await provider.send("evm_revert", [checkpoint]);
                    await writeSlot(signer, writer, 2, 7n);
                    const second = await start({ cacheDir });
                    const again = await StorageDiffClient.connect(second.url);
                    const resumed = await again.subscribe([writer]);
                    const snapshot = await again.nextSnapshot(resumed);
                    again.close();

                    expect(
                        nonZero(snapshot.accounts[writer].storage)
                    ).to.deep.equal(
                        nonZero((await dumpedAccount(provider, writer)).storage)
                    );
                    expect(
                        nonZero(snapshot.accounts[writer].storage)
                    ).to.deep.equal({
                        [slotKey(1)]: storageWord(5n),
                        [slotKey(2)]: storageWord(7n)
                    });
                    // only the first service's backfill
                    expect(backfills).to.have.length(1);
                }
            );
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });

    it("applies the blocks mined while the service was down", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(
                async ({ provider, signer, start, backfills }) => {
                    const writer = await deploySlotWriter(signer);
                    await writeSlot(signer, writer, 1, 5n);
                    const first = await start({ cacheDir });
                    const client = await StorageDiffClient.connect(first.url);
                    await client.nextSnapshot(await client.subscribe([writer]));
                    client.close();
                    await first.close();
                    await writeSlot(signer, writer, 1, 6n);
                    for (let i = 0; i < 4; i++)
                        await provider.send("evm_mine", []);
                    await writeSlot(signer, writer, 3, 8n);

                    const second = await start({ cacheDir, retention: 2 });
                    const again = await StorageDiffClient.connect(second.url);
                    const snapshot = await again.nextSnapshot(
                        await again.subscribe([writer])
                    );
                    again.close();

                    expect(
                        nonZero(snapshot.accounts[writer].storage)
                    ).to.deep.equal({
                        [slotKey(1)]: storageWord(6n),
                        [slotKey(3)]: storageWord(8n)
                    });
                    expect(backfills).to.have.length(1);
                }
            );
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });
});

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
