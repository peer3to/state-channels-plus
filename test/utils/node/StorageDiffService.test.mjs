import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".."
);
const requireRepo = createRequire(path.join(root, "package.json"));
process.env.TS_NODE_PROJECT = path.join(root, "tsconfig.json");
requireRepo("ts-node/register");
const WebSocket = requireRepo("ws");
const { getCreateAddress } = requireRepo("ethers");
const {
    startStorageDiffService,
    mergeTransactionDiffs,
    ZERO_WORD,
    PRUNED_ERROR_CODE
} = requireRepo("./src/utils/node/StorageDiffService.ts");

const CLI = path.join(root, "scripts", "infra", "storage-diff-service.js");
const TRACE_OPTIONS = {
    tracer: "prestateTracer",
    tracerConfig: { diffMode: true }
};
// Runtime: SSTORE(calldata[0:32], calldata[32:64]).
const STORE_CODE = "0x6008600c60003960086000f36020356000355500";
// Runtime: for i = calldata[0:32] down to 1, SSTORE(i, i).
const FILL_CODE =
    "0x6015600c60003960156000f3600035" + "5b8015601357808055600190036003565b00";

const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** `promise`, or a rejection naming `what` when it has not settled in time. */
const bounded = (promise, what, ms = 15000) =>
    Promise.race([
        promise,
        sleep(ms).then(() =>
            Promise.reject(new Error(`still pending: ${what}`))
        )
    ]);

async function until(check, what, ms = 20000) {
    const deadline = Date.now() + ms;
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
        await sleep(10);
    }
}

// ---------------------------------------------------------------------------
// Owned anvil: one isolated node for the whole file.
// ---------------------------------------------------------------------------

let anvil;
let node;
let account;

before(async () => {
    anvil = spawn(process.env.ANVIL_BIN || "anvil", [
        "--host",
        "127.0.0.1",
        "--port",
        "0"
    ]);
    let output = "";
    anvil.stdout.on("data", (chunk) => (output += chunk));
    anvil.stderr.on("data", (chunk) => (output += chunk));
    anvil.on("error", (error) => (output += String(error)));
    const endpoint = await until(
        () => output.match(/Listening on (127\.0\.0\.1:\d+)/)?.[1],
        `anvil to listen; output=${output}`
    );
    node = { http: `http://${endpoint}`, ws: `ws://${endpoint}` };
    [account] = (await rpc("eth_accounts")).map((a) => a.toLowerCase());
});

after(async () => {
    if (!anvil || anvil.exitCode !== null) return;
    anvil.kill("SIGTERM");
    await Promise.race([once(anvil, "exit"), sleep(3000)]);
    if (anvil.exitCode === null) anvil.kill("SIGKILL");
});

let rpcId = 0;
async function rpc(method, params = []) {
    const response = await fetch(node.http, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params })
    });
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
}

async function receiptOf(hash) {
    const receipt = await until(
        () => rpc("eth_getTransactionReceipt", [hash]),
        "receipt"
    );
    assert.equal(receipt.status, "0x1", "real transaction mined");
    return receipt;
}

const submit = (data, to, gas = "0x200000") =>
    rpc("eth_sendTransaction", [
        { from: account, ...(to ? { to } : {}), data, gas }
    ]);
const head = () => rpc("eth_getBlockByNumber", ["latest", false]);

async function deploy(code = STORE_CODE) {
    const receipt = await receiptOf(await submit(code));
    return receipt.contractAddress.toLowerCase();
}

const storeData = (key, value) => word(key) + word(value).slice(2);
const writeTx = (to, key, value) => submit(storeData(key, value), to);
const write = async (to, key, value) =>
    receiptOf(await writeTx(to, key, value));

/** Several transactions in one block: automine off, mine once, automine on. */
async function mineTogether(sends) {
    await rpc("evm_setAutomine", [false]);
    try {
        const hashes = [];
        for (const send of sends) hashes.push(await send());
        await rpc("evm_mine");
        return Promise.all(hashes.map(receiptOf));
    } finally {
        await rpc("evm_setAutomine", [true]);
    }
}
const writeBlock = (writes) =>
    mineTogether(
        writes.map(
            ([to, key, value]) =>
                () =>
                    writeTx(to, key, value)
        )
    );

// ---------------------------------------------------------------------------
// Observational relay: forwards real traffic unchanged, records requests, and
// can hold or replay messages. It never fabricates a result.
// ---------------------------------------------------------------------------

