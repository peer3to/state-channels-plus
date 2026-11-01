import {
    asksCallFrames,
    deployNestedWriter,
    deployNumberStorage,
    deployRevertProbe,
    deploySlotWriter,
    dumpedAccount,
    recordKey,
    setValue,
    slotKey,
    storageWord,
    withFailedFrames,
    writeSlot
} from "../../fixtures/node/StorageDiffContracts";
import {
    fieldReads,
    rejectionOf,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffSession";
import { UPSTREAM_FAULT } from "../../fixtures/node/UpstreamRelay";
import { sleep } from "@/utils";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
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
        await withStorageDiffSession(async ({ client, relay, signer }) => {
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
            const reads = fieldReads(relay);

            await client.getState(head.hash, [
                {
                    address,
                    slots: ["0x" + "00".repeat(32)],
                    account: true,
                    code: true
                }
            ]);

            expect(relay.roundTrips - trips).to.equal(1);
            expect(fieldReads(relay) - reads).to.equal(4);
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
        await withStorageDiffSession(async ({ client, provider, relay }) => {
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
            expect(settled, "the service has not reached the block").to.equal(
                false
            );
            const released = Date.now();
            held.release();

            const block = (await read) as { number: string };
            expect(block.number).to.equal(mined);
            // the head reaching the block ends the wait, not the backstop
            expect(Date.now() - released).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
        });
    });

    it("answers at once with what it holds, and tells subscribers, when its upstream has not seen the block", async function () {
        await withStorageDiffSession(async ({ client }) => {
            await client.subscribe([]);
            const head = (await client.request("scp_getHead", [])) as {
                number: string;
                hash: string;
            };
            const asked = toQuantity(BigInt(head.number) + 100n);
            const started = Date.now();

            const answer = (await client.request("scp_getHead", [asked])) as {
                number: string;
            };

            expect(answer.number).to.equal(head.number);
            expect(Date.now() - started).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
            expect(await client.nextDelay()).to.deep.equal({
                reason: "upstream-behind",
                requested: asked,
                head: { number: head.number, hash: head.hash }
            });
        });
    });

    it("answers at once with what it holds, and tells subscribers, when tracing the awaited block fails", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const subscription = await client.subscribe([]);
                const storage = await deployNumberStorage(signer);
                const deployed = Number(
                    await provider.send("eth_blockNumber", [])
                );
                const before = await client.recordAt(subscription, deployed);
                relay.failNext("debug_traceBlockByNumber", 1);
                const held = relay.holdNext("eth_getBlockByNumber", "latest");
                const mined = await setValue(storage, 3n);
                await held.arrived;
                const started = Date.now();
                const read = client.request("scp_getHead", [
                    toQuantity(mined.blockNumber)
                ]);
                await sleep(50);
                held.release();

                const answer = (await read) as { number: string };

                expect(answer.number).to.equal(before.number);
                expect(Date.now() - started).to.be.lessThan(
                    SDK_RPC_DEADLINE_MS / 2
                );
                const notice = await client.nextDelay();
                expect(notice.reason).to.equal("trace-failed");
                expect(
                    notice.reason === "trace-failed" && notice.block.number
                ).to.equal(toQuantity(mined.blockNumber));
            }
        );
    });

    it("answers with what it holds when a silent hang outlasts the learned backstop", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const subscription = await client.subscribe([]);
                const storage = await deployNumberStorage(signer);
                await setValue(storage, 1n);
                await setValue(storage, 2n);
                const settledAt = Number(
                    await provider.send("eth_blockNumber", [])
                );
                const before = await client.recordAt(subscription, settledAt);
                const held = relay.holdNext("eth_getBlockByNumber", "latest");
                await provider.send("evm_mine", []);
                await held.arrived;
                const mined = await provider.send("eth_blockNumber", []);
                const started = Date.now();

                const answer = (await client.request("scp_getHead", [
                    mined
                ])) as { number: string };

                expect(answer.number).to.equal(before.number);
                expect(Date.now() - started).to.be.lessThan(
                    SDK_RPC_DEADLINE_MS
                );
                // a hang is silent: the service had nothing to tell
                expect(client.unreadDelays()).to.deep.equal([]);
                held.release();
            }
        );
    });
});

