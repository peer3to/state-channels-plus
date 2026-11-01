import {
    deployEventOnlyEmitter,
    deployLogEmitter,
    deployNumberStorage,
    emitValue,
    setValue,
    storageWord,
    VALUE_SET_TOPIC
} from "../../fixtures/node/StorageDiffContracts";
import { withStorageDiffSession } from "../../fixtures/node/StorageDiffSession";
import { expect } from "chai";

describe("StorageDiffService logs", function () {
    it("attaches the log of a subscribed address to the record of the block that emitted it", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const subscription = await client.subscribe([emitter]);

            const receipt = await emitValue(signer, emitter, 7n);

            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            expect(record.logs).to.deep.equal([
                {
                    address: emitter,
                    topics: [VALUE_SET_TOPIC],
                    data: storageWord(7n),
                    logIndex: "0x0",
                    transactionIndex: "0x0",
                    transactionHash: receipt.hash
                }
            ]);
        });
    });

    it("asks the upstream for logs once per block whose logs bloom matches a subscribed address", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const subscription = await client.subscribe([emitter]);
            const before = relay.requestCount("eth_getLogs");

            const receipt = await emitValue(signer, emitter, 1n);
            await client.recordAt(subscription, receipt.blockNumber);

            expect(relay.requestCount("eth_getLogs") - before).to.equal(1);
        });
    });

    it("asks the upstream for no logs of a block whose logs bloom matches no subscribed address or that has no transactions", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const emitter = await deployLogEmitter(signer);
                const other = await deployNumberStorage(signer);
                const subscription = await client.subscribe([emitter]);
                const before = relay.requestCount("eth_getLogs");

                const untouched = await setValue(other, 3n);
                const record = await client.recordAt(
                    subscription,
                    untouched.blockNumber
                );
                await provider.send("evm_mine", []);
                const empty = Number(
                    await provider.send("eth_blockNumber", [])
                );
                const emptyRecord = await client.recordAt(subscription, empty);

                expect(record.logs).to.deep.equal([]);
                expect(emptyRecord.logs).to.deep.equal([]);
                expect(relay.requestCount("eth_getLogs")).to.equal(before);
            }
        );
    });

    it("asks the upstream for no logs of a block whose only log is from an address nobody subscribed to", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const watched = await deployNumberStorage(signer);
            const subscription = await client.subscribe([
                (await watched.getAddress()).toLowerCase()
            ]);

            const receipt = await emitValue(signer, emitter, 5n);
            await client.recordAt(subscription, receipt.blockNumber);

            expect(relay.requestCount("eth_getLogs")).to.equal(0);
        });
    });

    it("attaches the log of a contract call that emits an event and changes no storage", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const emitter = await deployEventOnlyEmitter(signer);
            const subscription = await client.subscribe([emitter]);

            const receipt = await emitValue(signer, emitter, 6n);

            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            expect(record.pre).to.deep.equal({});
            expect(record.post).to.deep.equal({});
            expect(record.logs.map((log) => log.data)).to.deep.equal([
                storageWord(6n)
            ]);
        });
    });

    it("fetches the missing logs once when a later catch-up asks for the address", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const receipt = await emitValue(signer, emitter, 9n);
            await client.subscribe([]);

            const first = await client.getDiffs([emitter], receipt.blockNumber);
            const second = await client.getDiffs(
                [emitter],
                receipt.blockNumber
            );

            expect(first[0].logs.map((log) => log.data)).to.deep.equal([
                storageWord(9n)
            ]);
            expect(second).to.deep.equal(first);
            expect(relay.requestCount("eth_getLogs")).to.equal(1);
        });
    });

    it("returns the logs of a subscribed address in the catch-up of its block", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const subscription = await client.subscribe([emitter]);
            const receipt = await emitValue(signer, emitter, 2n);
            await client.recordAt(subscription, receipt.blockNumber);

            const [record] = await client.getDiffs(
                [emitter],
                receipt.blockNumber
            );

            expect(record.logs.map((log) => log.data)).to.deep.equal([
                storageWord(2n)
            ]);
        });
    });

    it("leaves the logs of other addresses out of a catch-up", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const other = await deployNumberStorage(signer);
            const subscription = await client.subscribe([emitter]);
            const receipt = await emitValue(signer, emitter, 2n);
            await client.recordAt(subscription, receipt.blockNumber);

            const [record] = await client.getDiffs(
                [(await other.getAddress()).toLowerCase()],
                receipt.blockNumber
            );

            expect(record.logs).to.deep.equal([]);
        });
    });

    it("replaces the logs of a rolled back block with those of its replacement", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const subscription = await client.subscribe([emitter]);
            await emitValue(signer, emitter, 1n);
            const dropped = await emitValue(signer, emitter, 2n);
            const original = await client.recordAt(
                subscription,
                dropped.blockNumber
            );
            expect(original.logs).to.have.length(1);

            await provider.send("anvil_reorg", [1, []]);
            await provider.send("evm_mine", []);

            const replacement = await client.nextRecord(subscription);
            const [caughtUp] = await client.getDiffs(
                [emitter],
                dropped.blockNumber
            );
            expect(replacement.hash).to.not.equal(original.hash);
            expect(replacement.logs).to.deep.equal([]);
            expect(caughtUp.hash).to.equal(replacement.hash);
            expect(caughtUp.logs).to.deep.equal([]);
        });
    });

    it("retries a log fetch the upstream answered with an error and pushes the record with its log", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const emitter = await deployLogEmitter(signer);
            const subscription = await client.subscribe([emitter]);
            relay.failNext("eth_getLogs", 1);

            const receipt = await emitValue(signer, emitter, 4n);

            const record = await client.recordAt(
                subscription,
                receipt.blockNumber
            );
            expect(record.logs.map((log) => log.data)).to.deep.equal([
                storageWord(4n)
            ]);
        });
    });
});