async function startRelay() {
    const relay = {
        requests: [],
        heads: [],
        live: new Set(),
        duplicateHeads: false,
        holdingHeads: false,
        heldHeads: [],
        holds: new Map()
    };
    const server = new WebSocket.WebSocketServer({
        host: "127.0.0.1",
        port: 0
    });
    await once(server, "listening");
    server.on("connection", (client) => {
        const upstream = new WebSocket(node.ws);
        const ready = once(upstream, "open");
        relay.live.add(client);
        const forward = (text) => ready.then(() => upstream.send(text));
        client.on("message", (data) => {
            const text = data.toString();
            const message = JSON.parse(text);
            relay.requests.push({
                method: message.method,
                params: message.params
            });
            const hold = relay.holds.get(message.method);
            if (hold) {
                hold.queued.push(() => forward(text));
                hold.arrived.resolve();
            } else {
                forward(text);
            }
        });
        upstream.on("message", (data) => {
            const text = data.toString();
            if (JSON.parse(text).method === "eth_subscription") {
                relay.heads.push(text);
                if (relay.holdingHeads) return void relay.heldHeads.push(text);
                if (relay.duplicateHeads) client.send(text);
            }
            if (client.readyState === WebSocket.OPEN) client.send(text);
        });
        const drop = () => {
            relay.live.delete(client);
            client.terminate();
            upstream.terminate();
        };
        client.on("close", drop);
        client.on("error", drop);
        upstream.on("close", drop);
        upstream.on("error", drop);
    });
    relay.url = `ws://127.0.0.1:${server.address().port}`;
    relay.traces = () =>
        relay.requests.filter((r) => r.method === "debug_traceBlockByNumber");
    relay.latestQueries = () =>
        relay.requests.filter(
            (r) =>
                r.method === "eth_getBlockByNumber" && r.params[0] === "latest"
        );
    relay.holdHeadNotifications = () => (relay.holdingHeads = true);
    relay.releaseHeadNotifications = () => {
        relay.holdingHeads = false;
        for (const text of relay.heldHeads.splice(0)) {
            for (const client of relay.live) client.send(text);
        }
    };
    /** Delivers the newest head notification again: a real, late wake-up. */
    relay.redeliverHead = () => {
        for (const client of relay.live) client.send(relay.heads.at(-1));
    };
    relay.hold = (method) => {
        let resolve;
        const arrived = new Promise((r) => (resolve = r));
        const hold = { queued: [], arrived: { resolve } };
        relay.holds.set(method, hold);
        return {
            arrived,
            release: () => {
                relay.holds.delete(method);
                for (const forward of hold.queued.splice(0)) forward();
            }
        };
    };
    relay.dropAll = () => {
        for (const client of relay.live) client.terminate();
    };
    relay.close = async () => {
        relay.dropAll();
        await new Promise((resolve) => server.close(resolve));
    };
    return relay;
}

// ---------------------------------------------------------------------------
// Service clients
// ---------------------------------------------------------------------------

let requestSeq = 1000;

async function connect(url) {
    const socket = new WebSocket(url);
    const inbox = [];
    socket.on("message", (data) => inbox.push(JSON.parse(data.toString())));
    socket.on("error", () => {});
    await once(socket, "open");
    const client = {
        socket,
        inbox,
        closed: new Promise((resolve) => socket.on("close", resolve)),
        raw: (text) => socket.send(text),
        async call(method, params, id = ++requestSeq) {
            socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
            return until(
                () => inbox.find((m) => m.id === id),
                `reply to ${method}`
            );
        },
        async subscribe(addresses) {
            const reply = await client.call("scp_subscribeContractStorage", [
                addresses
            ]);
            assert.equal(typeof reply.result, "string", JSON.stringify(reply));
            return reply.result;
        },
        async history(addresses, from) {
            const reply = await client.call("scp_getContractStorageDiffs", [
                addresses,
                from
            ]);
            assert.ok(!reply.error, JSON.stringify(reply));
            return reply.result;
        },
        records: (subscription) =>
            inbox
                .filter(
                    (m) =>
                        m.method === "scp_subscription" &&
                        (!subscription ||
                            m.params.subscription === subscription)
                )
                .map((m) => m.params.result),
        waitFor: (hash, what = hash) =>
            until(
                () => client.records().find((r) => r.hash === hash),
                `push ${what}`
            )
    };
    return client;
}

async function harness(t, { retention = 3 } = {}) {
    const relay = await startRelay();
    t.after(() => relay.close());
    const service = await startStorageDiffService({
        upstreamUrl: relay.url,
        port: 0,
        retention
    });
    t.after(() => service.close());
    const clients = [];
    return {
        relay,
        service,
        async connect() {
            const client = await connect(service.url);
            t.after(() => client.socket.terminate());
            clients.push(client);
            return client;
        }
    };
}

const slot = (record, side, address, key = 0) =>
    record[side][address]?.storage?.[word(key)];

// ---------------------------------------------------------------------------
// SD1-SD3: live write sets
// ---------------------------------------------------------------------------

test("SD1: every subscriber gets one address-filtered record per block, traced exactly once", async (t) => {
    const a = await deploy();
    const b = await deploy();
    await write(a, 0, 7);
    const { relay, connect: open } = await harness(t);
    const [c1, c2, c3, c4] = [
        await open(),
        await open(),
        await open(),
        await open()
    ];
    const mixedCase = "0x" + a.slice(2).toUpperCase();
    await c1.subscribe([a]);
    await c2.subscribe([mixedCase, b, a]);
    await c3.subscribe([b]);
    await c4.subscribe([]);

    const receipt = await write(a, 0, 42);
    const header = await rpc("eth_getBlockByHash", [receipt.blockHash, false]);
    for (const client of [c1, c2, c3, c4])
        await client.waitFor(receipt.blockHash);

    for (const client of [c1, c2]) {
        const [record] = client.records();
        assert.equal(client.records().length, 1);
        assert.equal(record.number, header.number);
        assert.equal(record.hash, header.hash);
        assert.equal(record.parentHash, header.parentHash);
        assert.equal(slot(record, "pre", a), word(7));
        assert.equal(slot(record, "post", a), word(42));
        assert.deepEqual(Object.keys(record.pre), [a]);
        assert.deepEqual(Object.keys(record.post), [a]);
    }
    for (const client of [c3, c4]) {
        const [record] = client.records();
        assert.equal(client.records().length, 1);
        assert.equal(record.hash, header.hash);
        assert.deepEqual(record.pre, {});
        assert.deepEqual(record.post, {});
    }
    const traces = relay
        .traces()
        .filter((r) => r.params[0] === receipt.blockNumber);
    assert.equal(
        traces.length,
        1,
        "one trace for the block regardless of subscribers"
    );
    assert.deepEqual(traces[0].params[1], TRACE_OPTIONS);
    const traced = relay.traces().map((r) => r.params[0]);
    assert.equal(new Set(traced).size, traced.length, "no block traced twice");
});

