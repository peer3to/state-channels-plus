import {
    deserializeTransactionRequest,
    deserializeTransactionResponse,
    serializeTransactionRequest,
    serializeTransactionResponse
} from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import { assertIsolatedReplacementDetection } from "@test/fixtures/node/IsolatedReplacementFixture";
import { assertRuntimeSignerFields } from "@test/fixtures/RuntimeSignerFixture";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("chain signer serialization", () => {
    it("preserves full transaction fields and byte message signatures through an inline SDK", async () => {
        await assertRuntimeSignerFields(true);
    });
    it("preserves full transaction fields and byte message signatures through an SDK worker", async () => {
        await assertRuntimeSignerFields(false);
    });
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
        await assertIsolatedReplacementDetection();
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
