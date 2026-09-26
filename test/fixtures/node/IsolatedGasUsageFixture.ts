// @spec-test-coverage-ignore: exclusively owned nodes for the gas usage receipt cases and the broadcast recovery cases
import { withIsolatedHardhatNode } from "./IsolatedHardhatNode";
import GasUsageRecorder from "@/evm/gasUsage/GasUsageRecorder";
import HostNonceManager from "@/evm/signer/HostNonceManager";
import { expect } from "chai";
import {
    ethers,
    type HDNodeWallet,
    JsonRpcProvider,
    type TransactionReceipt,
    Wallet
} from "ethers";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";

/**
 * Runtime `PUSH1 0 PUSH1 0 REVERT`: every call reverts, whatever the selector.
 * The 11-byte constructor copies those five bytes out as the runtime code.
 */
const ALWAYS_REVERTING_INIT_CODE = "0x600580600b6000396000f360006000fd";
/** Enough for the intrinsic cost of a call with a selector, and no estimate. */
const EXPLICIT_GAS_LIMIT = 100_000n;
/** The bound of the read that gives up on a pending receipt; time is the input. */
const BOUNDED_READ_MS = 500;
/**
 * Node arms a timer against the event loop's cached clock, so it can fire a
 * few ms before a wall-clock span measured in the same turn reaches the bound.
 */
const TIMER_CLOCK_SLACK_MS = 20;
/** A nonce no send will ever reach, so the node queues and never mines it. */
const UNREACHABLE_NONCE = 50;
/** How long the node gets to answer with a receipt it has already mined. */
const RECEIPT_POLL_BUDGET_MS = 10_000;
/** ethers caches one `perform` result per tag for 250ms; retry past that. */
const BLOCK_EVENT_RETRY_MS = 250;
/** A background mine this often: past the 250ms cache, so each poll re-reads. */
const BACKGROUND_MINE_INTERVAL_MS = 300;

/** A random wallet on `provider`, funded by the node's first account. */
async function fundedWallet(provider: JsonRpcProvider): Promise<HDNodeWallet> {
    const funder = await provider.getSigner(0);
    const wallet = Wallet.createRandom().connect(provider);
    await (
        await funder.sendTransaction({
            to: wallet.address,
            value: ethers.parseEther("1")
        })
    ).wait();
    return wallet;
}

/**
 * The receipt of `hash`, once the node has it. ethers caches one `perform`
 * result per request tag for 250ms, and the observation's own wait has already
 * asked for this receipt and been told `null`, so a single read right after
 * mining answers from that cache.
 */