describe("StorageDiffService values come from reads, not from the trace", function () {
    // Asset Hub's prestateTracer reports writes of reverted sub-calls in `post`;
    // the relay adds such writes to every trace the service asks for. This is
    // a fault injection into anvil's real trace: no recorded Asset Hub block
    // holds a reverted sub-call (see the note of assetHubTrace.recorded.json),
    // and the real frames the service parses are pinned in BlockTouches.test.ts.
    it("leaves out the slot and the value transfer of a reverted sub-call that the trace reports", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const recipient = Wallet.createRandom().address.toLowerCase();
            const probe = await deployRevertProbe(signer, recipient);
            const subscription = await client.subscribe([probe, recipient]);
            await client.nextSnapshot(subscription);
            relay.tamper("debug_traceBlockByNumber", (result, params) =>
                asksCallFrames(params)
                    ? result
                    : (
                          result as {
                              result: { pre: object; post: object };
                          }[]
                      ).map((entry) => ({
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
                      }))
            );

            const receipt = await (
                await signer.sendTransaction({ to: probe })
            ).wait();
            await client.recordAt(subscription, receipt!.blockNumber);
            const [record] = (
                await client.getDiffs([probe, recipient], receipt!.blockNumber)
            ).filter((r) => r.number === toQuantity(receipt!.blockNumber));

            expect(record.post[probe].storage).to.deep.equal({
                [slotKey(1)]: storageWord(1n)
            });
            expect(record.post[recipient]).to.equal(undefined);
        });
    });

    it("lists no slot a transaction wrote with the value it already had", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            // the trace names the slot as touched, as a rewrite of it may
            relay.tamper("debug_traceBlockByNumber", (result, params) =>
                asksCallFrames(params)
                    ? withFailedFrames(result)
                    : (
                          result as { result: { pre: object; post: object } }[]
                      ).map((entry) => ({
                          result: {
                              pre: {
                                  ...entry.result.pre,
                                  [writer]: {
                                      storage: { [slotKey(1)]: storageWord(5n) }
                                  }
                              },
                              post: entry.result.post
                          }
                      }))
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
});

describe("StorageDiffService trusted traces", function () {
    it("takes the values of a block in which nothing reverted from the trace, with no read of them", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);

            const receipt = await writeSlot(signer, writer, 1, 6n);
            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );

            const readsAtBlock = [
                "eth_getStorageAt",
                "eth_getBalance",
                "eth_getTransactionCount",
                "eth_getCode"
            ]
                .flatMap((method) => relay.paramsOf(method))
                .filter(
                    (params) =>
                        (params.at(-1) as { blockHash?: string })?.blockHash ===
                        receipt.blockHash
                ).length;
            expect(readsAtBlock).to.equal(0);
            expect(record.pre[writer].storage).to.deep.equal({
                [slotKey(1)]: storageWord(5n)
            });
            expect(record.post[writer].storage).to.deep.equal({
                [slotKey(1)]: storageWord(6n)
            });
            // the block was traced for its state diff and for its call frames
            const tracers = relay
                .paramsOf("debug_traceBlockByNumber")
                .filter(
                    (params) => params[0] === toQuantity(receipt.blockNumber)
                )
                .map((params) => (params[1] as { tracer: string }).tracer);
            expect(tracers.sort()).to.deep.equal([
                "callTracer",
                "prestateTracer"
            ]);
        });
    });

    it("serves the history of an account first watched after N retained blocks from memory, with no value read", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            const receipts = [
                await writeSlot(signer, writer, 1, 5n),
                await writeSlot(signer, writer, 1, 6n),
                await writeSlot(signer, writer, 2, 7n)
            ];

            // the service watches nobody until now
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            const records = await client.getDiffs(
                [writer],
                receipts[0].blockNumber
            );

            // the backfill reads at the head; no read names an earlier retained block
            const earlier = new Set(
                receipts.slice(0, -1).map((receipt) => receipt.blockHash)
            );
            const readsAtEarlierBlocks = [
                "eth_getStorageAt",
                "eth_getBalance",
                "eth_getTransactionCount",
                "eth_getCode"
            ]
                .flatMap((method) => relay.paramsOf(method))
                .filter((params) =>
                    earlier.has(
                        (params.at(-1) as { blockHash?: string })
                            ?.blockHash as string
                    )
                ).length;
            expect(readsAtEarlierBlocks).to.equal(0);
            expect(
                records.map((record) => record.post[writer]?.storage)
            ).to.deep.equal([
                { [slotKey(1)]: storageWord(5n) },
                { [slotKey(1)]: storageWord(6n) },
                { [slotKey(2)]: storageWord(7n) }
            ]);
            expect(records[1].pre[writer].storage).to.deep.equal({
                [slotKey(1)]: storageWord(5n)
            });
        });
    });

    it("reads the history of an account first watched after retained blocks whose values were not kept", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            // a failed frame in every block: only watched accounts get values
            relay.tamper("debug_traceBlockByNumber", (result, params) =>
                asksCallFrames(params) ? withFailedFrames(result) : result
            );
            const writer = await deploySlotWriter(signer);
            const first = await writeSlot(signer, writer, 1, 5n);
            const last = await writeSlot(signer, writer, 1, 6n);

            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            const records = await client.getDiffs([writer], first.blockNumber);

            const readsAtFirst = relay
                .paramsOf("eth_getStorageAt")
                .filter(
                    (params) =>
                        (params.at(-1) as { blockHash?: string })?.blockHash ===
                        first.blockHash
                ).length;
            expect(readsAtFirst).to.be.greaterThan(0);
            expect(
                records.map((record) => record.post[writer]?.storage)
            ).to.deep.equal([
                { [slotKey(1)]: storageWord(5n) },
                { [slotKey(1)]: storageWord(6n) }
            ]);
            expect(last.blockNumber).to.equal(first.blockNumber + 1);
        });
    });

    it("reads the values of a block when the call frames cannot be had", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            relay.tamper("debug_traceBlockByNumber", (result, params) =>
                asksCallFrames(params) ? UPSTREAM_FAULT : result
            );

            const receipt = await writeSlot(signer, writer, 1, 6n);
            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );

            expect(record.post[writer].storage).to.deep.equal({
                [slotKey(1)]: storageWord(6n)
            });
            expect(
                relay
                    .paramsOf("eth_getStorageAt")
                    .filter(
                        (params) =>
                            (params.at(-1) as { blockHash?: string })
                                ?.blockHash === receipt.blockHash
                    ).length
            ).to.equal(1);
        });
    });
});

