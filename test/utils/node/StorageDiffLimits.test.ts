import {
    StorageDiffClient,
    StorageDiffRpcError
} from "../../fixtures/node/StorageDiffClient";
import {
    asksCallFrames,
    deployNumberStorage,
    deploySlotWriter,
    recordKey,
    setValue,
    slotKey,
    storageWord,
    VALUE_SLOT,
    withFailedFrames,
    writeSlot
} from "../../fixtures/node/StorageDiffContracts";
import {
    fieldReads,
    rejectionOf,
    withStorageDiffSession,
    withStorageDiffUpstream
} from "../../fixtures/node/StorageDiffSession";
import { UPSTREAM_FAULT } from "../../fixtures/node/UpstreamRelay";
import {
    INVALID_PARAMS,
    LIMIT_EXCEEDED_ERROR_CODE,
    type BlockEnvironment
} from "@/utils/node/storageDiff/blockStorageDiff";
import {
    SEND_BUFFER_OVERFLOW,
    SEND_BUFFER_OVERFLOW_CLOSE_CODE
} from "@/utils/node/storageDiff/PeerHub";
import { expect } from "chai";

const SLOT = { slots: [VALUE_SLOT] };
const X = "0x" + "11".repeat(20);
const Y = "0x" + "22".repeat(20);
const Z = "0x" + "33".repeat(20);
/** How long a cut that does not come is waited for. */
const CUT_WAIT_MS = 10_000;

/** The code of the service's error answer to `request`; undefined when it was answered. */
async function errorCodeOf(
    request: Promise<unknown>
): Promise<number | undefined> {
    const error = await rejectionOf(request);
    return error instanceof StorageDiffRpcError ? error.code : undefined;
}

