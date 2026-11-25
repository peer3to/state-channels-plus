import {
    deserializeTransactionRequest,
    deserializeTransactionResponse,
    serializeTransactionRequest,
    serializeTransactionResponse
} from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import {
    testAccount,
    withIsolatedHardhatNode
} from "@test/fixtures/node/IsolatedHardhatNode";
import { assertIsolatedReplacementDetection } from "@test/fixtures/node/IsolatedReplacementFixture";
import {
    assertRuntimeSignerFields,
    assertRuntimeSignerGasHeadroom
} from "@test/fixtures/RuntimeSignerFixture";
import { expect } from "chai";
import { ethers } from "ethers";

describe("chain signer serialization", () => {
    it("preserves full transaction fields and byte message signatures through an inline SDK", async () => {
        await assertRuntimeSignerFields(true);
    });
    it("preserves full transaction fields and byte message signatures through an SDK worker", async () => {
        await assertRuntimeSignerFields(false);
    });
    it("adds gas headroom to estimates and limitless sends through an inline SDK", async () => {
        await assertRuntimeSignerGasHeadroom(true);
    });
    it("adds gas headroom to estimates and limitless sends through an SDK worker", async () => {
        await assertRuntimeSignerGasHeadroom(false);
    });
    it("round-trips a normalized transaction request", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const sender = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const fees = await provider.getFeeData();
            const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice!;
            const storageKey = ethers.zeroPadValue("0x01", 32);
            const serialized = await serializeTransactionRequest(
                {
                    from: sender,
                    to: recipient,
                    nonce: 7,
                    gasLimit: 21_000n,
                    maxFeePerGas,
                    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
                    data: "0x1234",
                    value: 9n,
                    chainId: (await provider.getNetwork()).chainId,
                    accessList: [
                        {
                            address: recipient.address,
                            storageKeys: [storageKey]
                        }
                    ]
                },
                provider
            );
            const decoded = deserializeTransactionRequest(serialized);

            expect(serialized.from).to.equal(sender.address);
            expect(serialized.to).to.equal(recipient.address);
            expect(serialized.gasLimit).to.equal("0x5208");
            expect(decoded.nonce).to.equal(7);
            expect(decoded.value).to.equal(9n);
            expect(decoded.maxFeePerGas).to.equal(maxFeePerGas);
            expect(serialized.accessList?.[0].storageKeys[0]).to.equal(
                storageKey
            );
        });
    });

    it("reconstructs a native provider-backed transaction response", async () => {
        await withIsolatedHardhatNode(async (provider) => {
            const sender = await testAccount(provider, 0);
            const recipient = await testAccount(provider, 1);
            const original = await sender.sendTransaction({
                to: recipient.address,
                value: 5n
            });
            const restored = deserializeTransactionResponse(
                serializeTransactionResponse(original),
                provider
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
    });

    it("allows explicit client-side replacement detection", async () => {
        await assertIsolatedReplacementDetection();
    });

    it("rejects fields that cannot cross the runtime port", async () => {
        // the check runs before the provider is read: no node needed
        let serializationError: unknown;
        try {
            await serializeTransactionRequest(
                {
                    to: ethers.Wallet.createRandom().address,
                    customData: { transport: "private" }
                },
                null
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