describe("StorageDiffService old values", function () {
    it("reads the old value of a slot from its cache for every block of a multi-block step", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            // a failed frame in every block makes the service read the values
            relay.tamper("debug_traceBlockByNumber", (result, params) =>
                asksCallFrames(params) ? withFailedFrames(result) : result
            );
            const first = await writeSlot(signer, writer, 1, 5n);
            await client.recordAt(subscription, first.blockNumber);
            const reads = () => relay.requestCount("eth_getStorageAt");

            relay.refuseConnections(true);
            relay.disconnect();
            await writeSlot(signer, writer, 1, 6n);
            await writeSlot(signer, writer, 1, 7n);
            const last = await writeSlot(signer, writer, 1, 8n);
            const before = reads();
            relay.refuseConnections(false);
            const records = [
                await client.nextRecord(subscription),
                await client.nextRecord(subscription),
                await client.nextRecord(subscription)
            ];

            // one read of the new value per block, none of the old value
            expect(reads() - before).to.equal(3);
            expect(records.map((r) => r.pre[writer].storage)).to.deep.equal([
                { [slotKey(1)]: storageWord(5n) },
                { [slotKey(1)]: storageWord(6n) },
                { [slotKey(1)]: storageWord(7n) }
            ]);
            expect(records[2].number).to.equal(toQuantity(last.blockNumber));
        });
    });

    it("reads the balance, nonce and code of a touched account only when the trace shows them change", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            const sender = (await signer.getAddress()).toLowerCase();
            const subscription = await client.subscribe([writer, sender]);
            await client.nextSnapshot(subscription);
            // a failed frame in every block makes the service read the values
            relay.tamper("debug_traceBlockByNumber", (result, params) =>
                asksCallFrames(params) ? withFailedFrames(result) : result
            );

            const receipt = await writeSlot(signer, writer, 1, 5n);
            await client.recordAt(subscription, receipt.blockNumber);

            const readsOf = (address: string) =>
                ["eth_getBalance", "eth_getTransactionCount", "eth_getCode"]
                    .flatMap((method) => relay.paramsOf(method))
                    .filter(
                        (params) =>
                            params[0] === address &&
                            (params[1] as { blockHash?: string })?.blockHash ===
                                receipt.blockHash
                    ).length;
            // the sender pays and sends: its balance and nonce change; the writer's scalars do not
            expect(readsOf(writer)).to.equal(0);
            expect(readsOf(sender)).to.be.greaterThan(0);
        });
    });
});
