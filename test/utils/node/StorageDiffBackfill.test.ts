import {
    deployedAfter,
    probedBlock
} from "../../fixtures/node/StorageDiffBackfillFixture";
import {
    deploySlotWriter,
    dumpedAccount,
    slotKey,
    nonZero,
    storageWord,
    writeSlot
} from "../../fixtures/node/StorageDiffContracts";
import {
    fieldReads,
    withStorageDiffSession
} from "../../fixtures/node/StorageDiffSession";
import {
    UPSTREAM_FAULT,
    UpstreamErrorAnswer
} from "../../fixtures/node/UpstreamRelay";
import { sleep } from "@/utils";
import { ZERO_WORD } from "@/utils/node/storageDiff/blockStorageDiff";
import { expect } from "chai";
import { Wallet, toQuantity } from "ethers";

describe("StorageDiffService backfill", function () {
    it("pushes the complete storage of a contract at the head when it is first subscribed, as anvil dumps it", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            await writeSlot(signer, writer, 2, 7n);
            await writeSlot(signer, writer, 1, 9n);
            await writeSlot(signer, writer, 2, 0n);
            await writeSlot(signer, writer, 40, 3n);

            const subscription = await client.subscribe([writer]);
            const snapshot = await client.nextSnapshot(subscription);

            const dumped = await dumpedAccount(provider, writer);
            const pushed = snapshot.accounts[writer];
            expect(nonZero(pushed.storage)).to.deep.equal(
                nonZero(dumped.storage)
            );
            expect(nonZero(pushed.storage)).to.deep.equal({
                [slotKey(1)]: storageWord(9n),
                [slotKey(40)]: storageWord(3n)
            });
            expect(pushed.code).to.equal(dumped.code);
            expect(BigInt(pushed.balance!)).to.equal(BigInt(dumped.balance));
            expect(pushed.nonce).to.equal(dumped.nonce);
            const head = await provider.send("eth_getBlockByNumber", [
                "latest",
                false
            ]);
            expect(snapshot.block).to.deep.equal({
                number: head.number,
                hash: head.hash
            });
        });
    });

    it("finds the deploy block by bisection and traces only the blocks with transactions since", async function () {
        await withStorageDiffSession(
            async ({ client, provider, backfills, signer }) => {
                // blocks without transactions before the deploy, and between writes
                for (let i = 0; i < 20; i++)
                    await provider.send("evm_mine", []);
                const writer = await deploySlotWriter(signer);
                const deployed = Number(
                    (await provider.getTransactionReceipt(
                        (
                            await provider.send("eth_getBlockByNumber", [
                                "latest",
                                false
                            ])
                        ).transactions[0]
                    ))!.blockNumber
                );
                await writeSlot(signer, writer, 1, 5n);
                await provider.send("evm_mine", []);
                await provider.send("evm_mine", []);
                await writeSlot(signer, writer, 2, 6n);
                const head = Number(await provider.send("eth_blockNumber", []));

                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);

                const [cost] = backfills;
                expect(cost.deployBlock).to.equal(toQuantity(deployed));
                // a probe at the head, then about log2(head) probes of the bisection
                expect(cost.codeProbes).to.be.at.most(
                    Math.ceil(Math.log2(head + 1)) + 1
                );
                expect(cost.blocks).to.equal(head - deployed + 1);
                // the deploy block and the two writes
                expect(cost.tracedBlocks).to.equal(3);
                expect(cost.traces).to.equal(3);
            }
        );
    });

    it("answers a read of a never-written slot of a complete contract without asking the upstream", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            const receipt = await writeSlot(signer, writer, 1, 5n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);
            const head = await client.getDiffs([writer], receipt.blockNumber);
            const reads = fieldReads(relay);

            const state = await client.getState(head[0].hash, [
                { address: writer, slots: [slotKey(77), slotKey(1)] }
            ]);

            expect(state.accounts[writer].storage).to.deep.equal({
                [slotKey(77)]: ZERO_WORD,
                [slotKey(1)]: storageWord(5n)
            });
            expect(fieldReads(relay) - reads).to.equal(0);
        });
    });

    it("keeps a complete contract current from the records and does not push its snapshot again", async function () {
        await withStorageDiffSession(async ({ client, signer }) => {
            const writer = await deploySlotWriter(signer);
            await writeSlot(signer, writer, 1, 5n);
            const subscription = await client.subscribe([writer]);
            await client.nextSnapshot(subscription);

            const receipt = await writeSlot(signer, writer, 1, 8n);
            await client.recordAt(subscription, receipt.blockNumber);
            const again = await client.subscribe([
                writer,
                Wallet.createRandom().address.toLowerCase()
            ]);
            const second = await client.nextSnapshot(again);

            const head = await client.getDiffs([writer], receipt.blockNumber);
            const state = await client.getState(head[0].hash, [
                { address: writer, slots: [slotKey(1)] }
            ]);
            expect(state.accounts[writer].storage).to.deep.equal({
                [slotKey(1)]: storageWord(8n)
            });
            // the second subscription only carries the new account
            expect(Object.keys(second.accounts)).to.not.include(writer);
        });
    });

    // Mutation: a rolled-back block restores only slots the cache holds.
    it("answers a slot of a complete contract with its value before a block a reorg dropped, when that block cleared it", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                const cleared = await writeSlot(signer, writer, 1, 0n);
                const subscription = await client.subscribe([writer]);
                const snapshot = await client.nextSnapshot(subscription);
                expect(Number(snapshot.block.number)).to.equal(
                    cleared.blockNumber
                );

                // the block that cleared the slot is replaced by an empty one
                await provider.send("anvil_reorg", [1, []]);
                const replaced = await client.recordAt(
                    subscription,
                    cleared.blockNumber
                );
                const reads = fieldReads(relay);
                const state = await client.getState(replaced.hash, [
                    { address: writer, slots: [slotKey(1)] }
                ]);

                expect(replaced.hash).to.not.equal(cleared.blockHash);
                expect(state.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(5n)
                });
                // answered from the complete account, not the upstream
                expect(fieldReads(relay) - reads).to.equal(0);
            }
        );
    });

    it("pushes an account without code with its balance and nonce", async function () {
        await withStorageDiffSession(async ({ client, provider, signer }) => {
            const sender = (await signer.getAddress()).toLowerCase();
            const subscription = await client.subscribe([sender]);

            const snapshot = await client.nextSnapshot(subscription);

            expect(snapshot.accounts[sender].code).to.equal("0x");
            expect(snapshot.accounts[sender].storage).to.deep.equal({});
            expect(BigInt(snapshot.accounts[sender].balance!)).to.equal(
                await provider.getBalance(sender)
            );
        });
    });

    it("includes a block mined while the history is being traced", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const writer = await deploySlotWriter(signer);
                const first = await writeSlot(signer, writer, 1, 5n);
                const held = relay.holdNext(
                    "debug_traceBlockByNumber",
                    toQuantity(first.blockNumber)
                );
                const subscription = await client.subscribe([writer]);
                await held.arrived;

                await writeSlot(signer, writer, 1, 6n);
                held.release();
                const snapshot = await client.nextSnapshot(subscription);

                expect(snapshot.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(6n)
                });
                const head = await provider.send("eth_getBlockByNumber", [
                    "latest",
                    false
                ]);
                expect(snapshot.block.hash).to.equal(head.hash);
            }
        );
    });

    it("starts over when a reorg drops the block the history was read to", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, signer }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                const checkpoint = await provider.send("evm_snapshot", []);
                const dropped = await writeSlot(signer, writer, 1, 6n);
                const held = relay.holdNext(
                    "debug_traceBlockByNumber",
                    toQuantity(dropped.blockNumber)
                );
                const subscription = await client.subscribe([writer]);
                await held.arrived;

                await provider.send("evm_revert", [checkpoint]);
                await writeSlot(signer, writer, 1, 7n);
                held.release();
                const snapshot = await client.nextSnapshot(subscription);

                expect(snapshot.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(7n)
                });
            }
        );
    });
});

