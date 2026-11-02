import { StorageDiffRpcError } from "../../fixtures/node/StorageDiffClient";
import {
    deployNumberStorage,
    setValue
} from "../../fixtures/node/StorageDiffContracts";
import {
    rejectionOf,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffSession";
import { sleep } from "@/utils";
import {
    INTERNAL_ERROR,
    INVALID_PARAMS
} from "@/utils/node/storageDiff/blockStorageDiff";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
import { expect } from "chai";
import { toQuantity, Wallet } from "ethers";

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

    it("reads each receipt where the upstream does not know eth_getBlockReceipts", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                const receipt = await setValue(storage, 3n);
                await client.subscribe([]);
                relay.failNext("eth_getBlockReceipts", 1, {
                    code: -32601,
                    message: "the method eth_getBlockReceipts does not exist"
                });

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
            }
        );
    });

    it("asks eth_getBlockReceipts again after an error answer that is not method-not-found", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                const receipt = await setValue(storage, 3n);
                await client.subscribe([]);
                relay.failNext("eth_getBlockReceipts", 1);

                const failed = await rejectionOf(
                    client.request("scp_getTransactionReceipt", [receipt.hash])
                );
                const answer = await client.request(
                    "scp_getTransactionReceipt",
                    [receipt.hash]
                );

                expect(failed).to.be.instanceOf(Error);
                expect(answer).to.deep.equal(
                    await provider.send("eth_getTransactionReceipt", [
                        receipt.hash
                    ])
                );
                expect(relay.requestCount("eth_getBlockReceipts")).to.equal(2);
                expect(
                    relay.requestCount("eth_getTransactionReceipt")
                ).to.equal(0);
            }
        );
    });

    // Mutation: a null receipt answer is kept as the block's receipt.
    it("reads a receipt again after the upstream answered null for it", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                const receipt = await setValue(storage, 3n);
                await client.subscribe([]);
                relay.failNext("eth_getBlockReceipts", 1, {
                    code: -32601,
                    message: "the method eth_getBlockReceipts does not exist"
                });
                // a node that has not indexed the block answers null once
                let indexed = false;
                relay.tamper("eth_getTransactionReceipt", (result) => {
                    if (indexed) return result;
                    indexed = true;
                    return null;
                });

                const failed = await rejectionOf(
                    client.request("scp_getTransactionReceipt", [receipt.hash])
                );
                const answer = await client.request(
                    "scp_getTransactionReceipt",
                    [receipt.hash]
                );

                expect(failed).to.be.instanceOf(StorageDiffRpcError);
                expect(answer).to.deep.equal(
                    await provider.send("eth_getTransactionReceipt", [
                        receipt.hash
                    ])
                );
                expect(
                    relay.requestCount("eth_getTransactionReceipt")
                ).to.equal(2);
            }
        );
    });

    // Mutation: an upstream error answer's code and message reach the peer.
    it("answers a peer with an internal error, not the upstream's code and message, when the upstream fails a receipts read", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const storage = await deployNumberStorage(signer);
            const receipt = await setValue(storage, 3n);
            await client.subscribe([]);
            // -32002 is also the service's own not-retained code
            relay.failNext("eth_getBlockReceipts", 1, {
                code: -32002,
                message: `resource unavailable at ${relay.url}`
            });

            const error = await rejectionOf(
                client.request("scp_getTransactionReceipt", [receipt.hash])
            );

            expect(error).to.be.instanceOf(StorageDiffRpcError);
            expect((error as StorageDiffRpcError).code).to.equal(
                INTERNAL_ERROR
            );
            expect((error as Error).message).to.equal("Internal error");
        });
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

    // Mutation: every wait asks the upstream for its block number.
    it("asks the upstream for its block number once for many reads waiting for a block it has not seen", async function () {
        await withStorageDiffSession(async ({ client, relay }) => {
            await client.subscribe([]);
            const head = (await client.request("scp_getHead", [])) as {
                number: string;
                hash: string;
            };
            const asked = toQuantity(BigInt(head.number) + 100n);
            const before = relay.requestCount("eth_blockNumber");

            const answers = (await Promise.all(
                Array.from({ length: 200 }, () =>
                    client.request("scp_getHead", [asked])
                )
            )) as { number: string }[];

            expect(answers.map((answer) => answer.number)).to.deep.equal(
                answers.map(() => head.number)
            );
            // one ask, one more for reads that came during it, and a heartbeat at most
            expect(
                relay.requestCount("eth_blockNumber") - before
            ).to.be.at.most(3);
            expect(await client.nextDelay()).to.deep.equal({
                reason: "upstream-behind",
                requested: asked,
                head: { number: head.number, hash: head.hash }
            });
        });
    });

    // Mutation: every upstream-behind is pushed, the same one again included.
    it("does not push an upstream-behind notice again that is the same as the last one at an unchanged head", async function () {
        await withStorageDiffSession(async ({ client }) => {
            await client.subscribe([]);
            const head = (await client.request("scp_getHead", [])) as {
                number: string;
                hash: string;
            };
            const asked = toQuantity(BigInt(head.number) + 100n);

            await client.request("scp_getHead", [asked]);
            await client.request("scp_getHead", [asked]);

            expect(await client.nextDelay()).to.deep.equal({
                reason: "upstream-behind",
                requested: asked,
                head: { number: head.number, hash: head.hash }
            });
            await sleep(200);
            expect(client.unreadDelays()).to.deep.equal([]);
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

    // Mutation: scp_getTransaction reads minBlock from another param, or does not wait.
    it("holds a transaction read that names the block its caller saw until the head reaches it", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                await client.subscribe([]);
                // the first block of the session: the backstop is still the SDK deadline
                const held = relay.holdNext("eth_getBlockByNumber", "latest");
                const sent = await signer.sendTransaction({
                    to: Wallet.createRandom().address,
                    value: 1n
                });
                const receipt = (await sent.wait())!;
                await held.arrived;
                let settled = false;
                const read = client
                    .request("scp_getTransaction", [
                        receipt.hash,
                        toQuantity(receipt.blockNumber)
                    ])
                    .finally(() => (settled = true));
                await sleep(ABSENCE_WINDOW_MS);
                expect(
                    settled,
                    "the service has not reached the block"
                ).to.equal(false);
                held.release();

                expect(await read).to.deep.equal(
                    await provider.send("eth_getTransactionByHash", [
                        receipt.hash
                    ])
                );
            }
        );
    });

    // Mutation: scp_getTransactionReceipt reads minBlock from another param, or does not wait.
    it("holds a receipt read that names the block its caller saw until the head reaches it", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                await client.subscribe([]);
                // the first block of the session: the backstop is still the SDK deadline
                const held = relay.holdNext("eth_getBlockByNumber", "latest");
                const sent = await signer.sendTransaction({
                    to: Wallet.createRandom().address,
                    value: 1n
                });
                const receipt = (await sent.wait())!;
                await held.arrived;
                let settled = false;
                const read = client
                    .request("scp_getTransactionReceipt", [
                        receipt.hash,
                        toQuantity(receipt.blockNumber)
                    ])
                    .finally(() => (settled = true));
                await sleep(ABSENCE_WINDOW_MS);
                expect(
                    settled,
                    "the service has not reached the block"
                ).to.equal(false);
                held.release();

                expect(await read).to.deep.equal(
                    await provider.send("eth_getTransactionReceipt", [
                        receipt.hash
                    ])
                );
            }
        );
    });

    // Mutation: any one of the rules below is dropped.
    it("refuses malformed scp_getBlock params with invalid params", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const malformed = [
                ["pending"],
                ["latest", "yes"],
                ["latest", false, "0x1", "extra"],
                ["latest", false, "0x" + "f".repeat(17)],
                ["latest", false, 7]
            ];

            const codes = await Promise.all(
                malformed.map(async (params) => {
                    const error = await rejectionOf(
                        client.request("scp_getBlock", params)
                    );
                    return (error as StorageDiffRpcError | undefined)?.code;
                })
            );

            expect(codes).to.deep.equal(malformed.map(() => INVALID_PARAMS));
        });
    });

    // Mutation: any one of the rules below is dropped.
    it("refuses malformed scp_getHead params with invalid params", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const malformed = [["0x1", "0x2"], ["0x" + "f".repeat(17)], ["7"]];

            const codes = await Promise.all(
                malformed.map(async (params) => {
                    const error = await rejectionOf(
                        client.request("scp_getHead", params)
                    );
                    return (error as StorageDiffRpcError | undefined)?.code;
                })
            );

            expect(codes).to.deep.equal(malformed.map(() => INVALID_PARAMS));
        });
    });

    // Mutation: any one of the rules below is dropped, for either endpoint.
    it("refuses malformed transaction and receipt read params with invalid params", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const hash = "0x" + "cd".repeat(32);
            const malformed = [
                [],
                [hash, "0x1", "extra"],
                ["0x1234"],
                [hash, "0x" + "f".repeat(17)]
            ];

            const codes = await Promise.all(
                ["scp_getTransaction", "scp_getTransactionReceipt"].flatMap(
                    (method) =>
                        malformed.map(async (params) => {
                            const error = await rejectionOf(
                                client.request(method, params)
                            );
                            return (error as StorageDiffRpcError | undefined)
                                ?.code;
                        })
                )
            );

            expect(codes).to.deep.equal(
                [...malformed, ...malformed].map(() => INVALID_PARAMS)
            );
        });
    });
});