async function minedReceiptOf(
    provider: JsonRpcProvider,
    hash: string
): Promise<TransactionReceipt> {
    const started = Date.now();
    for (;;) {
        const receipt = await provider.getTransactionReceipt(hash);
        if (receipt) return receipt;
        if (Date.now() - started > RECEIPT_POLL_BUDGET_MS)
            throw new Error(`No receipt mined for ${hash}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/** ethers subscribes its receipt wait asynchronously; mine only after it did. */
async function awaitReceiptSubscription(
    provider: JsonRpcProvider
): Promise<void> {
    while ((await provider.listenerCount("block")) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await provider.getBlockNumber();
}

/**
 * Mines until the provider reports a block, for a case whose oracle is that no
 * receipt appears. The block poller bootstraps at whatever number its own first
 * read returns and emits nothing for it, so a block mined before that read is
 * never reported, and a registered listener does not prove that read happened.
 * The extra empty blocks are harmless: the first mined block already carries
 * the pending transaction.
 */
async function mineUntilBlockEvent(provider: JsonRpcProvider): Promise<void> {
    let reported = false;
    let onBlock: (() => void) | undefined;
    const listener = () => {
        reported = true;
        onBlock?.();
    };
    // One listener for the whole loop. Removing it between attempts would
    // drop the last "block" listener whenever no receipt wait holds one, and
    // ethers deletes the subscription with it: its replacement bootstraps a
    // fresh baseline every attempt and can never report a block.
    await provider.on("block", listener);
    try {
        while (!reported) {
            const blockReported = new Promise<void>((resolve) => {
                onBlock = resolve;
            });
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await provider.send("hardhat_mine", ["0x1"]);
                await Promise.race([
                    blockReported,
                    new Promise<void>((resolve) => {
                        timer = setTimeout(resolve, BLOCK_EVENT_RETRY_MS);
                    })
                ]);
            } finally {
                if (timer !== undefined) clearTimeout(timer);
            }
        }
    } finally {
        await provider.off("block", listener);
    }
}

/**
 * Runs `section` while a block is mined every 300ms. A receipt wait re-reads
 * its receipt only on a block event, and it subscribes asynchronously, so a
 * single mine can land before it subscribes and leave it pending for its whole
 * bound. Mining for as long as the section waits means a block event always
 * follows, whenever the wait subscribed, and the interval outlives the 250ms
 * perform cache so the poll that event triggers cannot answer from a cached
 * empty receipt. The extra empty blocks are harmless: the first mined block
 * already carries the pending transaction, and no assertion counts blocks.
 */
async function withBackgroundMining<T>(
    provider: JsonRpcProvider,
    section: () => Promise<T>
): Promise<T> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let mining: Promise<unknown> = Promise.resolve();
    const mineOnce = () => {
        mining = provider
            .send("hardhat_mine", ["0x1"])
            // A mine that loses its node is the teardown, not a failure.
            .catch(() => undefined)
            .then(() => {
                if (!stopped)
                    timer = setTimeout(mineOnce, BACKGROUND_MINE_INTERVAL_MS);
            });
    };
    mineOnce();
    try {
        return await section();
    } finally {
        stopped = true;
        if (timer !== undefined) clearTimeout(timer);
        // Let the in-flight mine land, so the node is not hit after teardown.
        await mining;
    }
}

export async function assertIsolatedRevertedGasRecorded(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const funder = await provider.getSigner(0);
        const deployment = await (
            await funder.sendTransaction({ data: ALWAYS_REVERTING_INIT_CODE })
        ).wait();
        const revertingContract = deployment!.contractAddress!;
        const sender = await fundedWallet(provider);
        const manager = new HostNonceManager(sender);
        const selector = ethers.id("alwaysReverts()").slice(0, 10);

        // Automine off so the node cannot throw the revert back at broadcast,
        // and an explicit gas limit so ethers broadcasts instead of estimating.
        await provider.send("evm_setAutomine", [false]);
        const response = await manager.sendTransaction({
            to: revertingContract,
            data: selector,
            gasLimit: EXPLICIT_GAS_LIMIT
        });
        const { receipt, rows } = await withBackgroundMining(
            provider,
            async () => {
                const mined = await minedReceiptOf(provider, response.hash);
                return {
                    receipt: mined,
                    rows: await manager.gasUsage.settledSnapshot()
                };
            }
        );

        expect(receipt.status, "the call must have reverted on chain").to.equal(
            0
        );
        expect(rows.length).to.equal(1);
        expect(rows[0].contractAddress).to.equal(revertingContract);
        expect(rows[0].functionSelector).to.equal(selector);
        expect(rows[0].revertedCount).to.equal(1);
        expect(rows[0].revertedGasUsed).to.equal(receipt.gasUsed.toString());
        expect(
            BigInt(rows[0].revertedGasUsed) > 0n,
            "a reverted call still burns gas"
        ).to.equal(true);
        expect(rows[0].successCount).to.equal(0);
        expect(rows[0].successGasUsed).to.equal("0");
        expect(rows[0].minGasUsed).to.equal("0");
        expect(rows[0].maxGasUsed).to.equal("0");
    });
}

export async function assertIsolatedReplacedTransactionAbsent(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const sender = await fundedWallet(provider);
        const manager = new HostNonceManager(sender);
        const gasPrice = (await provider.getFeeData()).gasPrice!;
        const callee = Wallet.createRandom().address;

        await provider.send("evm_setAutomine", [false]);
        const original = await manager.sendTransaction({
            type: 0,
            to: callee,
            data: ethers.id("replacedBeforeItMined()").slice(0, 10),
            gasPrice,
            gasLimit: EXPLICIT_GAS_LIMIT
        });
        // The same nonce at twice the price, sent by the wallet itself so the
        // manager keeps owning its own nonce sequence.
        await sender.sendTransaction({
            type: 0,
            to: callee,
            value: 1n,
            nonce: original.nonce,
            gasPrice: gasPrice * 2n
        });
        await mineUntilBlockEvent(provider);

        expect(
            await manager.gasUsage.settledSnapshot(),
            "a replaced transaction never mined, so it is not counted"
        ).to.deep.equal([]);
    });
}

export async function assertIsolatedDisposalEndsClosedProviderWait(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const sender = await fundedWallet(provider);
        const manager = new HostNonceManager(sender);

        // The node is this call's own and is killed with it, so automine stays
        // off: the transaction must still be unmined when the provider closes.
        await provider.send("evm_setAutomine", [false]);
        await manager.sendTransaction({
            to: Wallet.createRandom().address,
            value: 1n,
            gasLimit: EXPLICIT_GAS_LIMIT
        });
        // Let the receipt wait subscribe first: a closed provider then never
        // ends it, and only disposal can.
        await awaitReceiptSubscription(provider);
        provider.destroy();
        manager.gasUsage.dispose();

        // Disposal ends the wait without a timer or a chain read, so the
        // settle completes before the event loop runs anything else.
        const nextTurn = new Promise<"still waiting">((resolve) =>
            setImmediate(() => resolve("still waiting"))
        );
        expect(
            await Promise.race([manager.gasUsage.settledSnapshot(), nextTurn]),
            "disposal settles the outstanding wait at once, and a transaction that never mined is not counted"
        ).to.deep.equal([]);
    });
}

export async function assertIsolatedSettleIgnoresLaterObservation(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        // Receipt waits have no bound of their own, so a `settle()` that
        // re-read the set would wait for the unmineable observation below
        // until the test timeout fails it.
        const recorder = new GasUsageRecorder();
        const mining = await fundedWallet(provider);
        const queued = await fundedWallet(provider);
        const callee = Wallet.createRandom().address;
        const minedSelector = ethers
            .id("settlesInsideTheWindow()")
            .slice(0, 10);

        await provider.send("evm_setAutomine", [false]);
        recorder.observe(
            await mining.sendTransaction({
                to: callee,
                data: minedSelector,
                gasLimit: EXPLICIT_GAS_LIMIT
            })
        );
        const settling = recorder.settle();
        // A second observation opens inside the window the first settle opened.
        // Its nonce gap keeps the node from ever mining it, so its own receipt
        // wait is still pending when the case ends: it records nothing, and the
        // node and the provider are gone with the call that owned them.
        recorder.observe(
            await queued.sendTransaction({
                to: callee,
                data: ethers.id("startedAfterTheSettle()").slice(0, 10),
                gasLimit: EXPLICIT_GAS_LIMIT,
                nonce: UNREACHABLE_NONCE
            })
        );
        // Hangs if `settle()` re-read the set instead of the observations it
        // was asked about.
        await withBackgroundMining(provider, () => settling);
        const rows = recorder.snapshot();
        expect(rows.length).to.equal(1);
        expect(rows[0].functionSelector).to.equal(minedSelector);
    });
}

export async function assertIsolatedBoundedReadCountsLaterReceipt(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const sender = await fundedWallet(provider);
        const manager = new HostNonceManager(sender);
        const callee = Wallet.createRandom().address;
        const selector = ethers.id("minedAfterTheBoundedRead()").slice(0, 10);

        // Nothing mines while automine is off, so only the bound can end the
        // first read.
        await provider.send("evm_setAutomine", [false]);
        const response = await manager.sendTransaction({
            to: callee,
            data: selector,
            gasLimit: EXPLICIT_GAS_LIMIT
        });
        const startedAt = Date.now();
        const boundedRows =
            await manager.gasUsage.settledSnapshot(BOUNDED_READ_MS);
        const boundedReadMs = Date.now() - startedAt;
        const { receipt, rows } = await withBackgroundMining(
            provider,
            async () => {
                const mined = await minedReceiptOf(provider, response.hash);
                return {
                    receipt: mined,
                    rows: await manager.gasUsage.settledSnapshot()
                };
            }
        );

        expect(
            boundedRows,
            "the pending receipt is not in the bounded read"
        ).to.deep.equal([]);
        expect(
            boundedReadMs >= BOUNDED_READ_MS - TIMER_CLOCK_SLACK_MS,
            "the bounded read waited for its bound"
        ).to.equal(true);
        expect(rows.length).to.equal(1);
        expect(rows[0].contractAddress).to.equal(callee);
        expect(rows[0].functionSelector).to.equal(selector);
        expect(rows[0].successCount).to.equal(1);
        expect(rows[0].successGasUsed).to.equal(receipt.gasUsed.toString());
    });
}

export async function assertIsolatedRecoveredBroadcastRecorded(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const sender = await fundedWallet(provider);
        const manager = new HostNonceManager(sender);
        const gasPrice = (await provider.getFeeData()).gasPrice!;
        const callee = Wallet.createRandom().address;
        // Legacy fields, a fixed price and an explicit limit: the manager and
        // the wallet below sign the same bytes for the same nonce.
        const heldCall = {
            type: 0,
            to: callee,
            data: ethers.id("heldByTheNodeBeforeItsBroadcast()").slice(0, 10),
            gasPrice,
            gasLimit: EXPLICIT_GAS_LIMIT
        };
        // One send through the manager, so it owns the next nonce.
        const first = await manager.sendTransaction({
            to: callee,
            data: ethers.id("sentBeforeTheHeldCall()").slice(0, 10),
            gasLimit: EXPLICIT_GAS_LIMIT
        });
        await first.wait();

        await provider.send("evm_setAutomine", [false]);
        // The node already holds the manager's next transaction, as after a
        // broadcast whose answer was lost, so the manager's own broadcast of
        // the same bytes fails and it recovers the transaction from the node.
        const heldTransaction = await sender.signTransaction(
            await sender.populateTransaction({
                ...heldCall,
                nonce: first.nonce + 1
            })
        );
        const held = await provider.broadcastTransaction(heldTransaction);
        const recovered = await manager.sendTransaction(heldCall);
        // The node refuses the same bytes a second time, so the manager's
        // answer can only have come from its recovery.
        await assert.rejects(provider.broadcastTransaction(heldTransaction));
        const { receipt, rows } = await withBackgroundMining(
            provider,
            async () => {
                const mined = await minedReceiptOf(provider, recovered.hash);
                return {
                    receipt: mined,
                    rows: await manager.gasUsage.settledSnapshot()
                };
            }
        );

        expect(
            recovered.hash,
            "the manager answers with the transaction the node held"
        ).to.equal(held.hash);
        expect(rows.length).to.equal(2);
        const heldRow = rows.find(
            (row) => row.functionSelector === heldCall.data
        );
        expect(heldRow, "the recovered transaction is recorded").to.not.be
            .undefined;
        expect(heldRow!.successCount).to.equal(1);
        expect(heldRow!.successGasUsed).to.equal(receipt.gasUsed.toString());
    });
}

export async function assertIsolatedRecoveredReplacementDetected(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const sender = await fundedWallet(provider);
        const manager = new HostNonceManager(sender);
        const gasPrice = (await provider.getFeeData()).gasPrice!;
        const callee = Wallet.createRandom().address;
        const firstSelector = ethers
            .id("sentBeforeTheReplacedHeldCall()")
            .slice(0, 10);
        // Legacy fields, a fixed price and an explicit limit: the manager and
        // the wallet below sign the same bytes for the same nonce.
        const heldCall = {
            type: 0,
            to: callee,
            data: ethers.id("heldThenReplacedBeforeItMined()").slice(0, 10),
            gasPrice,
            gasLimit: EXPLICIT_GAS_LIMIT
        };
        // One send through the manager, so it owns the next nonce.
        const first = await manager.sendTransaction({
            to: callee,
            data: firstSelector,
            gasLimit: EXPLICIT_GAS_LIMIT
        });
        await first.wait();

        await provider.send("evm_setAutomine", [false]);
        // As in the recovered-broadcast case, the manager's broadcast fails on
        // bytes the node already holds, and it answers from its recovery.
        const heldTransaction = await sender.signTransaction(
            await sender.populateTransaction({
                ...heldCall,
                nonce: first.nonce + 1
            })
        );
        const held = await provider.broadcastTransaction(heldTransaction);
        const recovered = await manager.sendTransaction(heldCall);
        await assert.rejects(provider.broadcastTransaction(heldTransaction));
        // The same nonce at twice the price, signed by the same wallet, so the
        // recovered transaction can never mine.
        const replacement = await sender.sendTransaction({
            type: 0,
            to: callee,
            data: ethers.id("replacedTheRecoveredCall()").slice(0, 10),
            nonce: recovered.nonce,
            gasPrice: gasPrice * 2n,
            gasLimit: EXPLICIT_GAS_LIMIT
        });
        // Neither the caller's wait nor the unbounded read ends unless the
        // recovered response detects its replacement; without that, the test
        // timeout fails the case.
        const { replacementReceipt, rows } = await withBackgroundMining(
            provider,
            async () => {
                const [mined, settledRows] = await Promise.all([
                    minedReceiptOf(provider, replacement.hash),
                    manager.gasUsage.settledSnapshot(),
                    assert.rejects(
                        recovered.wait(),
                        (error) =>
                            ethers.isError(error, "TRANSACTION_REPLACED") &&
                            error.hash === replacement.hash
                    )
                ]);
                return { replacementReceipt: mined, rows: settledRows };
            }
        );

        expect(
            recovered.hash,
            "the manager answers with the transaction the node held"
        ).to.equal(held.hash);
        expect(
            replacementReceipt.status,
            "the replacement mined in the recovered transaction's place"
        ).to.equal(1);
        expect(
            rows.map((row) => row.functionSelector),
            "only the first send is counted: the replaced one never mined, and its replacement is not counted under its selector"
        ).to.deep.equal([firstSelector]);
    });
}

export async function assertIsolatedBroadcastSharesStartBlockRead(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        const sender = await fundedWallet(provider);
        const manager = new HostNonceManager(sender);
        const gasPrice = (await provider.getFeeData()).gasPrice!;
        // The JSON-RPC method names of each request the provider sent, one
        // entry per HTTP request (a batch lists all of its methods).
        const sentRequests: string[][] = [];
        const onDebug = (event: {
            action: string;
            payload?: { method: string } | Array<{ method: string }>;
        }) => {
            if (event.action !== "sendRpcPayload" || !event.payload) return;
            const payloads = Array.isArray(event.payload)
                ? event.payload
                : [event.payload];
            sentRequests.push(payloads.map((payload) => payload.method));
        };
        // Setup's own block-number reads must leave the 250ms perform cache,
        // or the send's read answers from it and no request is sent.
        await new Promise((resolve) =>
            setTimeout(resolve, BACKGROUND_MINE_INTERVAL_MS)
        );
        await provider.on("debug", onDebug);
        let response;
        try {
            // Legacy fields, a fixed price and an explicit limit: nothing
            // before the broadcast asks for the block number.
            response = await manager.sendTransaction({
                type: 0,
                to: Wallet.createRandom().address,
                data: ethers.id("sentWithItsStartBlockRead()").slice(0, 10),
                gasPrice,
                gasLimit: EXPLICIT_GAS_LIMIT
            });
        } finally {
            await provider.off("debug", onDebug);
        }
        await response.wait();

        const broadcastIndex = sentRequests.findIndex((methods) =>
            methods.includes("eth_sendRawTransaction")
        );
        expect(broadcastIndex, "the send reached the node").to.not.equal(-1);
        const upToBroadcast = sentRequests.slice(0, broadcastIndex + 1);
        expect(
            upToBroadcast.flat().filter((m) => m === "eth_blockNumber").length,
            "the start-block read and the broadcast's own read are one request"
        ).to.equal(1);
        expect(
            sentRequests[broadcastIndex],
            "the start-block read travels with the broadcast, adding no round trip"
        ).to.include("eth_blockNumber");
    });
}

/** One JSON-RPC request or response object, as the proxy reads it. */
interface JsonRpcMessage {
    jsonrpc: string;
    id: number;
    method?: string;
}

/**
 * Runs `use` with a provider behind an HTTP proxy to `nodeUrl`. After
 * `failNextBlockNumber()`, the proxy answers the next `eth_blockNumber` with a
 * JSON-RPC error and forwards every other request of the same batch to the
 * node, so the node still accepts a raw transaction sent with it.
 */
async function withBlockNumberFailingProxy<T>(
    nodeUrl: string,
    use: (proxy: {
        provider: JsonRpcProvider;
        failNextBlockNumber: () => void;
        injectedFailures: () => number;
    }) => Promise<T>
): Promise<T> {
    let armed = false;
    let injected = 0;
    const forward = async (body: string): Promise<string> =>
        (
            await fetch(nodeUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body
            })
        ).text();
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            void (async () => {
                const body = Buffer.concat(chunks).toString("utf8");
                const parsed = JSON.parse(body) as
                    | JsonRpcMessage
                    | JsonRpcMessage[];
                const messages = Array.isArray(parsed) ? parsed : [parsed];
                const failed = armed
                    ? messages.find(
                          (message) => message.method === "eth_blockNumber"
                      )
                    : undefined;
                let answer: string;
                if (!failed) {
                    answer = await forward(body);
                } else {
                    armed = false;
                    injected += 1;
                    const others = messages.filter(
                        (message) => message !== failed
                    );
                    const forwarded = others.length
                        ? (JSON.parse(
                              await forward(JSON.stringify(others))
                          ) as JsonRpcMessage[])
                        : [];
                    const results = [
                        ...forwarded,
                        {
                            jsonrpc: "2.0",
                            id: failed.id,
                            error: {
                                code: -32603,
                                message: "injected eth_blockNumber failure"
                            }
                        }
                    ];
                    answer = JSON.stringify(
                        Array.isArray(parsed) ? results : results[0]
                    );
                }
                response.writeHead(200, {
                    "content-type": "application/json"
                });
                response.end(answer);
            })().catch(() => {
                response.writeHead(502);
                response.end();
            });
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Expected a TCP proxy address");
    const provider = new JsonRpcProvider(
        `http://127.0.0.1:${address.port}`,
        31337,
        { staticNetwork: true }
    );
    try {
        return await use({
            provider,
            failNextBlockNumber: () => {
                armed = true;
            },
            injectedFailures: () => injected
        });
    } finally {
        provider.destroy();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

export async function assertIsolatedRecoveryOutlivesFailedBlockNumberRead(): Promise<void> {
    await withIsolatedHardhatNode(async (nodeProvider) => {
        const funded = await fundedWallet(nodeProvider);
        const gasPrice = (await nodeProvider.getFeeData()).gasPrice!;
        await withBlockNumberFailingProxy(
            nodeProvider._getConnection().url,
            async (proxy) => {
                const sender = new Wallet(funded.privateKey, proxy.provider);
                const manager = new HostNonceManager(sender);
                const call = {
                    type: 0,
                    to: Wallet.createRandom().address,
                    data: ethers
                        .id("sentWhileTheBlockReadFailed()")
                        .slice(0, 10),
                    gasPrice,
                    gasLimit: EXPLICIT_GAS_LIMIT
                };

                // The broadcast's own block-number read fails while the node
                // accepts the raw transaction sent with it, so the broadcast
                // rejects and the manager must recover what the node holds.
                proxy.failNextBlockNumber();
                const recovered = await manager.sendTransaction(call);

                expect(
                    proxy.injectedFailures(),
                    "the broadcast's block-number read was failed"
                ).to.equal(1);
                const held = await nodeProvider.getTransaction(recovered.hash);
                expect(held, "the node holds the recovered transaction").to.not
                    .be.null;
                expect(held!.from).to.equal(sender.address);
                // ethers caches the failed read for 250ms; wait past it so the
                // caller's own wait reads a fresh block number.
                await new Promise((resolve) =>
                    setTimeout(resolve, BACKGROUND_MINE_INTERVAL_MS)
                );
                const receipt = await recovered.wait();
                expect(
                    receipt!.status,
                    "the recovered transaction mined"
                ).to.equal(1);
                const next = await manager.sendTransaction({
                    ...call,
                    data: ethers.id("sentAfterTheRecovery()").slice(0, 10)
                });
                expect(
                    next.nonce,
                    "the manager kept the nonce after the recovery"
                ).to.equal(recovered.nonce + 1);
                await next.wait();
            }
        );
    });
}
