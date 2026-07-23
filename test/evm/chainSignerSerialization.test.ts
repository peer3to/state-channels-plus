import { expect } from "chai";
import type { TransactionResponse } from "ethers";
import { ethers } from "hardhat";

import {
    deserializeTransactionRequest,
    deserializeTransactionResponse,
    serializeTransactionRequest,
    serializeTransactionResponse
} from "@/evm/p2pRuntime/chainSignerSerialization";

describe("chain signer serialization", () => {
    it("round-trips a normalized transaction request", async () => {
        const [sender, recipient] = await ethers.getSigners();
        const storageKey = ethers.zeroPadValue("0x01", 32);
        const serialized = await serializeTransactionRequest(
            {
                from: sender,
                to: recipient,
                nonce: 7,
                gasLimit: 21_000n,
                maxFeePerGas: 3n,
                maxPriorityFeePerGas: 1n,
                data: "0x1234",
                value: 9n,
                chainId: 31_337n,
                accessList: [
                    {
                        address: recipient.address,
                        storageKeys: [storageKey]
                    }
                ]
            },
            sender.provider
        );
        const decoded = deserializeTransactionRequest(serialized);

        expect(serialized.from).to.equal(sender.address);
        expect(serialized.to).to.equal(recipient.address);
        expect(serialized.gasLimit).to.equal("0x5208");
        expect(decoded.nonce).to.equal(7);
        expect(decoded.value).to.equal(9n);
        expect(decoded.maxFeePerGas).to.equal(3n);
        expect(serialized.accessList?.[0].storageKeys[0]).to.equal(storageKey);
    });

    it("reconstructs a native provider-backed transaction response", async () => {
        const [sender, recipient] = await ethers.getSigners();
        const original = await sender.sendTransaction({
            to: recipient.address,
            value: 5n
        });
        const restored = deserializeTransactionResponse(
            serializeTransactionResponse(original),
            sender.provider
        );

        expect(restored.hash).to.equal(original.hash);
        expect(restored.nonce).to.equal(original.nonce);
        expect(restored.value).to.equal(5n);
        expect(restored.signature.serialized).to.equal(
            original.signature.serialized
        );
        expect((await restored.wait())?.hash).to.equal(original.hash);
        expect(await restored.confirmations()).to.be.greaterThan(0);
    });

    it("allows explicit client-side replacement detection", async () => {
        const [sender, recipient] = await ethers.getSigners();
        const gasPrice = (await ethers.provider.getFeeData()).gasPrice!;
        const startBlock = await ethers.provider.getBlockNumber();

        await ethers.provider.send("evm_setAutomine", [false]);
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
            await ethers.provider.send("hardhat_mine", ["0x1"]);

            let replacementError: unknown;
            try {
                await restored.wait();
            } catch (error) {
                replacementError = error;
            }
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
            await ethers.provider.send("evm_setAutomine", [true]);
        }
    });

    it("rejects fields that cannot cross the runtime port", async () => {
        const [sender, recipient] = await ethers.getSigners();

        let serializationError: unknown;
        try {
            await serializeTransactionRequest(
                {
                    to: recipient.address,
                    customData: { transport: "private" }
                },
                sender.provider
            );
        } catch (error) {
            serializationError = error;
        }

        expect(serializationError).to.be.instanceOf(Error);
        expect((serializationError as Error).message).to.include(
            "custom transaction data cannot cross the runtime port"
        );
    });
});