test("SD1: mergeTransactionDiffs folds a real multi-transaction block", async (t) => {
    const a = await deploy();
    const b = await deploy();
    await write(a, 0, 7);
    const { connect: open } = await harness(t);
    const client = await open();
    await client.subscribe([a, b]);

    const receipts = await writeBlock([
        [a, 0, 42],
        [a, 0, 5],
        [a, 1, 3],
        [b, 2, 8]
    ]);
    const blockHash = receipts[0].blockHash;
    assert.ok(
        receipts.every((r) => r.blockHash === blockHash),
        "one block"
    );
    const entries = await rpc("debug_traceBlockByNumber", [
        receipts[0].blockNumber,
        TRACE_OPTIONS
    ]);
    assert.equal(entries.length, 4);
    const merged = mergeTransactionDiffs(entries);

    assert.equal(slot(merged, "pre", a, 0), word(7), "earliest pre");
    assert.equal(slot(merged, "post", a, 0), word(5), "latest post");
    assert.equal(slot(merged, "post", a, 1), word(3), "disjoint slot kept");
    assert.equal(slot(merged, "post", b, 2), word(8), "disjoint address kept");
    const first = entries[0].result.pre[account];
    const last = entries[3].result.post[account];
    assert.equal(merged.pre[account].balance, first.balance);
    assert.equal(merged.pre[account].nonce, first.nonce);
    assert.equal(merged.post[account].balance, last.balance);
    assert.equal(merged.post[account].nonce, last.nonce);
    assert.equal(merged.pre[a].code, entries[0].result.pre[a].code);
    assert.equal(merged.pre[a].nonce, entries[0].result.pre[a].nonce);

    const pushed = await client.waitFor(blockHash);
    assert.deepEqual(pushed.pre[a], merged.pre[a]);
    assert.deepEqual(pushed.post[a], merged.post[a]);
    assert.deepEqual(pushed.post[b], merged.post[b]);
});

test("SD1: a slot the tracer leaves out of pre reads as zero across a multi-transaction block", async (t) => {
    const a = await deploy();
    const [, other] = (await rpc("eth_accounts")).map((x) => x.toLowerCase());
    assert.equal(
        await rpc("eth_getTransactionCount", [other, "latest"]),
        "0x0"
    );
    const { connect: open } = await harness(t, { retention: 5 });
    const client = await open();
    await client.subscribe([a, other]);
    const mergedOf = async (receipts) =>
        mergeTransactionDiffs(
            await rpc("debug_traceBlockByNumber", [
                receipts[0].blockNumber,
                TRACE_OPTIONS
            ])
        );

    // Zero before the block, written twice: the block started at zero, not 3.
    const twice = await writeBlock([
        [a, 1, 3],
        [a, 1, 4]
    ]);
    const merged = await mergedOf(twice);
    assert.equal(slot(merged, "pre", a, 1), ZERO_WORD);
    assert.equal(slot(merged, "post", a, 1), word(4));
    const pushed = await client.waitFor(twice[0].blockHash);
    assert.equal(slot(pushed, "pre", a, 1), ZERO_WORD);
    assert.equal(slot(pushed, "post", a, 1), word(4));

    // Zero before the block, written then cleared: zero to zero, not 3 to zero.
    const cleared = await mergedOf(
        await writeBlock([
            [a, 2, 3],
            [a, 2, 0]
        ])
    );
    assert.equal(slot(cleared, "pre", a, 2), ZERO_WORD);
    assert.equal(slot(cleared, "post", a, 2), ZERO_WORD);

    // A nonce of zero is left out of pre as well: the block started at nonce 0.
    const sendFromOther = () =>
        rpc("eth_sendTransaction", [
            { from: other, to: a, value: "0x1", gas: "0x200000" }
        ]);
    const transfers = await mineTogether([sendFromOther, sendFromOther]);
    const nonces = await mergedOf(transfers);
    assert.equal(nonces.pre[other].nonce, 0);
    assert.equal(nonces.post[other].nonce, 2);
    assert.equal(
        (await client.waitFor(transfers[0].blockHash)).pre[other].nonce,
        0
    );
});

test("SD1: an account created earlier in the block has no pre in the merged block", async (t) => {
    const nonce = await rpc("eth_getTransactionCount", [account, "latest"]);
    const created = getCreateAddress({
        from: account,
        nonce: Number(nonce)
    }).toLowerCase();
    const { connect: open } = await harness(t);
    const client = await open();
    await client.subscribe([created]);

    const receipts = await mineTogether([
        () => submit(STORE_CODE),
        () => writeTx(created, 4, 6)
    ]);
    assert.equal(receipts[0].contractAddress.toLowerCase(), created);
    const merged = mergeTransactionDiffs(
        await rpc("debug_traceBlockByNumber", [
            receipts[0].blockNumber,
            TRACE_OPTIONS
        ])
    );
    assert.equal(merged.pre[created], undefined, "it did not exist before");
    assert.equal(slot(merged, "post", created, 4), word(6));
    const pushed = await client.waitFor(receipts[0].blockHash);
    assert.deepEqual(pushed.pre, {});
    assert.equal(slot(pushed, "post", created, 4), word(6));
});