describe("StorageDiffService backfill beyond the window", function () {
    it("reads on, in more rounds, the blocks mined past the retained window while the history was being traced", async function () {
        await withStorageDiffSession(
            async ({ client, relay, backfills, signer }) => {
                const writer = await deploySlotWriter(signer);
                const first = await writeSlot(signer, writer, 1, 5n);
                const held = relay.holdNext(
                    "debug_traceBlockByNumber",
                    toQuantity(first.blockNumber)
                );
                const subscription = await client.subscribe([writer]);
                await held.arrived;

                await writeSlot(signer, writer, 1, 6n);
                for (let i = 0; i < 4; i++)
                    await writeSlot(signer, writer, 2, BigInt(i + 1));
                held.release();
                const snapshot = await client.nextSnapshot(subscription);

                expect(
                    nonZero(snapshot.accounts[writer].storage)
                ).to.deep.equal({
                    [slotKey(1)]: storageWord(6n),
                    [slotKey(2)]: storageWord(4n)
                });
                // the first round traced only the deploy block and the first write
                expect(backfills[0].traces).to.be.greaterThan(2);
            },
            { retention: 2 }
        );
    });
});

describe("StorageDiffService deploy block search", function () {
    // Mutation: hasCode treats every error answer as "no code", or none.
    it("finds the deploy block when the upstream answers that reads below its contracts pallet are not supported", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, backfills, signer }) => {
                const { writer, deployed } = await deployedAfter(
                    provider,
                    signer,
                    20
                );
                // Asset Hub's answer below the block its contracts pallet arrived at,
                // here the deploy block: every probe below it gets this answer
                relay.tamper("eth_getCode", (result, params) => {
                    const block = probedBlock(params);
                    return block !== undefined && block < deployed
                        ? new UpstreamErrorAnswer({
                              code: -32603,
                              message:
                                  "The `eth_block` runtime API method is not supported at the queried block"
                          })
                        : result;
                });

                const subscription = await client.subscribe([writer]);
                const snapshot = await client.nextSnapshot(subscription);

                expect(backfills[0].deployBlock).to.equal(toQuantity(deployed));
                expect(
                    nonZero(snapshot.accounts[writer].storage)
                ).to.deep.equal({
                    [slotKey(1)]: storageWord(5n),
                    [slotKey(2)]: storageWord(6n)
                });
            }
        );
    });

    // Mutation: an error answer at a probe at or above the deploy block reads as "no code".
    it("starts the backfill over, and keeps the deploy block, when a code probe below the head is answered with another error", async function () {
        await withStorageDiffSession(
            async ({
                client,
                provider,
                relay,
                backfills,
                signer,
                warnings
            }) => {
                const { writer, deployed, head } = await deployedAfter(
                    provider,
                    signer,
                    20
                );
                let faulted = false;
                relay.tamper("eth_getCode", (result, params) => {
                    const block = probedBlock(params);
                    if (
                        faulted ||
                        block === undefined ||
                        block < deployed ||
                        block >= head
                    )
                        return result;
                    faulted = true;
                    return UPSTREAM_FAULT;
                });

                const subscription = await client.subscribe([writer]);
                await client.nextSnapshot(subscription);

                expect(faulted).to.equal(true);
                expect(backfills[0].deployBlock).to.equal(toQuantity(deployed));
                expect(
                    warnings.some(({ message }) =>
                        message.includes("Backfill failed")
                    )
                ).to.equal(false);
            }
        );
    });

    // Mutation: a failed probe at the head reads as an account without code.
    it("does not take an error answer to the code probe at the head for an account without code", async function () {
        await withStorageDiffSession(
            async ({ client, provider, relay, backfills, signer }) => {
                const { writer, deployed, head } = await deployedAfter(
                    provider,
                    signer,
                    3
                );
                let faulted = false;
                relay.tamper("eth_getCode", (result, params) => {
                    if (faulted || probedBlock(params) !== head) return result;
                    faulted = true;
                    return UPSTREAM_FAULT;
                });

                const subscription = await client.subscribe([writer]);
                const snapshot = await client.nextSnapshot(subscription);

                expect(faulted).to.equal(true);
                expect(backfills[0].deployBlock).to.equal(toQuantity(deployed));
                expect(
                    nonZero(snapshot.accounts[writer].storage)
                ).to.deep.equal({
                    [slotKey(1)]: storageWord(5n),
                    [slotKey(2)]: storageWord(6n)
                });
            }
        );
    });
});

