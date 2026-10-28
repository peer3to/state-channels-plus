import {
    deployNestedWriter,
    deployNumberStorage,
    deployRevertProbe,
    deploySlotWriter,
    dumpedAccount,
    recordKey,
    rejectionOf,
    setValue,
    slotKey,
    storageWord,
    withStorageDiffSession,
    writeSlot
} from "../../fixtures/node/StorageDiffService.fixture";
import { sleep } from "@/utils";
import { NOT_RETAINED_ERROR_CODE } from "@/utils/node/storageDiff/blockStorageDiff";
import { HEAD_WAIT_MS } from "@/utils/node/storageDiff/StorageDiffService";
import { expect } from "chai";
import { Wallet, toQuantity } from "ethers";

/** Time is the input: how long a read that must wait is watched for. */
const ABSENCE_WINDOW_MS = 500;

describe("StorageDiffService blocks", function () {
    it("serves the best head as the upstream returns it, with full and with hashed transactions", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const storage = await deployNumberStorage(signer);
            const subscription = await client.subscribe([]);
            const receipt = await setValue(storage, 3n);
            await client.recordAt(subscription, receipt.blockNumber);
            const number = toQuantity(receipt.blockNumber);

            const full = await client.request("scp_getBlock", ["latest", true]);
            const hashed = await client.request("scp_getBlock", ["latest"]);

            expect(full).to.deep.equal(
                await provider.send("eth_getBlockByNumber", [number, true])
            );
            expect(hashed).to.deep.equal(
                await provider.send("eth_getBlockByNumber", [number, false])
            );
        });
    });

    it("serves a retained block by hash and by number, and null for one it does not retain", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const storage = await deployNumberStorage(signer);
            const subscription = await client.subscribe([]);
            const receipt = await setValue(storage, 3n);
            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            const expected = await provider.send("eth_getBlockByHash", [
                record.hash,
                true
            ]);

            expect(
                await client.request("scp_getBlock", [record.hash, true])
            ).to.deep.equal(expected);
            expect(
                await client.request("scp_getBlock", [record.number, true])
            ).to.deep.equal(expected);
            expect(
                await client.request("scp_getBlock", [
                    "0x" + "ab".repeat(32),
                    true
                ])
            ).to.equal(null);
            expect(
                await client.request("scp_getBlock", [
                    toQuantity(receipt.blockNumber + 50),
                    true
                ])
            ).to.equal(null);
        });
    });

    it("serves a transaction of a retained block as the upstream returns it, and null for an unknown hash", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const storage = await deployNumberStorage(signer);
            const receipt = await setValue(storage, 3n);
            await client.subscribe([]);

            expect(
                await client.request("scp_getTransaction", [receipt.hash])
            ).to.deep.equal(
                await provider.send("eth_getTransactionByHash", [receipt.hash])
            );
            expect(
                await client.request("scp_getTransaction", [
                    "0x" + "cd".repeat(32)
                ])
            ).to.equal(null);
        });
    });

    it("serves a receipt as the upstream returns it, fetching the block's receipts once", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                const receipt = await setValue(storage, 3n);
                await client.subscribe([]);

                const first = await client.request(
                    "scp_getTransactionReceipt",
                    [receipt.hash]
                );
                const again = await client.request(
                    "scp_getTransactionReceipt",
                    [receipt.hash]
                );

                expect(first).to.deep.equal(
                    await provider.send("eth_getTransactionReceipt", [
                        receipt.hash
                    ])
                );
                expect(again).to.deep.equal(first);
                expect(relay.requestCount("eth_getBlockReceipts")).to.equal(1);
            }
        );
    });

    it("reads the receipts as one batch where the upstream lacks eth_getBlockReceipts", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                const receipt = await setValue(storage, 3n);
                await client.subscribe([]);
                relay.failNext("eth_getBlockReceipts", 1);
                const trips = relay.roundTrips;

                const answer = await client.request(
                    "scp_getTransactionReceipt",
                    [receipt.hash]
                );

                expect(answer).to.deep.equal(
                    await provider.send("eth_getTransactionReceipt", [
                        receipt.hash
                    ])
                );
                expect(
                    relay.requestCount("eth_getTransactionReceipt")
                ).to.equal(1);
                // the refused eth_getBlockReceipts and the one batch
                expect(relay.roundTrips - trips).to.equal(2);
            }
        );
    });

    it("fetches one block per empty head and no parent block by hash", async function () {
        await withStorageDiffSession(async ({ provider, relay, client }) => {
            const subscription = await client.subscribe([]);
            const byNumber = relay.requestCount("eth_getBlockByNumber");
            const byHash = relay.requestCount("eth_getBlockByHash");

            await provider.send("evm_mine", []);
            await client.nextRecord(subscription);

            expect(
                relay.requestCount("eth_getBlockByNumber") - byNumber
            ).to.equal(1);
            expect(relay.requestCount("eth_getBlockByHash")).to.equal(byHash);
        });
    });

    it("fetches a traced head once and checks it once after its trace", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const storage = await deployNumberStorage(signer);
            const subscription = await client.subscribe([]);
            const byNumber = relay.requestCount("eth_getBlockByNumber");

            const receipt = await setValue(storage, 3n);
            await client.recordAt(subscription, receipt.blockNumber);

            // the head itself, then the check that the trace was of that block
            expect(
                relay.requestCount("eth_getBlockByNumber") - byNumber
            ).to.equal(2);
        });
    });

    it("sends the fields of one state read to the upstream as one batch", async function () {
        await withStorageDiffSession(
            async ({ client, relay, service, signer }) => {
                const storage = await deployNumberStorage(signer);
                const address = await recordKey(storage);
                const subscription = await client.subscribe([]);
                const receipt = await setValue(storage, 5n);
                const head = await client.recordAt(
                    subscription,
                    receipt.blockNumber
                );
                // the account's retained history is filled once, before its values are read
                await client.getState(head.hash, [{ address }]);
                const trips = relay.roundTrips;
                const lazy = service.statistics.lazyFieldFetches;

                await client.getState(head.hash, [
                    {
                        address,
                        slots: ["0x" + "00".repeat(32)],
                        account: true,
                        code: true
                    }
                ]);

                expect(relay.roundTrips - trips).to.equal(1);
                expect(service.statistics.lazyFieldFetches - lazy).to.equal(4);
            }
        );
    });

    it("keeps answering a state read for an older retained block after the head moved", async function () {
        await withStorageDiffSession(async ({ client, service, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([]);
            const first = await setValue(storage, 5n);
            const older = await client.recordAt(
                subscription,
                first.blockNumber
            );
            await setValue(storage, 6n);

            const state = await client.getState(older.hash, [
                { address, slots: ["0x" + "00".repeat(32)] }
            ]);

            expect(
                BigInt(state.accounts[address].storage!["0x" + "00".repeat(32)])
            ).to.equal(5n);
            expect(NOT_RETAINED_ERROR_CODE).to.equal(-32002);
            expect(service.statistics.lazyFieldFetches).to.equal(1);
        });
    });

    it("fails, so a supervisor restarts it, when the upstream is reset to a chain sharing no ancestor", async function () {
        await withStorageDiffSession(
            async ({ client, provider, service, signer }) => {
                const storage = await deployNumberStorage(signer);
                await setValue(storage, 3n);
                await client.subscribe([]);

                await provider.send("anvil_reset", []);
                await provider.send("evm_mine", []);

                const failure = await rejectionOf(service.closed);
                expect((failure as Error).message).to.contain("no ancestor");
            }
        );
    });

    it("holds a read that names the block its caller saw until the head reaches it", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                await client.subscribe([]);
                const held = relay.holdNext("eth_getBlockByNumber", "latest");

                await provider.send("evm_mine", []);
                await held.arrived;
                const mined = await provider.send("eth_blockNumber", []);
                let settled = false;
                const read = client
                    .request("scp_getBlock", ["latest", false, mined])
                    .finally(() => (settled = true));
                await sleep(ABSENCE_WINDOW_MS);
                expect(
                    settled,
                    "the service has not reached the block"
                ).to.equal(false);
                const released = Date.now();
                held.release();

                const block = (await read) as { number: string };
                expect(block.number).to.equal(mined);
                // the head reaching the block ends the wait, not the bound
                expect(Date.now() - released).to.be.lessThan(HEAD_WAIT_MS / 2);
                void storage;
            }
        );
    });

    it("answers with what it holds after the head wait, when the head never gets there", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const head = (await client.request("scp_getHead", [])) as {
                number: string;
            };
            const started = Date.now();

            const answer = (await client.request("scp_getHead", [
                toQuantity(BigInt(head.number) + 100n)
            ])) as { number: string };

            expect(answer.number).to.equal(head.number);
            expect(Date.now() - started).to.be.at.least(HEAD_WAIT_MS - 100);
        });
    });
});

