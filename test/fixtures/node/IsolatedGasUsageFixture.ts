// @spec-test-coverage-ignore: exclusively owned nodes for the gas usage receipt cases
import { withIsolatedHardhatNode } from "./IsolatedHardhatNode";
import GasUsageRecorder from "@/evm/gasUsage/GasUsageRecorder";
import HostNonceManager from "@/evm/signer/HostNonceManager";
import { expect } from "chai";
import {
    ethers,
    type HDNodeWallet,
    type JsonRpcProvider,
    type TransactionReceipt,
    Wallet
} from "ethers";

/**
 * Runtime `PUSH1 0 PUSH1 0 REVERT`: every call reverts, whatever the selector.
 * The 11-byte constructor copies those five bytes out as the runtime code.
 */
const ALWAYS_REVERTING_INIT_CODE = "0x600580600b6000396000f360006000fd";
/** Enough for the intrinsic cost of a call with a selector, and no estimate. */
const EXPLICIT_GAS_LIMIT = 100_000n;
/** Short receipt bound, so the destroyed-provider case ends in a second. */
const RECEIPT_WAIT_BUDGET_MS = 1_000;
/** A nonce no send will ever reach, so the node queues and never mines it. */
const UNREACHABLE_NONCE = 50;
/** Bounds the queued observation, so no timer outlives the case by minutes. */
const QUEUED_RECEIPT_WAIT_MS = 5_000;
/** How long the node gets to answer with a receipt it has already mined. */
const RECEIPT_POLL_BUDGET_MS = 10_000;

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
        await awaitReceiptSubscription(provider);
        await provider.send("hardhat_mine", ["0x1"]);

        const receipt = await minedReceiptOf(provider, response.hash);
        expect(receipt.status, "the call must have reverted on chain").to.equal(
            0
        );

        const rows = await manager.gasUsage.settledSnapshot();
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
        await awaitReceiptSubscription(provider);
        await provider.send("hardhat_mine", ["0x1"]);

        expect(
            await manager.gasUsage.settledSnapshot(),
            "a replaced transaction never mined, so it is not counted"
        ).to.deep.equal([]);
    });
}

export async function assertIsolatedDestroyedProviderSettles(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const sender = await fundedWallet(provider);
        const recorder = new GasUsageRecorder(
            undefined,
            RECEIPT_WAIT_BUDGET_MS
        );

        // The node is this call's own and is killed with it, so automine stays
        // off: the transaction must still be unmined when the provider closes.
        await provider.send("evm_setAutomine", [false]);
        recorder.observe(
            await sender.sendTransaction({
                to: Wallet.createRandom().address,
                value: 1n
            })
        );
        // Only the wait's own bound may end it, so let it subscribe first.
        await awaitReceiptSubscription(provider);
        provider.destroy();

        const startedAt = Date.now();
        expect(
            await recorder.settledSnapshot(),
            "a transaction that never mined is not counted"
        ).to.deep.equal([]);
        expect(
            Date.now() - startedAt >= RECEIPT_WAIT_BUDGET_MS,
            "the receipt bound is what ended the wait"
        ).to.equal(true);
    });
}

export async function assertIsolatedSettleIgnoresLaterObservation(): Promise<void> {
    await withIsolatedHardhatNode(async (provider) => {
        provider.pollingInterval = 100;
        const recorder = new GasUsageRecorder(
            undefined,
            QUEUED_RECEIPT_WAIT_MS
        );
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
        // Its nonce gap keeps the node from ever mining it.
        recorder.observe(
            await queued.sendTransaction({
                to: callee,
                data: ethers.id("startedAfterTheSettle()").slice(0, 10),
                gasLimit: EXPLICIT_GAS_LIMIT,
                nonce: UNREACHABLE_NONCE
            })
        );
        await awaitReceiptSubscription(provider);
        await provider.send("hardhat_mine", ["0x1"]);

        // Hangs if `settle()` re-read the set instead of the observations it
        // was asked about.
        await settling;
        const rows = recorder.snapshot();
        expect(rows.length).to.equal(1);
        expect(rows[0].functionSelector).to.equal(minedSelector);
    });
}