describe("StorageDiffService backfill values", function () {
    // Mutation: backfill reads bypass the state read limit, or one backfill traces every listed block at once.
    it("keeps a backfill's value reads within 16 at the upstream at once and its traces within 8", async function () {
        await withStorageDiffSession(
            async ({ client, relay, backfills, signer }) => {
                const writer = await deploySlotWriter(signer);
                for (let slot = 1; slot <= 40; slot++)
                    await writeSlot(signer, writer, slot, BigInt(slot));

                const subscription = await client.subscribe([writer]);
                const snapshot = await client.nextSnapshot(subscription);

                expect(
                    Object.keys(nonZero(snapshot.accounts[writer].storage))
                ).to.have.length(40);
                // the deploy block and the 40 writes
                expect(backfills[0].traces).to.equal(41);
                expect(relay.maxInFlight("eth_getStorageAt")).to.be.within(
                    2,
                    16
                );
                expect(
                    relay.maxInFlight("debug_traceBlockByNumber")
                ).to.be.at.most(8);
            }
        );
    });

    // Mutation: peer reads wait behind a backfill's in arrival order.
    it("serves a peer's state read ahead of the backfill reads waiting for the upstream", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writer = await deploySlotWriter(signer);
            for (let slot = 1; slot <= 40; slot++)
                await writeSlot(signer, writer, slot, BigInt(slot));
            const sender = (await signer.getAddress()).toLowerCase();
            const head = (await client.request("scp_getHead", [])) as {
                hash: string;
            };
            const held = relay.holdAll("eth_getStorageAt");
            await client.subscribe([writer]);
            // 16 value reads of the backfill at the upstream, the rest waiting
            while (relay.requestCount("eth_getStorageAt") < 16) await sleep(20);
            await sleep(100);

            const read = client.getState(head.hash, [
                { address: sender, account: true }
            ]);
            await sleep(100);
            held.release();
            await read;

            const arrivals = relay.arrivals();
            const peerRead = arrivals.findIndex(
                ({ method, params }) =>
                    method === "eth_getBalance" && params[0] === sender
            );
            expect(peerRead).to.be.greaterThan(-1);
            // the held 16, then the peer's read at the first free place
            expect(
                arrivals
                    .slice(0, peerRead)
                    .filter(({ method }) => method === "eth_getStorageAt")
            ).to.have.length.at.most(18);
        });
    });

    // Mutation: every subscribed account is backfilled at once.
    it("backfills at most two accounts at once and the next once one is done", async function () {
        await withStorageDiffSession(async ({ client, relay, signer }) => {
            const writers: string[] = [];
            for (let i = 0; i < 3; i++) {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, BigInt(i + 1));
                writers.push(writer);
            }
            const held = relay.holdAll("debug_traceBlockByNumber");

            const subscription = await client.subscribe(writers);
            // two backfills reach their traces; the third waits
            while (relay.requestCount("debug_traceBlockByNumber") < 2)
                await sleep(20);
            await sleep(300);
            const probed = new Set(
                relay
                    .paramsOf("eth_getCode")
                    .map((params) => String(params[0]).toLowerCase())
            );
            held.release();
            const snapshotted = new Set<string>();
            while (snapshotted.size < writers.length)
                for (const address of Object.keys(
                    (await client.nextSnapshot(subscription)).accounts
                ))
                    snapshotted.add(address);

            expect(
                writers.filter((writer) => probed.has(writer))
            ).to.have.length(2);
            expect([...snapshotted]).to.have.members(writers);
        });
    });

    // Mutation: a failed trace starts the whole backfill over.
    it("asks a failed trace again on its own, without starting the backfill over", async function () {
        await withStorageDiffSession(
            async ({ client, relay, backfills, signer, warnings }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                await writeSlot(signer, writer, 2, 6n);
                const codeReads = relay.requestCount("eth_getCode");
                const traces = relay.requestCount("debug_traceBlockByNumber");
                relay.failNext("debug_traceBlockByNumber", 1);

                const subscription = await client.subscribe([writer]);
                const snapshot = await client.nextSnapshot(subscription);

                expect(
                    nonZero(snapshot.accounts[writer].storage)
                ).to.deep.equal({
                    [slotKey(1)]: storageWord(5n),
                    [slotKey(2)]: storageWord(6n)
                });
                const [cost] = backfills;
                // the deploy block and the two writes, one of them asked twice
                expect(
                    relay.requestCount("debug_traceBlockByNumber") - traces
                ).to.equal(cost.traces + 1);
                // the code probes once, and the code read of the final values
                expect(relay.requestCount("eth_getCode") - codeReads).to.equal(
                    cost.codeProbes + 1
                );
                expect(
                    warnings.some(({ message }) =>
                        message.includes("Retrying a backfill read")
                    )
                ).to.equal(true);
            }
        );
    });

    // Mutation: the backfill parses its own reads without the service's checks.
    it("fails the backfill, and reads the account lazily, when a storage word it reads is malformed", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer, warnings }) => {
                const writer = await deploySlotWriter(signer);
                await writeSlot(signer, writer, 1, 5n);
                relay.tamper("eth_getStorageAt", () => null);

                const subscription = await client.subscribe([writer]);
                const notice = await client.nextSnapshot(subscription);

                expect(notice.lazy).to.deep.equal([writer]);
                const warning = warnings.find(({ message }) =>
                    message.includes("Backfill failed")
                );
                expect(warning?.meta[0]).to.deep.include({
                    address: writer,
                    reason: "Malformed storage word from upstream"
                });
            }
        );
    });
});