describe("StorageDiffService values come from reads, not from the trace", function () {
    // Asset Hub's prestateTracer reports writes of reverted sub-calls in `post`;
    // the relay adds such writes to every trace the service asks for.
    it("leaves out the slot and the value transfer of a reverted sub-call that the trace reports", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer, service }) => {
                const recipient = Wallet.createRandom().address.toLowerCase();
                const probe = await deployRevertProbe(signer, recipient);
                const subscription = await client.subscribe([probe, recipient]);
                await client.nextSnapshot(subscription);
                relay.tamper("debug_traceBlockByNumber", (result) =>
                    (result as { result: { pre: object; post: object } }[]).map(
                        (entry) => ({
                            ...entry,
                            result: {
                                pre: {
                                    ...entry.result.pre,
                                    [probe]: { storage: {} },
                                    [recipient]: { balance: "0x0" }
                                },
                                post: {
                                    ...entry.result.post,
                                    [probe]: {
                                        storage: {
                                            [slotKey(1)]: storageWord(1n),
                                            [slotKey(2)]: storageWord(5n)
                                        }
                                    },
                                    [recipient]: { balance: "0x1" }
                                }
                            }
                        })
                    )
                );

                const receipt = await (
                    await signer.sendTransaction({ to: probe })
                ).wait();
                await client.recordAt(subscription, receipt!.blockNumber);
                const [record] = (
                    await client.getDiffs(
                        [probe, recipient],
                        receipt!.blockNumber
                    )
                ).filter((r) => r.number === toQuantity(receipt!.blockNumber));

                expect(record.post[probe].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(1n)
                });
                expect(record.post[recipient]).to.equal(undefined);
                void service;
            }
        );
    });

    it("lists no slot a transaction wrote with the value it already had", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            // the trace names the slot as touched, as a rewrite of it may
            relay.tamper("debug_traceBlockByNumber", (result) =>
                (result as { result: { pre: object; post: object } }[]).map(
                    (entry) => ({
                        result: {
                            pre: {
                                ...entry.result.pre,
                                [writer]: {
                                    storage: { [slotKey(1)]: storageWord(5n) }
                                }
                            },
                            post: entry.result.post
                        }
                    })
                )
            );
            const receipt = await writeSlot(signer, writer, 1, 5n);
            await client.recordAt(subscription, receipt.blockNumber);
            const records = await client.getDiffs(
                [writer],
                receipt.blockNumber
            );
            const record = records.find(
                (r) => r.number === toQuantity(receipt.blockNumber)
            );
            expect(record?.post[writer]?.storage ?? {}).to.deep.equal({});
        });
    });

    it("misses no slot anvil holds after calls that nest and re-enter, and the diffs add up to its state", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const nested = await deployNestedWriter(signer);
            const subscription = await client.subscribe([nested]);
            await client.nextSnapshot(subscription);
            const first = await (
                await signer.sendTransaction({ to: nested })
            ).wait();
            const second = await (
                await signer.sendTransaction({ to: nested })
            ).wait();
            await client.recordAt(subscription, second!.blockNumber);
            const records = await client.getDiffs([nested], first!.blockNumber);
            const written = new Set(
                records.flatMap((r) =>
                    Object.keys(r.post[nested]?.storage ?? {})
                )
            );
            const dumped = await dumpedAccount(provider, nested);
            const held = Object.entries(dumped.storage)
                .filter(([, word]) => BigInt(word) !== 0n)
                .map(([slot]) => slotKey(Number(BigInt(slot))));
            expect(held).to.have.length(5);
            for (const slot of held) expect(written).to.include(slot);
        });
    });

    it("fills the history of an account subscribed after its blocks were retained from reads", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const writer = await deploySlotWriter(signer);
            const receipt = await writeSlot(signer, writer, 3, 7n);
            await writeSlot(signer, writer, 3, 9n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            const records = await client.getDiffs(
                [writer],
                receipt.blockNumber
            );
            const record = records.find(
                (r) => r.number === toQuantity(receipt.blockNumber)
            );
            expect(record?.post[writer]?.storage).to.deep.equal({
                [slotKey(3)]: storageWord(7n)
            });
        });
    });
});
