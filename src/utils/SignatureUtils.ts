import { BytesLike, ethers, SignatureLike } from "ethers";

import { Codec } from "./Codec";

export class SignatureUtils {
    public static signMsg(
        msg: BytesLike,
        signer: ethers.Signer
    ): Promise<string> {
        const hash = ethers.keccak256(msg);
        const encodedHashBytes = ethers.getBytes(hash);
        return signer.signMessage(encodedHashBytes);
    }

    public static getSignerAddressFromMsg(
        msg: BytesLike,
        signature: SignatureLike
    ): string {
        return ethers.verifyMessage(
            ethers.getBytes(ethers.keccak256(msg)),
            signature
        );
    }

    public static getSignerAddress(obj: any, signature: SignatureLike): string {
        const encoded = Codec.encode(obj);
        return this.getSignerAddressFromMsg(encoded, signature);
    }

    public static async sign(
        obj: any,
        signer: ethers.Signer
    ): Promise<{ encoded: BytesLike; signature: string }> {
        const encoded = Codec.encode(obj);
        const signature = await this.signMsg(encoded, signer);
        return { encoded, signature };
    }
}
