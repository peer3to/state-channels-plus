import {
    deployNumberStorage,
    recordKey,
    setValue,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffService.fixture";
import { NOT_RETAINED_ERROR_CODE } from "@/utils/node/storageDiff/blockStorageDiff";
import { expect } from "chai";
import { toQuantity } from "ethers";

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
            const address = await recordKey(storage);
            const subscription = await client.subscribe([address]);
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
            const trips = relay.roundTrips;

            await client.getState(head.hash, [
                {
                    address,
                    slots: ["0x" + "00".repeat(32)],
                    account: true,
                    code: true
                }
            ]);

            expect(relay.roundTrips - trips).to.equal(1);
            expect(relay.requestCount("eth_getStorageAt")).to.equal(1);
            expect(relay.requestCount("eth_getBalance")).to.equal(1);
            expect(relay.requestCount("eth_getTransactionCount")).to.equal(1);
            expect(relay.requestCount("eth_getCode")).to.equal(1);
        });
    });

    it("keeps answering a state read for an older retained block after the head moved", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
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
            expect(relay.requestCount("eth_getStorageAt")).to.equal(1);
        });
    });
});