test("RV2-1: a funded address that a deployment then creates reads empty code and nonce zero in pre", async (t) => {
    const nonce = Number(
        await rpc("eth_getTransactionCount", [account, "latest"])
    );
    const target = getCreateAddress({
        from: account,
        nonce: nonce + 1
    }).toLowerCase();
    // Sender transaction `nonce` funds the address, in a block of its own.
    const funding = await receiptOf(
        await rpc("eth_sendTransaction", [
            { from: account, to: target, value: "0x1", gas: "0x200000" }
        ])
    );
    const { connect: open } = await harness(t);
    const client = await open();
    await client.subscribe([target]);

    const receipts = await mineTogether([
        () => submit(STORE_CODE),
        () => writeTx(target, 4, 6)
    ]);
    assert.equal(receipts[0].blockHash, receipts[1].blockHash, "one block");
    assert.ok(BigInt(funding.blockNumber) < BigInt(receipts[0].blockNumber));
    assert.equal(receipts[0].contractAddress.toLowerCase(), target);
    const entries = await rpc("debug_traceBlockByNumber", [
        receipts[0].blockNumber,
        TRACE_OPTIONS
    ]);
    const deployment = entries[0].result;
    assert.ok(deployment.pre[target], "the deployment's pre has the address");
    assert.ok(deployment.post[target], "the deployment's post has the address");
    assert.equal(
        deployment.pre[target].code,
        undefined,
        "the tracer leaves empty code out of pre"
    );
    const merged = mergeTransactionDiffs(entries);
    assert.equal(merged.pre[target].code, "0x");
    assert.equal(merged.pre[target].nonce, 0);

    const pushed = await client.waitFor(receipts[0].blockHash);
    assert.equal(pushed.pre[target].code, "0x");
    assert.equal(pushed.pre[target].nonce, 0);
});

test("SD3: a cleared slot is an explicit full-width zero, in either order within a block", async (t) => {
    const a = await deploy();
    await write(a, 0, 42);
    const { connect: open } = await harness(t, { retention: 5 });
    const client = await open();
    await client.subscribe([a]);

    const clear = await write(a, 0, 0);
    const cleared = await client.waitFor(clear.blockHash);
    assert.equal(slot(cleared, "pre", a), word(42));
    assert.equal(slot(cleared, "post", a), ZERO_WORD);
    assert.equal(ZERO_WORD.length, 66);

    await write(a, 0, 5);
    const [, rewrite] = await writeBlock([
        [a, 0, 0],
        [a, 0, 9]
    ]);
    const clearThenWrite = await client.waitFor(rewrite.blockHash);
    assert.equal(
        slot(clearThenWrite, "pre", a),
        word(5),
        "earliest pre of the block"
    );
    assert.equal(
        slot(clearThenWrite, "post", a),
        word(9),
        "later write wins over the clear"
    );

    const [, clearLast] = await writeBlock([
        [a, 0, 11],
        [a, 0, 0]
    ]);
    const writeThenClear = await client.waitFor(clearLast.blockHash);
    assert.equal(
        slot(writeThenClear, "pre", a),
        word(9),
        "earliest pre of the block"
    );
    assert.equal(slot(writeThenClear, "post", a), ZERO_WORD);
});

test("SD2: empty and unrelated blocks yield ordered headers; repeated, delayed and burst heads add nothing", async (t) => {
    const a = await deploy();
    const b = await deploy();
    const { relay, connect: open } = await harness(t, { retention: 5 });
    const watcher = await open();
    const bystander = await open();
    await watcher.subscribe([a]);
    await bystander.subscribe([]);

    const tracesBefore = relay.traces().length;
    await rpc("evm_mine");
    const empty = await head();
    const other = await write(b, 0, 1);
    for (const client of [watcher, bystander]) {
        await client.waitFor(empty.hash);
        await client.waitFor(other.blockHash);
    }
    assert.equal(
        relay.traces().length,
        tracesBefore + 1,
        "only the nonempty block is traced"
    );
    for (const client of [watcher, bystander]) {
        const [first, second] = client.records();
        assert.equal(first.number, empty.number);
        assert.equal(first.parentHash, empty.parentHash);
        assert.deepEqual(
            [first.pre, first.post, second.pre, second.post],
            [{}, {}, {}, {}]
        );
        assert.equal(second.parentHash, empty.hash);
    }

    relay.duplicateHeads = true;
    await rpc("evm_mine");
    const duplicated = await head();
    await watcher.waitFor(duplicated.hash);
    relay.holdHeadNotifications();
    await rpc("anvil_mine", ["0x3"]);
    relay.releaseHeadNotifications();
    await rpc("evm_mine");
    const last = await head();
    await watcher.waitFor(last.hash);
    await bystander.waitFor(last.hash);

    const numbers = watcher.records().map((r) => BigInt(r.number));
    assert.ok(watcher.records().some((r) => r.hash === duplicated.hash));
    assert.equal(
        numbers.length,
        7,
        "empty, other, duplicated, three burst, last"
    );
    assert.equal(
        new Set(watcher.records().map((r) => r.hash)).size,
        numbers.length,
        "no duplicate"
    );
    numbers.forEach(
        (n, i) =>
            i && assert.equal(n, numbers[i - 1] + 1n, "gaps filled in order")
    );
    assert.deepEqual(
        watcher.records().map((r) => r.hash),
        bystander.records().map((r) => r.hash)
    );
});

// ---------------------------------------------------------------------------
// SD4/SD5: retention and catch-up
// ---------------------------------------------------------------------------

