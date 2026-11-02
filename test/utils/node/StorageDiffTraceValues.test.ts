import {
    asksCallFrames,
    deployNestedWriter,
    deployRevertProbe,
    deploySlotWriter,
    dumpedAccount,
    slotKey,
    storageWord,
    withFailedFrames,
    writeSlot
} from "../../fixtures/node/StorageDiffContracts";
import { withStorageDiffSession } from "../../fixtures/node/StorageDiffSession";
import { UPSTREAM_FAULT } from "../../fixtures/node/UpstreamRelay";
import { expect } from "chai";
import { Wallet, toQuantity } from "ethers";

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
            // the slot is cached: the step's first old value comes from the cache
            await client.getState(first.blockHash, [
                { address: writer, slots: [slotKey(1)] }
            ]);
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
