import {
    deployNumberStorage,
    recordKey,
    rejectionOf,
    setValue,
    StorageDiffClient,
    StorageDiffRpcError,
    storageWord,
    VALUE_SLOT,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffService.fixture";
import {
    INVALID_PARAMS,
    METHOD_NOT_FOUND,
    PRUNED_ERROR_CODE,
    ZERO_WORD
} from "@/utils/node/storageDiff/blockStorageDiff";
import { RECONCILE_RETRY_LIMIT } from "@/utils/node/storageDiff/StorageDiffService";
import { expect } from "chai";
import { toQuantity } from "ethers";

describe("StorageDiffService", function () {
    it("pushes the pre and post value of a slot a transaction wrote to a subscriber of that address", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);

            const receipt = await setValue(storage, 42n);

            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            expect(record.pre[address].storage).to.deep.equal({
                [VALUE_SLOT]: ZERO_WORD
            });
            expect(record.post[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(42n)
            });
        });
    });

    it("pushes the header and no diff of a block whose transactions leave the subscribed address untouched", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const watched = await deployNumberStorage(signer);
            const other = await deployNumberStorage(signer);
            const subscription = await client.subscribe([
                await recordKey(watched)
            ]);

            const receipt = await setValue(other, 7n);

            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            const block = await provider.getBlock(receipt.blockNumber);
            expect(record.number).to.equal(toQuantity(receipt.blockNumber));
            expect(record.hash).to.equal(block!.hash);
            expect(record.parentHash).to.equal(block!.parentHash);
            expect(record.pre).to.deep.equal({});
            expect(record.post).to.deep.equal({});
        });
    });

    it("pushes a record for a block without transactions", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const storage = await deployNumberStorage(signer);
            const subscription = await client.subscribe([
                await recordKey(storage)
            ]);

            await provider.send("evm_mine", []);
            const empty = await provider.getBlock("latest");

            const record = await client.recordAt(subscription, empty!.number);
            expect(empty!.transactions).to.have.length(0);
            expect(record.hash).to.equal(empty!.hash);
            expect(record.post).to.deep.equal({});
        });
    });

    it("reports a slot cleared to zero as the zero word in post", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            await setValue(storage, 42n);
            const subscription = await client.subscribe([address]);

            const receipt = await setValue(storage, 0n);

            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            expect(record.pre[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(42n)
            });
            expect(record.post[address].storage).to.deep.equal({
                [VALUE_SLOT]: ZERO_WORD
            });
        });
    });

    it("merges two writes in one block into the earliest pre and the latest post", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
            await provider.send("evm_setAutomine", [false]);

            await storage.setValue(1n);
            await storage.setValue(2n);
            await provider.send("evm_mine", []);
            const block = await provider.getBlock("latest");

            const record = await client.recordAt(subscription, block!.number);
            expect(block!.transactions).to.have.length(2);
            expect(record.pre[address].storage).to.deep.equal({
                [VALUE_SLOT]: ZERO_WORD
            });
            expect(record.post[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(2n)
            });
        });
    });

    it("returns the retained records from fromBlock to the head in chain order", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
            const first = await setValue(storage, 1n);
            await setValue(storage, 2n);
            const last = await setValue(storage, 3n);
            await client.recordAt(subscription, last.blockNumber);

            const records = await client.getDiffs([address], first.blockNumber);

            expect(records.map((record) => record.number)).to.deep.equal([
                toQuantity(first.blockNumber),
                toQuantity(first.blockNumber + 1),
                toQuantity(first.blockNumber + 2)
            ]);
            expect(records[1].parentHash).to.equal(records[0].hash);
            expect(records[2].parentHash).to.equal(records[1].hash);
            expect(
                records.map((record) => record.post[address].storage)
            ).to.deep.equal([
                { [VALUE_SLOT]: storageWord(1n) },
                { [VALUE_SLOT]: storageWord(2n) },
                { [VALUE_SLOT]: storageWord(3n) }
            ]);
        });
    });

    it("returns no records for a fromBlock after the head", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
            const receipt = await setValue(storage, 1n);
            await client.recordAt(subscription, receipt.blockNumber);

            const records = await client.getDiffs(
                [address],
                receipt.blockNumber + 1
            );

            expect(records).to.deep.equal([]);
        });
    });

    it("fails with the pruned error for a fromBlock older than the retention window", async function () {
        await withStorageDiffSession(
            async ({ client, signer }) => {
                const storage = await deployNumberStorage(signer);
                const address = await recordKey(storage);
                const subscription = await client.subscribe([address]);
                await setValue(storage, 1n);
                const last = await setValue(storage, 2n);
                await client.recordAt(subscription, last.blockNumber);

                const error = await rejectionOf(
                    client.getDiffs([address], last.blockNumber - 2)
                );

                expect(error).to.be.instanceOf(StorageDiffRpcError);
                expect((error as StorageDiffRpcError).code).to.equal(
                    PRUNED_ERROR_CODE
                );
            },
            { retention: 2 }
        );
    });

    it("returns the whole window for a fromBlock equal to the oldest retained block", async function () {
        await withStorageDiffSession(
            async ({ client, signer }) => {
                const storage = await deployNumberStorage(signer);
                const address = await recordKey(storage);
                const subscription = await client.subscribe([address]);
                await setValue(storage, 1n);
                const last = await setValue(storage, 2n);
                await client.recordAt(subscription, last.blockNumber);

                const records = await client.getDiffs(
                    [address],
                    last.blockNumber - 1
                );

                expect(records.map((record) => record.number)).to.deep.equal([
                    toQuantity(last.blockNumber - 1),
                    toQuantity(last.blockNumber)
                ]);
            },
            { retention: 2 }
        );
    });

    it("pushes a replacement record whose parentHash is the common ancestor after a reorg", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
            const kept = await setValue(storage, 1n);
            const dropped = await setValue(storage, 2n);
            const ancestor = await client.recordAt(
                subscription,
                kept.blockNumber
            );
            const replaced = await client.recordAt(
                subscription,
                dropped.blockNumber
            );

            await provider.send("anvil_reorg", [1, []]);
            await provider.send("evm_mine", []);

            const replacement = await client.nextRecord(subscription);
            expect(replacement.number).to.equal(replaced.number);
            expect(replacement.hash).to.not.equal(replaced.hash);
            expect(replacement.parentHash).to.equal(ancestor.hash);
            expect(replacement.post).to.deep.equal({});
        });
    });

    it("refuses an address list that holds a malformed address with invalid params", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const error = await rejectionOf(
                client.request("scp_getContractStorageDiffs", [["0x1234"], 0])
            );

            expect(error).to.be.instanceOf(StorageDiffRpcError);
            expect((error as StorageDiffRpcError).code).to.equal(
                INVALID_PARAMS
            );
        });
    });

    it("fails the service when the upstream node goes away", async function () {
        await withStorageDiffSession(async ({ relay, service }) => {
            relay.disconnect();

            const failure = await rejectionOf(service.closed);

            expect(failure).to.be.instanceOf(Error);
        });
    });

    it("stops pushing to a subscription once scp_unsubscribe returns true", async function () {
        await withStorageDiffSession(async ({ client, service, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
            const witness = await StorageDiffClient.connect(service.url);
            try {
                const witnessSubscription = await witness.subscribe([address]);

                const unsubscribed = await client.unsubscribe(subscription);
                const receipt = await setValue(storage, 1n);
                await witness.recordAt(
                    witnessSubscription,
                    receipt.blockNumber
                );

                expect(unsubscribed).to.equal(true);
                expect(
                    client
                        .unread(subscription)
                        .filter(
                            (record) =>
                                Number(record.number) >= receipt.blockNumber
                        )
                ).to.deep.equal([]);
            } finally {
                witness.close();
            }
        });
    });

    it("answers false to scp_unsubscribe for a subscription id the socket does not hold", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const unsubscribed = await client.unsubscribe("0x1");

            expect(unsubscribed).to.equal(false);
        });
    });

    it("keeps pushing to the socket's other subscriptions after one is unsubscribed", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const dropped = await client.subscribe([address]);
            const kept = await client.subscribe([address]);

            await client.unsubscribe(dropped);
            const receipt = await setValue(storage, 1n);

            const record = await client.recordAt(kept, receipt.blockNumber);
            expect(record.post[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(1n)
            });
        });
    });

    it("retries a block that changed while it was traced and pushes the canonical record", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                const address = await recordKey(storage);
                const subscription = await client.subscribe([address]);
                const next = (await provider.getBlockNumber()) + 1;
                const trace = relay.holdNext(
                    "debug_traceBlockByNumber",
                    toQuantity(next)
                );

                await setValue(storage, 1n);
                await trace.arrived;
                // Replaces the traced block with an empty one.
                await provider.send("anvil_reorg", [1, []]);
                trace.release();

                const record = await client.recordAt(subscription, next);
                const canonical = await provider.getBlock(next);
                expect(record.hash).to.equal(canonical!.hash);
                expect(record.post).to.deep.equal({});
            }
        );
    });

    it("retries an upstream error answer and pushes the record", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
            relay.failNext("debug_traceBlockByNumber", 1);

            const receipt = await setValue(storage, 1n);

            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            expect(record.post[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(1n)
            });
        });
    });

    it("fails the service once the retries of an upstream error are exhausted", async function () {
        await withStorageDiffSession(async ({ relay, service, signer }) => {
            const storage = await deployNumberStorage(signer);
            relay.failNext(
                "debug_traceBlockByNumber",
                RECONCILE_RETRY_LIMIT + 1
            );
            const tracesBefore = relay.requestCount("debug_traceBlockByNumber");

            await setValue(storage, 1n);
            const failure = await rejectionOf(service.closed);

            expect(failure).to.be.instanceOf(Error);
            expect(
                relay.requestCount("debug_traceBlockByNumber") - tracesBefore
            ).to.equal(RECONCILE_RETRY_LIMIT + 1);
        });
    });

    it("answers method not found for a request naming a member that is not an endpoint", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const constructorError = await rejectionOf(
                client.request("constructor", [])
            );
            const fieldError = await rejectionOf(client.request("service", []));

            expect((constructorError as StorageDiffRpcError).code).to.equal(
                METHOD_NOT_FOUND
            );
            expect((fieldError as StorageDiffRpcError).code).to.equal(
                METHOD_NOT_FOUND
            );
        });
    });
});