test("SD4/SD5: backfill, catch-up bounds, address normalization and pruning", async (t) => {
    const a = await deploy();
    const b = await deploy();
    const writes = [
        await write(a, 0, 1),
        await write(a, 0, 2),
        await write(a, 0, 3)
    ];
    const tip = BigInt(writes[2].blockNumber);
    const { connect: open } = await harness(t, { retention: 3 });
    const client = await open();

    const history = await client.history([a], writes[0].blockNumber);
    assert.deepEqual(
        history.map((r) => r.hash),
        writes.map((r) => r.blockHash),
        "startup backfill, ascending"
    );
    assert.deepEqual(
        history.map((r) => slot(r, "post", a)),
        [word(1), word(2), word(3)]
    );
    assert.equal(slot(history[1], "pre", a), word(1));
    assert.equal(slot(history[2], "pre", a), word(2));
    assert.equal(
        (await client.history([a], Number(tip))).length,
        1,
        "number form, tip"
    );
    assert.deepEqual(
        await client.history([a], "0x" + (tip + 1n).toString(16)),
        [],
        "future"
    );
    assert.deepEqual(await client.history([a], Number(tip) + 100), []);

    const pruned = await client.call("scp_getContractStorageDiffs", [
        [a],
        Number(tip) - 3
    ]);
    assert.equal(pruned.error.code, PRUNED_ERROR_CODE);
    assert.equal(pruned.error.message, "Requested block has been pruned");

    const upper = "0x" + a.slice(2).toUpperCase();
    const deduped = await client.history([a, upper, a], writes[0].blockNumber);
    assert.deepEqual(Object.keys(deduped[0].post), [a]);
    const none = await client.history([], writes[0].blockNumber);
    assert.equal(none.length, 3);
    assert.ok(
        none.every(
            (r) => !Object.keys(r.pre).length && !Object.keys(r.post).length
        )
    );

    await client.subscribe([a, b]);
    const live = await write(a, 0, 4);
    const pushed = await client.waitFor(live.blockHash);
    assert.deepEqual(
        await client.history([a, b], live.blockNumber),
        [pushed],
        "live equals history"
    );

    const extended = await client.history([a], Number(tip) + 1);
    assert.equal(extended.length, 1);
    const oldOldest = await client.call("scp_getContractStorageDiffs", [
        [a],
        writes[0].blockNumber
    ]);
    assert.equal(
        oldOldest.error.code,
        PRUNED_ERROR_CODE,
        "pruning after extension"
    );
    assert.equal((await client.history([a], writes[1].blockNumber)).length, 3);
});

test("SD4/SD5: retention of one keeps only the head", async (t) => {
    const a = await deploy();
    await write(a, 0, 1);
    const last = await write(a, 0, 2);
    const { connect: open } = await harness(t, { retention: 1 });
    const client = await open();
    const [only, ...rest] = await client.history([a], last.blockNumber);
    assert.equal(rest.length, 0);
    assert.equal(only.hash, last.blockHash);
    const reply = await client.call("scp_getContractStorageDiffs", [
        [a],
        Number(last.blockNumber) - 1
    ]);
    assert.equal(reply.error.code, PRUNED_ERROR_CODE);
    const next = await write(a, 0, 3);
    await until(
        async () => (await client.history([a], next.blockNumber)).length === 1,
        "advance"
    );
    assert.equal(
        (
            await client.call("scp_getContractStorageDiffs", [
                [a],
                last.blockNumber
            ])
        ).error.code,
        PRUNED_ERROR_CODE
    );
});

// ---------------------------------------------------------------------------
// SD6: reorgs, with real snapshot/revert on the owned node
// ---------------------------------------------------------------------------

function assertNoRevertNotifications(client) {
    for (const message of client.inbox.filter((m) => m.id === undefined)) {
        assert.equal(message.method, "scp_subscription");
        assert.deepEqual(Object.keys(message.params.result).sort(), [
            "hash",
            "number",
            "parentHash",
            "post",
            "pre"
        ]);
    }
}

test("SD6: a same-height replacement replaces the orphan without a revert notification", async (t) => {
    const a = await deploy();
    await write(a, 0, 1);
    const { connect: open } = await harness(t, { retention: 5 });
    const client = await open();
    await client.subscribe([a]);
    const base = await head();
    const snapshot = await rpc("evm_snapshot");

    const orphan = await write(a, 0, 10);
    await client.waitFor(orphan.blockHash);
    await rpc("evm_revert", [snapshot]);
    const replacement = await write(a, 0, 20);
    assert.equal(replacement.blockNumber, orphan.blockNumber);
    assert.notEqual(replacement.blockHash, orphan.blockHash);
    const record = await client.waitFor(replacement.blockHash);

    assert.equal(record.parentHash, base.hash);
    assert.equal(slot(record, "post", a), word(20));
    assert.equal(slot(record, "pre", a), word(1));
    assert.deepEqual(
        client.records().map((r) => r.hash),
        [orphan.blockHash, replacement.blockHash]
    );
    assertNoRevertNotifications(client);
    const history = await client.history([a], orphan.blockNumber);
    assert.deepEqual(
        history.map((r) => r.hash),
        [replacement.blockHash],
        "no orphan history"
    );
});

test("SD6: a multi-block replacement is published in order, once, from one reconciliation", async (t) => {
    const a = await deploy();
    await write(a, 0, 1);
    const { relay, connect: open } = await harness(t, { retention: 8 });
    const client = await open();
    await client.subscribe([a]);
    const base = await head();
    const snapshot = await rpc("evm_snapshot");

    const orphans = [await write(a, 0, 10), await write(a, 0, 11)];
    await client.waitFor(orphans[1].blockHash);
    await rpc("evm_revert", [snapshot]);
    relay.holdHeadNotifications();
    const replacements = [
        await write(a, 0, 30),
        await write(a, 0, 31),
        await write(a, 0, 32)
    ];
    relay.releaseHeadNotifications();
    await client.waitFor(replacements[2].blockHash);

    const after = client
        .records()
        .slice(2)
        .map((r) => r.hash);
    assert.deepEqual(
        after,
        replacements.map((r) => r.blockHash)
    );
    assert.equal(
        client.records().find((r) => r.hash === replacements[0].blockHash)
            .parentHash,
        base.hash
    );
    assertNoRevertNotifications(client);
    const history = await client.history([a], base.number);
    assert.deepEqual(
        history.map((r) => r.hash),
        [base.hash, ...replacements.map((r) => r.blockHash)]
    );
});

