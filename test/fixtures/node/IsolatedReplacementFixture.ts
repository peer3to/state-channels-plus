// @spec-test-coverage-ignore: an exclusively owned node for the replacement-detection test
import {
    serializeTransactionResponse,
    deserializeTransactionResponse
} from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import { expect } from "chai";
import { JsonRpcProvider, type TransactionResponse } from "ethers";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";

export async function assertIsolatedReplacementDetection(): Promise<void> {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (!address || typeof address === "string")
        throw new Error("Expected a TCP reservation");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = spawn(
        process.execPath,
        [path.resolve("scripts/infra/start-hardhat-node.js")],
        {
            env: {
                ...process.env,
                HARDHAT_NODE_HOST: "127.0.0.1",
                HARDHAT_NODE_PORT: String(address.port)
            },
            stdio: "ignore"
        }
    );
    const provider = new JsonRpcProvider(
        `http://127.0.0.1:${address.port}`,
        31337,
        { staticNetwork: true }
    );
    try {
        const started = Date.now();
        for (;;) {
            try {
                await provider.getBlockNumber();
                break;
            } catch (error) {
                if (Date.now() - started > 15_000) throw error;
                // Poll the private node's startup; no protocol time is changed here.
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        const sender = await provider.getSigner(0);
        const recipient = await provider.getSigner(1);
        const gasPrice = (await provider.getFeeData()).gasPrice!;
        const startBlock = await provider.getBlockNumber();

        await provider.send("evm_setAutomine", [false]);
        try {
            const original = await sender.sendTransaction({
                type: 0,
                to: recipient.address,
                value: 5n,
                gasPrice
            });
            const restored = deserializeTransactionResponse(
                serializeTransactionResponse(original),
                sender.provider
            ).replaceableTransaction(startBlock);
            const replacement = await sender.sendTransaction({
                type: 0,
                to: recipient.address,
                value: 5n,
                nonce: original.nonce,
                gasPrice: gasPrice * 2n
            });

            // ethers detects a replacement only from a block event that
            // arrives after `wait()` has subscribed, and its block poller
            // bootstraps at whatever block it reads first, with the block
            // number cached for 250ms. Mining before the subscription raced:
            // on a loaded host the poller bootstrapped at the mined block and
            // `wait()` never settled. Subscribe first, make sure the poller
            // has read the pre-mine block, then mine.
            provider.pollingInterval = 100;
            const waited = restored.wait().then(
                () => undefined,
                (error: unknown) => error
            );
            while ((await provider.listenerCount("block")) === 0) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            await provider.getBlockNumber();
            await provider.send("hardhat_mine", ["0x1"]);
            const replacementError = await waited;
            expect(replacementError).to.be.instanceOf(Error);
            expect(
                (replacementError as Error & { code?: string }).code
            ).to.equal("TRANSACTION_REPLACED");
            expect(
                (
                    replacementError as Error & {
                        replacement?: TransactionResponse;
                    }
                ).replacement?.hash
            ).to.equal(replacement.hash);
        } finally {
            await provider.send("evm_setAutomine", [true]);
        }
    } finally {
        provider.destroy();
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGTERM");
            await exited;
        }
    }
}
