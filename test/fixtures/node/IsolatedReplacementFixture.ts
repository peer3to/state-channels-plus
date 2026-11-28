// @spec-test-coverage-ignore: an exclusively owned node for the replacement-detection test
import {
    mineBlocks,
    testAccount,
    withIsolatedHardhatNode
} from "./IsolatedHardhatNode";
import {
    serializeTransactionResponse,
    deserializeTransactionResponse
} from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import { expect } from "chai";
import { type TransactionResponse } from "ethers";

export async function assertIsolatedReplacementDetection(): Promise<void> {
    await withIsolatedHardhatNode(
        async (provider) => {
            const sender = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const gasPrice = (await provider.getFeeData()).gasPrice!;
            const startBlock = await provider.getBlockNumber();

            const original = await sender.sendTransaction({
                type: 0,
                to: recipient.address,
                value: 5n,
                gasPrice
            });
            const restored = deserializeTransactionResponse(
                serializeTransactionResponse(original),
                provider
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
            await mineBlocks(provider, 1);
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
        },
        { seal: "manual" }
    );
}