test("SD6: a rollback to an ancestor drops orphans and publishes nothing", async (t) => {
    const a = await deploy();
    await write(a, 0, 1);
    const { relay, connect: open } = await harness(t, { retention: 5 });
    const client = await open();
    await client.subscribe([a]);
    const base = await head();
    const snapshot = await rpc("evm_snapshot");
    const orphan = await write(a, 0, 10);
    await client.waitFor(orphan.blockHash);

    await rpc("evm_revert", [snapshot]);
    const queriesBefore = relay.latestQueries().length;
    relay.redeliverHead();
    await until(
        () => relay.latestQueries().length > queriesBefore,
        "reconciliation to start"
    );
    const retained = await client.history([a], base.number);

    assert.equal(retained.at(-1).hash, base.hash);
    assert.ok(
        retained.every((r) => r.hash !== orphan.blockHash),
        "orphan removed"
    );
    assert.deepEqual(await client.history([a], orphan.blockNumber), []);
    assert.deepEqual(
        client.records().map((r) => r.hash),
        [orphan.blockHash],
        "nothing published"
    );
});

test("SD6: a common ancestor older than the retained window still publishes the whole replacement", async (t) => {
    const a = await deploy();
    await write(a, 0, 1);
    const ancestor = await write(a, 0, 2);
    const { relay, connect: open } = await harness(t, { retention: 2 });
    const client = await open();
    await client.subscribe([a]);
    const snapshot = await rpc("evm_snapshot");

    const orphans = [await write(a, 0, 10), await write(a, 0, 11)];
    await client.waitFor(orphans[1].blockHash);
    await rpc("evm_revert", [snapshot]);
    relay.holdHeadNotifications();
    const replacements = [
        await write(a, 0, 30),
        await write(a, 0, 31),
        await write(a, 0, 32)
    ];
    relay.releaseHeadNotifications();
    await client.waitFor(replacements[2].blockHash);

    assert.deepEqual(
        client
            .records()
            .slice(2)
            .map((r) => r.hash),
        replacements.map((r) => r.blockHash),
        "all replacement records, though the window holds two"
    );
    assert.equal(client.records()[2].parentHash, ancestor.blockHash);
    const history = await client.history([a], replacements[1].blockNumber);
    assert.deepEqual(
        history.map((r) => r.hash),
        replacements.slice(1).map((r) => r.blockHash)
    );
    const pruned = await client.call("scp_getContractStorageDiffs", [
        [a],
        replacements[0].blockNumber
    ]);
    assert.equal(pruned.error.code, PRUNED_ERROR_CODE);
});

// ---------------------------------------------------------------------------
// T1: protocol surface
// ---------------------------------------------------------------------------

test("T1: malformed requests get typed errors and never stop the service", async (t) => {
    const a = await deploy();
    const { connect: open } = await harness(t);
    const client = await open();
    const errorFor = async (payload, expectedId = null) => {
        client.raw(
            typeof payload === "string" ? payload : JSON.stringify(payload)
        );
        const message = await until(
            () =>
                client.inbox.find(
                    (m) =>
                        m.id === expectedId &&
                        m.error &&
                        !m.seen &&
                        (m.seen = true)
                ),
            `error reply to ${JSON.stringify(payload)}`
        );
        return message.error.code;
    };

    assert.equal(await errorFor("{not json"), -32700);
    assert.equal(await errorFor("null"), -32600);
    assert.equal(await errorFor("[]"), -32600);
    assert.equal(
        await errorFor([
            { jsonrpc: "2.0", id: 1, method: "scp_getContractStorageDiffs" }
        ]),
        -32600
    );
    assert.equal(await errorFor({ id: 1, method: "x" }), -32600);
    assert.equal(
        await errorFor({ jsonrpc: "2.0", id: { a: 1 }, method: "x" }),
        -32600
    );
    assert.equal(await errorFor({ jsonrpc: "2.0", id: 2, method: 7 }), -32600);
    assert.equal(
        await errorFor({ jsonrpc: "2.0", id: "s-1", method: "nope" }, "s-1"),
        -32601
    );
    for (const method of [
        "__proto__",
        "constructor",
        "toString",
        "hasOwnProperty",
        "close"
    ]) {
        assert.equal(
            await errorFor({ jsonrpc: "2.0", id: method, method }, method),
            -32601
        );
    }

    const subscribe = "scp_subscribeContractStorage";
    const diffs = "scp_getContractStorageDiffs";
    const badParams = [
        [subscribe, undefined],
        [subscribe, {}],
        [subscribe, []],
        [subscribe, [a]],
        [subscribe, [[a], 1]],
        [subscribe, [["0x1234"]]],
        [subscribe, [[a.slice(0, -1) + "g"]]],
        [subscribe, [[5]]],
        [diffs, [[a]]],
        [diffs, [[a], 0, 1]],
        [diffs, [[a], -1]],
        [diffs, [[a], 1.5]],
        [diffs, [[a], 2 ** 53]],
        [diffs, [[a], "latest"]],
        [diffs, [[a], "0x01"]],
        [diffs, [[a], "0xAB"]],
        [diffs, [[a], null]],
        [diffs, [[a], { n: 1 }]],
        [diffs, [null, 0]]
    ];
    for (const [i, [method, params]] of badParams.entries()) {
        const id = 100 + i;
        const request = {
            jsonrpc: "2.0",
            id,
            method,
            ...(params === undefined ? {} : { params })
        };
        assert.equal(
            await errorFor(request, id),
            -32602,
            JSON.stringify(request)
        );
    }

    // A notification gets no reply, valid or not; the next reply proves it.
    const inboxSize = client.inbox.length;
    client.raw(
        JSON.stringify({ jsonrpc: "2.0", method: diffs, params: [[a], 0] })
    );
    client.raw(JSON.stringify({ jsonrpc: "2.0", method: "nope" }));
    const reply = await client.call(
        diffs,
        [[a], "0x" + (2n ** 70n).toString(16)],
        "after-notifications"
    );
    assert.deepEqual(reply.result, []);
    assert.equal(client.inbox.length, inboxSize + 1);

    // An oversized message closes only that peer.
    const hog = await open();
    hog.socket.send("x".repeat(1024 * 1024 + 1));
    await hog.closed;
    assert.deepEqual(
        (await client.call(diffs, [[a], "0x" + (2n ** 70n).toString(16)]))
            .result,
        []
    );
});