/** Runs `attempt` until it succeeds: the service sees a close a moment after the client. */
async function eventually<T>(attempt: () => Promise<T>): Promise<T> {
    for (let tries = 1; ; tries++) {
        try {
            return await attempt();
        } catch (error) {
            if (tries >= 100) throw error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
}

async function headOf(client: StorageDiffClient): Promise<BlockEnvironment> {
    return (await client.request("scp_getHead", [])) as BlockEnvironment;
}

describe("StorageDiffService limits", function () {
    // Mutation: the first-watched account dropped instead of the least
    // recently used -> b is read again; a dropped account's cached value
    // kept -> a is not read again.
    it("drops the least recently used account nobody holds past the watched limit and reads it again when asked", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer }) => {
                const [a, b, c] = await Promise.all(
                    [
                        await deployNumberStorage(signer),
                        await deployNumberStorage(signer),
                        await deployNumberStorage(signer)
                    ].map(recordKey)
                );
                const { hash } = await headOf(client);
                const before = fieldReads(relay);
                const reads: number[] = [];

                for (const address of [a, b, c, b, a, b, c]) {
                    await client.getState(hash, [{ address, ...SLOT }]);
                    reads.push(fieldReads(relay) - before);
                }

                expect(reads).to.deep.equal([1, 2, 3, 3, 4, 4, 5]);
            },
            { maxWatchedAddresses: 2 }
        );
    });

    // Mutation: a dropped account's cached values kept -> the value from
    // before the write of a block it was not watched in.
    it("answers a dropped account's slot with the write of a block with a failed frame mined while it was not watched", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer }) => {
                // a failed frame in every block: only watched accounts get values
                relay.tamper("debug_traceBlockByNumber", (result, params) =>
                    asksCallFrames(params) ? withFailedFrames(result) : result
                );
                const writer = await deploySlotWriter(signer);
                const other = await deploySlotWriter(signer);
                const witness = await client.subscribe([]);
                const first = await writeSlot(signer, writer, 1, 5n);
                await client.recordAt(witness, first.blockNumber);
                await client.getState(first.blockHash, [
                    { address: writer, slots: [slotKey(1)] }
                ]);
                await client.getState(first.blockHash, [
                    { address: other, slots: [slotKey(1)] }
                ]);

                const second = await writeSlot(signer, writer, 1, 7n);
                await client.recordAt(witness, second.blockNumber);
                const state = await client.getState(second.blockHash, [
                    { address: writer, slots: [slotKey(1)] }
                ]);

                expect(state.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(7n)
                });
            },
            { maxWatchedAddresses: 1 }
        );
    });

    // Mutation: a fetch that ends after its account was dropped keeps its
    // value -> the value from before the write of a block the account was
    // not watched in.
    it("keeps no value of a fetch that ended after its account was dropped", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer }) => {
                relay.tamper("debug_traceBlockByNumber", (result, params) =>
                    asksCallFrames(params) ? withFailedFrames(result) : result
                );
                const writer = await deploySlotWriter(signer);
                const other = await deploySlotWriter(signer);
                const witness = await client.subscribe([]);
                const first = await writeSlot(signer, writer, 1, 5n);
                await client.recordAt(witness, first.blockNumber);
                // the writer's history is filled, so the held read is the fetch
                await client.getState(first.blockHash, [
                    { address: writer, slots: [slotKey(2)] }
                ]);
                const held = relay.holdNext("eth_getStorageAt", writer);
                // the balance read fails for good, so the read ends while the slot is held
                relay.tamper("eth_getBalance", () => UPSTREAM_FAULT);
                const failed = rejectionOf(
                    client.getState(first.blockHash, [
                        { address: writer, slots: [slotKey(1)], account: true }
                    ])
                );
                await held.arrived;
                await failed;
                relay.tamper("eth_getBalance", (result) => result);
                await client.getState(first.blockHash, [
                    { address: other, slots: [slotKey(1)] }
                ]);
                const second = await writeSlot(signer, writer, 1, 7n);
                await client.recordAt(witness, second.blockNumber);

                const asked = relay.requestCount("eth_getStorageAt");
                held.release();
                await eventually(async () => {
                    if (relay.answerCount("eth_getStorageAt") < asked)
                        throw new Error("The held read has not been answered");
                });
                const state = await client.getState(second.blockHash, [
                    { address: writer, slots: [slotKey(1)] }
                ]);

                expect(state.accounts[writer].storage).to.deep.equal({
                    [slotKey(1)]: storageWord(7n)
                });
            },
            { maxWatchedAddresses: 1 }
        );
    });

    it("refuses a state read of a new account with the limit error while every watched account is subscribed, and keeps the connection", async function () {
        await withStorageDiffSession(
            async ({ client, signer }) => {
                const a = await recordKey(await deployNumberStorage(signer));
                const b = await recordKey(await deployNumberStorage(signer));
                await client.subscribe([a]);
                const { hash } = await headOf(client);

                const code = await errorCodeOf(
                    client.getState(hash, [{ address: b, ...SLOT }])
                );
                const held = await client.getState(hash, [
                    { address: a, ...SLOT }
                ]);

                expect(code).to.equal(LIMIT_EXCEEDED_ERROR_CODE);
                expect(held.accounts[a].storage).to.have.key(VALUE_SLOT);
            },
            { maxWatchedAddresses: 1 }
        );
    });

    it("watches a new account once the subscription that held the last one is unsubscribed", async function () {
        await withStorageDiffSession(
            async ({ client, signer }) => {
                const a = await recordKey(await deployNumberStorage(signer));
                const b = await recordKey(await deployNumberStorage(signer));
                const subscription = await client.subscribe([a]);
                const { hash } = await headOf(client);

                await client.unsubscribe(subscription);
                const state = await client.getState(hash, [
                    { address: b, ...SLOT }
                ]);

                expect(state.accounts[b].storage).to.have.key(VALUE_SLOT);
            },
            { maxWatchedAddresses: 1 }
        );
    });

    // Mutation: a closed connection's subscriptions keep holding -> b stays refused.
    it("watches a new account once the connection whose subscription held the last one closed", async function () {
        await withStorageDiffSession(
            async ({ client, service, signer }) => {
                const a = await recordKey(await deployNumberStorage(signer));
                const b = await recordKey(await deployNumberStorage(signer));
                const other = await StorageDiffClient.connect(service.url);
                await other.subscribe([a]);
                const { hash } = await headOf(client);

                other.close();
                const state = await eventually(() =>
                    client.getState(hash, [{ address: b, ...SLOT }])
                );

                expect(state.accounts[b].storage).to.have.key(VALUE_SLOT);
            },
            { maxWatchedAddresses: 1 }
        );
    });

    it("refuses a subscription past the connection's subscription limit with the limit error and takes one again after an unsubscribe", async function () {
        await withStorageDiffSession(
            async ({ client }) => {
                const first = await client.subscribe([]);
                await client.subscribe([]);

                const code = await errorCodeOf(client.subscribe([]));
                await client.unsubscribe(first);
                const again = await client.subscribe([]);

                expect(code).to.equal(LIMIT_EXCEEDED_ERROR_CODE);
                expect(again).to.be.a("string");
            },
            { maxSubscriptionsPerConnection: 2 }
        );
    });

    it("refuses a subscription naming more addresses than the request limit with invalid params and takes one at the limit", async function () {
        await withStorageDiffSession(
            async ({ client }) => {
                const code = await errorCodeOf(client.subscribe([X, Y, Z]));
                const atLimit = await client.subscribe([X, Y]);

                expect(code).to.equal(INVALID_PARAMS);
                expect(atLimit).to.be.a("string");
            },
            { maxAddressesPerRequest: 2 }
        );
    });

    it("refuses a catch-up naming more addresses than the request limit with invalid params", async function () {
        await withStorageDiffSession(
            async ({ client }) => {
                const code = await errorCodeOf(client.catchUp([X, Y, Z], 0));

                expect(code).to.equal(INVALID_PARAMS);
            },
            { maxAddressesPerRequest: 2 }
        );
    });

    it("refuses a state read naming more accounts than the request limit with invalid params", async function () {
        await withStorageDiffSession(
            async ({ client }) => {
                const { hash } = await headOf(client);

                const code = await errorCodeOf(
                    client.getState(hash, [
                        { address: X },
                        { address: Y },
                        { address: Z }
                    ])
                );

                expect(code).to.equal(INVALID_PARAMS);
            },
            { maxAddressesPerRequest: 2 }
        );
    });

    it("refuses a connection past the connection limit at the upgrade and admits one after a connection closed", async function () {
        await withStorageDiffSession(
            async ({ client, service }) => {
                const refused = await rejectionOf(
                    StorageDiffClient.connect(service.url)
                );
                client.close();
                const admitted = await eventually(() =>
                    StorageDiffClient.connect(service.url)
                );
                try {
                    expect((refused as Error).message).to.include("503");
                    expect(await headOf(admitted)).to.have.property("hash");
                } finally {
                    admitted.close();
                }
            },
            { maxConnections: 1 }
        );
    });

    it("answers a request past the connection's in-flight limit with the limit error and keeps the connection", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer }) => {
                const a = await recordKey(await deployNumberStorage(signer));
                const { hash } = await headOf(client);
                const held = relay.holdNext("eth_getStorageAt", a);
                const slow = client.getState(hash, [{ address: a, ...SLOT }]);
                await held.arrived;

                const code = await errorCodeOf(headOf(client));
                held.release();
                await slow;
                const head = await headOf(client);

                expect(code).to.equal(LIMIT_EXCEEDED_ERROR_CODE);
                expect(head.hash).to.equal(hash);
            },
            { maxInFlightRequests: 1 }
        );
    });

    it("refuses a browser origin that is not allowed at the upgrade", async function () {
        await withStorageDiffSession(async ({ service }) => {
            const refused = await rejectionOf(
                StorageDiffClient.connect(service.url, {
                    origin: "https://app.example"
                })
            );

            expect((refused as Error).message).to.include("403");
        });
    });

    it("admits a browser origin on the allowed list", async function () {
        await withStorageDiffSession(
            async ({ service }) => {
                const page = await StorageDiffClient.connect(service.url, {
                    origin: "https://app.example"
                });
                try {
                    expect(await headOf(page)).to.have.property("hash");
                } finally {
                    page.close();
                }
            },
            { allowedOrigins: ["https://app.example"] }
        );
    });

    it("answers scp_getHead sent without params", async function () {
        await withStorageDiffSession(async ({ client }) => {
            const head = (await client.requestWithoutParams(
                "scp_getHead"
            )) as BlockEnvironment;

            expect(head.hash).to.equal((await headOf(client)).hash);
        });
    });

    // Mutation: answers not checked against the buffer limit -> the peer
    // reads every answer and stays connected.
    it("cuts a peer that does not read its answers once its unsent bytes pass the limit", async function () {
        const limitBytes = 64 * 1024;
        await withStorageDiffSession(
            async ({ client, provider, service }) => {
                await provider.send("anvil_mine", [127]);
                const lagging = await StorageDiffClient.connect(service.url);
                try {
                    lagging.pause();
                    for (let i = 0; i < 500; i++)
                        lagging.catchUp([], 0).catch(() => undefined);
                    // queued behind the lagging peer's catch-ups
                    await client.catchUp([], 0);
                    lagging.resume();

                    const closedBy = await Promise.race([
                        lagging.closedBy(),
                        new Promise((resolve) =>
                            setTimeout(() => resolve("not cut"), CUT_WAIT_MS)
                        )
                    ]);
                    expect(closedBy).to.deep.equal({
                        code: SEND_BUFFER_OVERFLOW_CLOSE_CODE,
                        reason: SEND_BUFFER_OVERFLOW
                    });
                    expect(lagging.notices()[0]).to.include({
                        reason: SEND_BUFFER_OVERFLOW,
                        limitBytes
                    });
                } finally {
                    lagging.close();
                }
            },
            { maxPeerBufferedBytes: limitBytes, maxInFlightRequests: 1000 }
        );
    });

    // Mutation: every block of the outage traced -> twice the traces.
    it("traces only the blocks that stay retained after an outage longer than the window, and pushes them", async function () {
        await withStorageDiffSession(
            async ({ client, relay, signer }) => {
                const storage = await deployNumberStorage(signer);
                const address = await recordKey(storage);
                const subscription = await client.subscribe([address]);
                const before = await setValue(storage, 1n);
                await client.recordAt(subscription, before.blockNumber);
                const traces = relay.requestCount("debug_traceBlockByNumber");

                relay.refuseConnections(true);
                relay.disconnect();
                let last = before;
                for (let value = 2n; value <= 7n; value++)
                    last = await setValue(storage, value);
                relay.refuseConnections(false);
                const first = await client.nextRecord(subscription);
                const newest = await client.recordAt(
                    subscription,
                    last.blockNumber
                );

                expect(Number(first.number)).to.equal(last.blockNumber - 2);
                expect(newest.post[address].storage).to.deep.equal({
                    [VALUE_SLOT]: storageWord(7n)
                });
                // a prestate and a call trace for each of the 3 retained blocks
                expect(
                    relay.requestCount("debug_traceBlockByNumber") - traces
                ).to.equal(6);
            },
            { retention: 3 }
        );
    });

    it("refuses to start with a limit that is not a positive integer", async function () {
        await withStorageDiffUpstream(async ({ start }) => {
            const failure = await rejectionOf(start({ maxConnections: 0 }));

            expect((failure as Error).message).to.equal(
                "maxConnections must be a positive integer"
            );
        });
    });
});
