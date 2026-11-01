import {
    deployNumberStorage,
    recordKey,
    setValue
} from "../../fixtures/node/StorageDiffContracts";
import {
    fieldReads,
    rejectionOf,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffSession";
import { sleep } from "@/utils";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
import { expect } from "chai";
import { toQuantity } from "ethers";

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

    // Mutation: the service's backstop built with SDK_RPC_DEADLINE_MS / 2 ->
    // the wait ends after about 1.5 s and the lower bound below fails.
    it("waits about the full SDK deadline for a silent hang before any head has been committed", async function () {
        await withStorageDiffSession(async ({ client, provider, relay }) => {
            const before = (await client.request("scp_getHead", [])) as {
                number: string;
            };
            const held = relay.holdNext("eth_getBlockByNumber", "latest");
            await provider.send("evm_mine", []);
            await held.arrived;
            const mined = await provider.send("eth_blockNumber", []);
            const started = Date.now();

            const answer = (await client.request("scp_getHead", [mined])) as {
                number: string;
            };

            const waited = Date.now() - started;
            expect(answer.number).to.equal(before.number);
            // 3000 ms is the SDK's own request deadline
            expect(waited).to.be.at.least(2_700);
            expect(waited).to.be.lessThan(3_000 + 2_000);
            held.release();
        });
    });
});