// ---------------------------------------------------------------------------
// T2: ordering around a reconciliation in flight
// ---------------------------------------------------------------------------

test("T2: subscribe and catch-up queue behind an in-flight reconciliation", async (t) => {
    const a = await deploy();
    const { relay, connect: open } = await harness(t, { retention: 5 });
    const client = await open();
    const hold = relay.hold("debug_traceBlockByNumber");
    const hash = await writeTx(a, 0, 5);
    await hold.arrived;
    const held = await head();

    const subscribeId = ++requestSeq;
    const diffsId = ++requestSeq;
    client.raw(
        JSON.stringify({
            jsonrpc: "2.0",
            id: subscribeId,
            method: "scp_subscribeContractStorage",
            params: [[a]]
        })
    );
    client.raw(
        JSON.stringify({
            jsonrpc: "2.0",
            id: diffsId,
            method: "scp_getContractStorageDiffs",
            params: [[a], held.number]
        })
    );
    // A synchronous error reply proves the two queued requests are still waiting.
    const barrier = await client.call(
        "scp_getContractStorageDiffs",
        [],
        "barrier"
    );
    assert.equal(barrier.error.code, -32602);
    assert.ok(
        !client.inbox.some((m) => m.id === subscribeId || m.id === diffsId)
    );

    hold.release();
    const receipt = await receiptOf(hash);
    const subscribed = await until(
        () => client.inbox.find((m) => m.id === subscribeId),
        "subscribe reply"
    );
    const diffs = await until(
        () => client.inbox.find((m) => m.id === diffsId),
        "diffs reply"
    );
    assert.equal(typeof subscribed.result, "string");
    assert.ok(
        diffs.result.some((r) => r.hash === receipt.blockHash),
        "catch-up sees the committed block"
    );
    assert.equal(
        client.records().length,
        0,
        "a new subscription gets future commits only"
    );

    const next = await write(a, 0, 6);
    await client.waitFor(next.blockHash);
});

test("T2: closing peers with pending work and many subscriptions leaves the service healthy", async (t) => {
    const a = await deploy();
    const { relay, connect: open } = await harness(t, { retention: 5 });
    const survivor = await open();
    await survivor.subscribe([a]);
    const leaver = await open();
    const ids = [
        await leaver.subscribe([a]),
        await leaver.subscribe([a]),
        await leaver.subscribe([])
    ];
    assert.equal(new Set(ids).size, 3, "independent subscriptions");

    const first = await write(a, 0, 1);
    await leaver.waitFor(first.blockHash);
    await until(
        () => leaver.records().length === 3,
        "one push per subscription"
    );
    assert.deepEqual(
        ids.map((id) => leaver.records(id).length),
        [1, 1, 1]
    );

    const hold = relay.hold("debug_traceBlockByNumber");
    const hash = await writeTx(a, 0, 2);
    await hold.arrived;
    leaver.raw(
        JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "scp_getContractStorageDiffs",
            params: [[a], 0]
        })
    );
    leaver.socket.terminate();
    await leaver.closed;
    hold.release();
    const second = await receiptOf(hash);
    await survivor.waitFor(second.blockHash);
    const third = await write(a, 0, 3);
    await survivor.waitFor(third.blockHash);
    assert.equal(survivor.records().length, 3);
});

// ---------------------------------------------------------------------------
// T3: fatal failures and startup/shutdown
// ---------------------------------------------------------------------------

test("T3: losing the upstream is fatal and closes every client", async (t) => {
    const { relay, service, connect: open } = await harness(t);
    const client = await open();
    relay.dropAll();
    await assert.rejects(
        bounded(service.closed, "service.closed"),
        /Upstream connection closed/
    );
    await bounded(client.closed, "client close");
});

test("T3: a reorg during tracing fails closed with no fabricated diff and no retrace", async (t) => {
    const a = await deploy();
    await write(a, 0, 1);
    const {
        relay,
        service,
        connect: open
    } = await harness(t, { retention: 5 });
    const client = await open();
    await client.subscribe([a]);
    const snapshot = await rpc("evm_snapshot");
    const hold = relay.hold("debug_traceBlockByNumber");
    await writeTx(a, 0, 10);
    await hold.arrived;
    const tracesBefore = relay.traces().length;
    await rpc("evm_revert", [snapshot]);
    await write(a, 0, 20);
    hold.release();

    await assert.rejects(
        bounded(service.closed, "service.closed"),
        /changed while tracing/
    );
    await client.closed;
    assert.equal(client.records().length, 0, "no wrong-hash record published");
    assert.equal(relay.traces().length, tracesBefore, "no silent retrace");
});

