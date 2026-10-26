import {
    deployNumberStorage,
    INVALID_PARAMS,
    recordKey,
    rejectionOf,
    setValue,
    StorageDiffRpcError,
    storageWord,
    VALUE_SLOT,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffService.fixture";
import { PRUNED_ERROR_CODE, ZERO_WORD } from "@/utils/node/StorageDiffService";
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
        await withStorageDiffSession(async ({ client, node, signer }) => {
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
            const block = await node.provider.getBlock(receipt.blockNumber);
            expect(record.number).to.equal(toQuantity(receipt.blockNumber));
            expect(record.hash).to.equal(block!.hash);
            expect(record.parentHash).to.equal(block!.parentHash);
            expect(record.pre).to.deep.equal({});
            expect(record.post).to.deep.equal({});
        });
    });

    it("pushes a record for a block without transactions", async function () {
        await withStorageDiffSession(async ({ client, node, signer }) => {
            const storage = await deployNumberStorage(signer);
            const subscription = await client.subscribe([
                await recordKey(storage)
            ]);

            await node.provider.send("evm_mine", []);
            const empty = await node.provider.getBlock("latest");

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
        await withStorageDiffSession(async ({ client, node, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
            await node.provider.send("evm_setAutomine", [false]);

            await storage.setValue(1n);
            await storage.setValue(2n);
            await node.provider.send("evm_mine", []);
            const block = await node.provider.getBlock("latest");

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
        await withStorageDiffSession(async ({ client, node, signer }) => {
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

            await node.provider.send("anvil_reorg", [1, []]);
            await node.provider.send("evm_mine", []);

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
        await withStorageDiffSession(async ({ node, service }) => {
            await node.stop();

            const failure = await rejectionOf(service.closed);

            expect(failure).to.be.instanceOf(Error);
        });
    });
});
