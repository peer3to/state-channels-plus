import {
    deploySlotWriter,
    dumpedAccount,
    slotKey,
    storageWord,
    withStorageDiffSession,
    withStorageDiffUpstream,
    StorageDiffClient,
    writeSlot
} from "../../fixtures/node/StorageDiffService.fixture";
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
        await withStorageDiffSession(
            async ({ client, provider, service, signer }) => {
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
                expect(BigInt(pushed.balance!)).to.equal(
                    BigInt(dumped.balance)
                );
                expect(pushed.nonce).to.equal(dumped.nonce);
                const head = await provider.send("eth_getBlockByNumber", [
                    "latest",
                    false
                ]);
                expect(snapshot.block).to.deep.equal({
                    number: head.number,
                    hash: head.hash
                });
                void service;
            }
        );
    });

    it("finds the deploy block by bisection and traces only the blocks with transactions since", async function () {
        await withStorageDiffSession(
            async ({ client, provider, service, signer }) => {
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

                const [cost] = service.statistics.backfills;
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
        await withStorageDiffSession(
            async ({ client, relay, service, signer }) => {
                const writer = await deploySlotWriter(signer);
                const receipt = await writeSlot(signer, writer, 1, 5n);
                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);
                const head = await client.getDiffs(
                    [writer],
                    receipt.blockNumber
                );

                const state = await client.getState(head[0].hash, [
                    { address: writer, slots: [slotKey(77), slotKey(1)] }
                ]);

                expect(state.accounts[writer].storage).to.deep.equal({
                    [slotKey(77)]: ZERO_WORD,
                    [slotKey(1)]: storageWord(5n)
                });
                expect(relay.requestCount("eth_getStorageAt")).to.equal(0);
                expect(service.statistics.lazyFieldFetches).to.equal(0);
            }
        );
    });

    it("keeps a complete contract current from the records and does not push its snapshot again", async function () {
        await withStorageDiffSession(
            async ({ client, provider, service, signer }) => {
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

                const head = await client.getDiffs(
                    [writer],
                    receipt.blockNumber
                );
                const state = await client.getState(head[0].hash, [
                    { address: writer, slots: [slotKey(1)] }
                ]);
                expect(state.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(8n)
                });
                // the second subscription only carries the new account
                expect(Object.keys(second.accounts)).to.not.include(writer);
                void provider;
                void service;
            }
        );
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

describe("StorageDiffService persisted cache", function () {
    it("resumes a complete contract from disk without reading its history again", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(async ({ signer, start }) => {
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
                expect(second.statistics.backfills).to.have.length(0);
            });
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });

    it("rolls the saved cache back when the saved head is no longer on the chain, then catches up", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(
                async ({ provider, signer, start }) => {
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
                    expect(second.statistics.backfills).to.have.length(0);
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
                async ({ provider, signer, start }) => {
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
                    expect(second.statistics.backfills).to.have.length(0);
                }
            );
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });
});