test("T3: startup refusals clean up and never echo credentials", async (t) => {
    const attempt = (options) =>
        startStorageDiffService({ port: 0, ...options });
    await assert.rejects(
        attempt({ upstreamUrl: "ws://user:hunter2@127.0.0.1:1/key-abc123" }),
        (error) =>
            !/hunter2|abc123/.test(error.message) &&
            /ECONNREFUSED|closed|127\.0\.0\.1:1/.test(error.message)
    );
    await assert.rejects(
        attempt({ upstreamUrl: "http://user:hunter2@127.0.0.1:1/" }),
        (error) =>
            !/hunter2/.test(error.message) && /ws:\/\//.test(error.message)
    );
    await assert.rejects(attempt({ upstreamUrl: "not a url" }), /ws:\/\//);
    for (const retention of [0, -1, 1.5, NaN]) {
        await assert.rejects(
            attempt({ upstreamUrl: node.ws, retention }),
            /retention/
        );
    }
    await assert.rejects(
        attempt({ upstreamUrl: node.ws, port: 70000 }),
        /port/
    );

    const relay = await startRelay();
    t.after(() => relay.close());
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => blocker.close(resolve)));
    await assert.rejects(
        attempt({
            upstreamUrl: relay.url,
            host: "127.0.0.1",
            port: blocker.address().port
        }),
        /EADDRINUSE/
    );
    await until(
        () => relay.live.size === 0,
        "upstream socket closed after the failed start"
    );
});

test("T3: close is idempotent and settles closed", async () => {
    const service = await startStorageDiffService({
        upstreamUrl: node.ws,
        port: 0
    });
    const client = await connect(service.url);
    await Promise.all([service.close(), service.close()]);
    await service.close();
    await service.closed;
    await client.closed;
});

// ---------------------------------------------------------------------------
// T4: launcher, shutdown signals, overload, platform isolation
// ---------------------------------------------------------------------------

function runCli(args) {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: root });
    const cli = { output: "", err: "" };
    child.stdout.on("data", (chunk) => (cli.output += chunk));
    child.stderr.on("data", (chunk) => (cli.err += chunk));
    cli.exit = new Promise((resolve) =>
        child.on("exit", (code, signal) => resolve({ code, signal }))
    );
    cli.child = child;
    return cli;
}

test("T4: the launcher rejects invalid flags with a nonzero exit and no credentials", async () => {
    for (const args of [
        [],
        ["--bogus"],
        ["--upstream", "http://user:hunter2@127.0.0.1:1/"],
        ["--upstream", node.ws, "--retention", "0"],
        ["--upstream", node.ws, "--retention", "abc"],
        ["--upstream", node.ws, "--port", "-1"],
        ["--upstream", "ws://user:hunter2@127.0.0.1:1/key"]
    ]) {
        const cli = runCli(args);
        const { code } = await cli.exit;
        assert.notEqual(code, 0, args.join(" "));
        assert.doesNotMatch(cli.output + cli.err, /hunter2/);
        assert.equal(cli.output, "");
    }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`T4: the launcher prints the bound URL and exits cleanly on ${signal}`, async (t) => {
        const a = await deploy();
        const written = await write(a, 0, 1);
        const cli = runCli([
            "--upstream",
            node.ws,
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--retention",
            "2"
        ]);
        t.after(() => cli.child.kill("SIGKILL"));
        const listening = await until(() => {
            try {
                return JSON.parse(cli.output.split("\n")[0]);
            } catch {}
        }, `listening line; stderr=${cli.err}`);
        assert.equal(listening.event, "listening");
        assert.match(listening.url, /^ws:\/\/127\.0\.0\.1:[1-9]\d*$/);
        const client = await connect(listening.url);
        const history = await client.history([a], written.blockNumber);
        assert.equal(history[0].hash, written.blockHash);

        cli.child.kill(signal);
        assert.deepEqual(await cli.exit, { code: 0, signal: null });
        await client.closed;
        assert.equal(cli.err, "");
    });
}

test("T4: the launcher exits nonzero when the upstream disappears", async (t) => {
    const relay = await startRelay();
    t.after(() => relay.close());
    const cli = runCli(["--upstream", relay.url, "--port", "0"]);
    t.after(() => cli.child.kill("SIGKILL"));
    await until(
        () => cli.output.includes("listening"),
        `listening; stderr=${cli.err}`
    );
    relay.dropAll();
    const { code } = await cli.exit;
    assert.equal(code, 1);
    assert.match(cli.err, /Upstream connection closed/);
});

test("T4: a slow peer is closed, not silently skipped, and recovers with catch-up", async (t) => {
    const filler = await deploy(FILL_CODE);
    const { connect: open } = await harness(t, { retention: 3 });
    const healthy = await open();
    const slow = await open();
    await healthy.subscribe([filler]);
    // Each push is a few hundred KiB; many subscriptions per socket multiply it
    // past the 16 MiB send-buffer limit within one block.
    for (let i = 0; i < 400; i++) await slow.subscribe([filler]);
    slow.socket._socket.pause();

    const receipt = await receiptOf(
        await submit(word(1000), filler, "0x1c00000")
    );
    const record = await healthy.waitFor(receipt.blockHash);
    assert.equal(Object.keys(record.post[filler].storage).length, 1000);

    slow.socket._socket.resume();
    await Promise.race([
        slow.closed,
        sleep(20000).then(() => assert.fail("slow peer still open"))
    ]);
    const recovered = await open();
    assert.ok(
        (await recovered.history([filler], receipt.blockNumber)).some(
            (r) => r.hash === receipt.blockHash
        )
    );
});

test("T4: the service stays out of every shared SDK entry", () => {
    const own = path.join(
        root,
        "src",
        "utils",
        "node",
        "StorageDiffService.ts"
    );
    const importers = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (
                full !== own &&
                /\.(ts|tsx|js|mjs)$/.test(entry.name) &&
                fs.readFileSync(full, "utf8").includes("StorageDiffService")
            ) {
                importers.push(path.relative(root, full));
            }
        }
    };
    walk(path.join(root, "src"));
    assert.deepEqual(importers, []);
    const manifest = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8")
    );
    assert.equal(
        manifest.scripts["infra:storage-diff"],
        "node scripts/infra/storage-diff-service.js"
    );
    assert.ok(!JSON.stringify(manifest.exports).includes("StorageDiffService"));
});
