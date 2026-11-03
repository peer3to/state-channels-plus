import {
    StorageDiffClient,
    StorageDiffRpcError
} from "../../fixtures/node/StorageDiffClient";
import {
    deployNumberStorage,
    recordKey,
    setValue,
    storageWord,
    VALUE_SLOT
} from "../../fixtures/node/StorageDiffContracts";
import {
    fieldReads,
    openStorage,
    rejectionOf,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffSession";
import {
    INVALID_PARAMS,
    NOT_RETAINED_ERROR_CODE,
    ZERO_WORD
} from "@/utils/node/storageDiff/blockStorageDiff";
import { expect } from "chai";
import { getCreateAddress, toBeHex, toQuantity } from "ethers";

const SLOT = { slots: [VALUE_SLOT] };

/** `count` distinct 32-byte slot keys, from slot 1 on. */
function slotKeys(count: number): string[] {
    return Array.from({ length: count }, (_, i) => toBeHex(i + 1, 32));
}

describe("StorageDiffService state", function () {
    it("reads a slot from the upstream on the first read, pinned to the best head's block hash", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const { address, set } = await openStorage(client, signer);
            const { record: head } = await set(5n);

            const state = await client.getState(head.hash, [
                { address, ...SLOT }
            ]);

            expect(state.accounts[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(5n)
            });
            expect(fieldReads(relay)).to.equal(1);
            expect(relay.paramsOf("eth_getStorageAt")[0][2]).to.deep.equal({
                blockHash: head.hash
            });
        });
    });

    it("fetches a slot once for concurrent reads of it", async function () {
        await withStorageDiffSession(
            async ({ client, relay, service, signer }) => {
                const { address, set } = await openStorage(client, signer);
                const { record: head } = await set(5n);
                const clients = await Promise.all(
                    Array.from({ length: 5 }, () =>
                        StorageDiffClient.connect(service.url)
                    )
                );
                try {
                    const states = await Promise.all(
                        clients.map((peer) =>
                            peer.getState(head.hash, [{ address, ...SLOT }])
                        )
                    );

                    for (const state of states) {
                        expect(state.accounts[address].storage).to.deep.equal({
                            [VALUE_SLOT]: storageWord(5n)
                        });
                    }
                    expect(fieldReads(relay)).to.equal(1);
                } finally {
                    for (const peer of clients) peer.close();
                }
            }
        );
    });

    it("updates a cached slot from a block's write without an upstream request", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const { address, set } = await openStorage(client, signer);
            const { record: head } = await set(5n);
            await client.getState(head.hash, [{ address, ...SLOT }]);

            const { record: next } = await set(9n);
            const state = await client.getState(next.hash, [
                { address, ...SLOT }
            ]);

            expect(state.accounts[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(9n)
            });
            expect(fieldReads(relay)).to.equal(1);
        });
    });

    it("reads a slot cleared to zero as the zero word", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const { address, set } = await openStorage(client, signer);
            const { record: head } = await set(5n);
            await client.getState(head.hash, [{ address, ...SLOT }]);

            const { record: next } = await set(0n);
            const state = await client.getState(next.hash, [
                { address, ...SLOT }
            ]);

            expect(state.accounts[address].storage).to.deep.equal({
                [VALUE_SLOT]: ZERO_WORD
            });
            expect(fieldReads(relay)).to.equal(1);
        });
    });

    it("applies a block mined while the fetch of a slot was in flight", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const { address, set } = await openStorage(client, signer);
            const { record: head } = await set(1n);
            const held = relay.holdNext("eth_getStorageAt", address);

            const read = client.getState(head.hash, [{ address, ...SLOT }]);
            await held.arrived;
            const { record: next } = await set(7n);
            held.release();
            await read;

            const state = await client.getState(next.hash, [
                { address, ...SLOT }
            ]);
            expect(state.accounts[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(7n)
            });
            expect(fieldReads(relay)).to.equal(1);
        });
    });

    it("rolls a cached slot back to the value before an orphaned block after a reorg", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const { storage, address, subscription } = await openStorage(
                    client,
                    signer
                );
                const kept = await setValue(storage, 1n);
                const dropped = await setValue(storage, 2n);
                await client.recordAt(subscription, kept.blockNumber);
                const orphan = await client.recordAt(
                    subscription,
                    dropped.blockNumber
                );
                const before = await client.getState(orphan.hash, [
                    { address, ...SLOT }
                ]);
                expect(before.accounts[address].storage).to.deep.equal({
                    [VALUE_SLOT]: storageWord(2n)
                });

                await provider.send("anvil_reorg", [1, []]);
                await provider.send("evm_mine", []);
                const replacement = await client.nextRecord(subscription);

                const state = await client.getState(replacement.hash, [
                    { address, ...SLOT }
                ]);
                expect(state.accounts[address].storage).to.deep.equal({
                    [VALUE_SLOT]: storageWord(1n)
                });
                expect(fieldReads(relay)).to.equal(1);
            }
        );
    });

    it("reads a slot at an older retained block as that block's value", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const { storage, address, subscription } = await openStorage(
                client,
                signer
            );
            const first = await setValue(storage, 1n);
            const second = await setValue(storage, 2n);
            const older = await client.recordAt(
                subscription,
                first.blockNumber
            );
            const newer = await client.recordAt(
                subscription,
                second.blockNumber
            );

            const atNewer = await client.getState(newer.hash, [
                { address, ...SLOT }
            ]);
            const atOlder = await client.getState(older.hash, [
                { address, ...SLOT }
            ]);

            expect(atNewer.accounts[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(2n)
            });
            expect(atOlder.accounts[address].storage).to.deep.equal({
                [VALUE_SLOT]: storageWord(1n)
            });
            expect(atOlder.number).to.equal(toQuantity(first.blockNumber));
            expect(fieldReads(relay)).to.equal(1);
        });
    });

    it("fails with the not-retained error for a block older than the window", async function () {
        await withStorageDiffSession(
            async ({ client, provider, signer }) => {
                const { address, subscription, set } = await openStorage(
                    client,
                    signer
                );
                const { record: oldRecord } = await set(1n);
                await provider.send("anvil_mine", [3]);
                const head = Number(await provider.send("eth_blockNumber", []));
                await client.recordAt(subscription, head);

                const error = await rejectionOf(
                    client.getState(oldRecord.hash, [{ address, ...SLOT }])
                );

                expect(error).to.be.instanceOf(StorageDiffRpcError);
                expect((error as StorageDiffRpcError).code).to.equal(
                    NOT_RETAINED_ERROR_CODE
                );
            },
            { retention: 2 }
        );
    });

    it("fails with the not-retained error for a block hash the service does not know", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const storage = await deployNumberStorage(signer);
            const address = await recordKey(storage);

            const error = await rejectionOf(
                client.getState("0x" + "11".repeat(32), [{ address, ...SLOT }])
            );

            expect((error as StorageDiffRpcError).code).to.equal(
                NOT_RETAINED_ERROR_CODE
            );
            expect(fieldReads(relay)).to.equal(0);
        });
    });

    it("fails with the not-retained error for a block a reorg orphaned", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const { address, subscription, set } = await openStorage(
                client,
                signer
            );
            const { record: orphan } = await set(2n);
            await provider.send("anvil_reorg", [1, []]);
            await provider.send("evm_mine", []);
            await client.nextRecord(subscription);

            const error = await rejectionOf(
                client.getState(orphan.hash, [{ address, ...SLOT }])
            );

            expect((error as StorageDiffRpcError).code).to.equal(
                NOT_RETAINED_ERROR_CODE
            );
        });
    });

    it("refuses a malformed state request with invalid params", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const error = await rejectionOf(
                client.request("scp_getState", [
                    "0x1234",
                    [{ address: "0x1234" }]
                ])
            );

            expect((error as StorageDiffRpcError).code).to.equal(
                INVALID_PARAMS
            );
        });
    });

    // Mutation: the field cap removed -> the request is answered.
    it("refuses a state read naming more than 1024 fields with invalid params and reads nothing", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const { address, set } = await openStorage(client, signer);
            const { record: head } = await set(5n);
            const readsBefore = fieldReads(relay);

            const error = await rejectionOf(
                client.getState(head.hash, [
                    { address, slots: slotKeys(1023), account: true }
                ])
            );

            expect((error as StorageDiffRpcError).code).to.equal(
                INVALID_PARAMS
            );
            expect(fieldReads(relay)).to.equal(readsBefore);
        });
    });

    // Mutation: the fetch limit removed -> all 64 reads at the node at once.
    it("keeps at most 16 state reads at the upstream at once", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const { address, set } = await openStorage(client, signer);
            const { record: head } = await set(5n);

            const state = await client.getState(head.hash, [
                { address, slots: slotKeys(64) }
            ]);

            expect(
                Object.keys(state.accounts[address].storage!)
            ).to.have.length(64);
            expect(relay.maxInFlight("eth_getStorageAt")).to.be.within(2, 16);
        });
    });

    it("answers a state read at the field cap while blocks are mined, and keeps pushing records", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const { address, set } = await openStorage(client, signer);
            const { record: head } = await set(5n);

            const read = client.getState(head.hash, [
                { address, slots: slotKeys(1024) }
            ]);
            const second = await set(6n);
            const third = await set(7n);

            expect(
                Object.keys((await read).accounts[address].storage!)
            ).to.have.length(1024);
            expect(third.record.parentHash).to.equal(second.record.hash);
        });
    });

    it("keeps a cached balance current after a transfer without another fetch", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const recipient = "0x" + "ab".repeat(20);
            const subscription = await client.subscribe([]);
            const start = await signer.sendTransaction({
                to: "0x" + "cd".repeat(20),
                value: 1n
            });
            const first = await client.recordAt(
                subscription,
                (await start.wait())!.blockNumber
            );
            const before = await client.getState(first.hash, [
                { address: recipient, account: true }
            ]);
            expect(before.accounts[recipient].balance).to.equal("0x0");

            const transfer = await signer.sendTransaction({
                to: recipient,
                value: 5n
            });
            const next = await client.recordAt(
                subscription,
                (await transfer.wait())!.blockNumber
            );
            const after = await client.getState(next.hash, [
                { address: recipient, account: true }
            ]);

            expect(after.accounts[recipient].balance).to.equal("0x5");
            expect(fieldReads(relay)).to.equal(2);
        });
    });

    it("keeps a cached nonce current after the account sends a transaction", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const sender = (await signer.getAddress()).toLowerCase();
            const subscription = await client.subscribe([]);
            const first = await signer.sendTransaction({ to: sender });
            const head = await client.recordAt(
                subscription,
                (await first.wait())!.blockNumber
            );
            const before = await client.getState(head.hash, [
                { address: sender, account: true }
            ]);

            const second = await signer.sendTransaction({ to: sender });
            const next = await client.recordAt(
                subscription,
                (await second.wait())!.blockNumber
            );
            const after = await client.getState(next.hash, [
                { address: sender, account: true }
            ]);

            expect(after.accounts[sender].nonce).to.equal(
                before.accounts[sender].nonce! + 1
            );
            expect(fieldReads(relay)).to.equal(2);
        });
    });

    it("keeps cached code current after a deploy and reads it as empty at an earlier block", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const subscription = await client.subscribe([]);
            const sender = await signer.getAddress();
            const prelude = await signer.sendTransaction({ to: sender });
            const earlier = await client.recordAt(
                subscription,
                (await prelude.wait())!.blockNumber
            );
            const future = getCreateAddress({
                from: sender,
                nonce: await signer.getNonce()
            }).toLowerCase();
            const empty = await client.getState(earlier.hash, [
                { address: future, code: true }
            ]);
            expect(empty.accounts[future].code).to.equal("0x");

            const storage = await deployNumberStorage(signer);
            expect(await recordKey(storage)).to.equal(future);
            const deployed = await client.recordAt(
                subscription,
                Number(
                    (await storage.deploymentTransaction()!.wait())!.blockNumber
                )
            );
            const now = await client.getState(deployed.hash, [
                { address: future, code: true }
            ]);
            const back = await client.getState(earlier.hash, [
                { address: future, code: true }
            ]);

            expect(now.accounts[future].code).to.have.length.greaterThan(2);
            expect(back.accounts[future].code).to.equal("0x");
            expect(fieldReads(relay)).to.equal(1);
        });
    });

    it("carries the block environment on every pushed record and on the catch-up head", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const { set } = await openStorage(client, signer);
            const { receipt, record } = await set(3n);

            const raw = await provider.send("eth_getBlockByNumber", [
                toQuantity(receipt.blockNumber),
                false
            ]);
            expect({
                number: record.number,
                hash: record.hash,
                timestamp: record.timestamp,
                baseFeePerGas: record.baseFeePerGas,
                gasLimit: record.gasLimit,
                miner: record.miner,
                mixHash: record.mixHash
            }).to.deep.equal({
                number: raw.number,
                hash: raw.hash,
                timestamp: raw.timestamp,
                baseFeePerGas: raw.baseFeePerGas,
                gasLimit: raw.gasLimit,
                miner: raw.miner.toLowerCase(),
                mixHash: raw.mixHash
            });
            const catchUp = await client.catchUp([], receipt.blockNumber);
            expect(catchUp.head.hash).to.equal(record.hash);
            expect(catchUp.head.timestamp).to.equal(raw.timestamp);
            expect(catchUp.records[0].miner).to.equal(record.miner);
        });
    });
});
