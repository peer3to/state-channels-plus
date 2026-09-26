// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { withRuntimeRpc } from "./RpcRouterFixture";
import {
    deserializeTransactionResponse,
    serializeTransactionResponse,
    type SerializedTransactionResponse
} from "@/rpc/internal/services/chainSigner/chainSignerSerialization";
import { withGasHeadroom } from "@/utils/gas";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertRuntimeSignerFields(
    inline: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const signer = sdk.instance.chainSigner;
        const address = await signer.getAddress();
        const bytes = new Uint8Array([0, 1, 127, 255]);
        const signature = await signer.signMessage(bytes);
        expect(ethers.verifyMessage(bytes, signature)).to.equal(address);
        const textSignature = await signer.signMessage("0x00017fff");
        expect(ethers.verifyMessage("0x00017fff", textSignature)).to.equal(
            address
        );
        expect(textSignature).not.to.equal(signature);
        const p2pSignature = await sdk.instance.p2pSigner.signMessage(bytes);
        expect(ethers.verifyMessage(bytes, p2pSignature)).to.equal(address);
        const p2pTextSignature =
            await sdk.instance.p2pSigner.signMessage("0x00017fff");
        expect(ethers.verifyMessage("0x00017fff", p2pTextSignature)).to.equal(
            address
        );
        expect(p2pSignature).not.to.equal(p2pTextSignature);
        const provider = signer.provider!;
        const fees = await provider.getFeeData();
        const recipient = ethers.Wallet.createRandom().address;
        const storageKey = ethers.ZeroHash;
        const response = await signer.sendTransaction({
            type: 2,
            to: recipient,
            value: 7n,
            data: ethers.hexlify(bytes),
            gasLimit: 30_000n,
            maxFeePerGas: fees.maxFeePerGas!,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas!,
            accessList: [{ address: recipient, storageKeys: [storageKey] }]
        });
        const receipt = await response.wait();
        expect(receipt?.status).to.equal(1);
        const mined = await provider.getTransaction(response.hash);
        if (!mined) throw new Error("Expected the mined runtime transaction");
        expect(response.hash).to.equal(mined.hash);
        expect(response.from).to.equal(address);
        expect(response.to).to.equal(recipient);
        expect(response.nonce).to.equal(mined.nonce);
        expect(response.type).to.equal(2);
        expect(response.value).to.equal(7n);
        expect(response.data).to.equal("0x00017fff");
        expect(response.gasLimit).to.equal(30_000n);
        expect(response.maxFeePerGas).to.equal(mined.maxFeePerGas);
        expect(response.maxPriorityFeePerGas).to.equal(
            mined.maxPriorityFeePerGas
        );
        expect(response.chainId).to.equal(mined.chainId);
        expect(response.accessList).to.deep.equal(mined.accessList);
        expect(response.signature.serialized).to.equal(
            mined.signature.serialized
        );
        expect(response.maxFeePerBlobGas).to.equal(null);
        expect(response.blobVersionedHashes).to.equal(null);
        const prepared = serializeTransactionResponse(mined);
        const cloned = await sdk.remote.runtimeProbe.echo(prepared).request();
        const restored = deserializeTransactionResponse(
            cloned as SerializedTransactionResponse,
            provider
        );
        expect(restored.toJSON()).to.deep.equal(mined.toJSON());
        expect(await restored.confirmations()).to.be.greaterThan(0);
    }, inline);
}

export async function assertRuntimeSignerGasHeadroom(
    inline: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const signer = sdk.instance.chainSigner;
        const provider = signer.provider!;
        const request = {
            to: ethers.Wallet.createRandom().address,
            value: 1n,
            data: "0x1234"
        };
        const estimate = await provider.estimateGas({
            ...request,
            from: await signer.getAddress()
        });
        // Explicit estimates and sends without a limit both carry the headroom,
        // whichever side of the runtime port holds the key.
        expect(await signer.estimateGas(request)).to.equal(
            withGasHeadroom(estimate)
        );
        const response = await signer.sendTransaction(request);
        expect((await response.wait())?.status).to.equal(1);
        expect(response.gasLimit).to.equal(withGasHeadroom(estimate));
    }, inline);
}
