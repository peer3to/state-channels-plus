import { Address, Bytes, Signature } from "@/types/types";

//Temporarry solution until AM is refactored and this logic extracted
type SignerAndSignature = {
    signerAddress: Address;
    signature: Signature | Bytes;
};

type EncodedJoinChannel = Bytes;

type options = {
    timeoutMs?: number;
};

export class SignatureCollectionMap {
    // Replace array with a nested Map: signerAddress -> signature
    private map: Map<EncodedJoinChannel, Map<Address, Signature>> = new Map();
    // Optional timeout tracking
    private timeouts: Map<EncodedJoinChannel, NodeJS.Timeout> = new Map();

    public tryInsert(
        key: EncodedJoinChannel,
        value: SignerAndSignature,
        options?: options
    ): void {
        if (!this.map.has(key)) {
            this.map.set(key, new Map());
        }

        // Get the inner map and add the signature if not already present
        const innerMap = this.map.get(key)!;
        if (!innerMap.has(value.signerAddress)) {
            innerMap.set(value.signerAddress, value.signature as Signature);
        }
        if (options?.timeoutMs) {
            this.setTimeout(key, options.timeoutMs);
        }
    }

    public setTimeout(key: EncodedJoinChannel, timeoutMs: number): void {
        // Clear existing timeout if any
        this.clearTimeout(key);

        // Set new timeout
        const timeoutId = setTimeout(() => {
            this.delete(key);
        }, timeoutMs);

        this.timeouts.set(key, timeoutId);
    }

    private clearTimeout(key: EncodedJoinChannel): void {
        const existingTimeout = this.timeouts.get(key);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            this.timeouts.delete(key);
        }
    }

    public didEveryoneSign(
        key: EncodedJoinChannel,
        participants: Address[]
    ): boolean {
        const innerMap = this.map.get(key);
        if (!innerMap) return false;

        // Check if every participant has a signature
        return participants.every((participant) => innerMap.has(participant));
    }

    public get(key: EncodedJoinChannel): Map<Address, Signature> | undefined {
        return this.map.get(key);
    }

    public hasSignature(
        key: EncodedJoinChannel,
        signerAddress: Address
    ): boolean {
        const innerMap = this.map.get(key);
        return innerMap ? innerMap.has(signerAddress) : false;
    }

    // Get just the signatures for a key
    public getSignatures(key: EncodedJoinChannel): Signature[] {
        const innerMap = this.map.get(key);
        if (!innerMap) return [];
        return Array.from(innerMap.values());
    }

    public has(key: EncodedJoinChannel): boolean {
        return this.map.has(key);
    }

    public delete(key: EncodedJoinChannel): boolean {
        this.clearTimeout(key);
        return this.map.delete(key);
    }

    public clear(): void {
        // Clear all timeouts
        this.timeouts.forEach((timeout) => clearTimeout(timeout));
        this.timeouts.clear();
        this.map.clear();
    }

    public size(): number {
        return this.map.size;
    }

    public keys(): EncodedJoinChannel[] {
        return Array.from(this.map.keys());
    }

    public values(): SignerAndSignature[][] {
        // Convert each inner Map to SignerAndSignature[]
        return Array.from(this.map.values()).map((innerMap) =>
            Array.from(innerMap.entries()).map(
                ([signerAddress, signature]) => ({
                    signerAddress,
                    signature
                })
            )
        );
    }

    public entries(): [EncodedJoinChannel, SignerAndSignature[]][] {
        return Array.from(this.map.entries()).map(([key, innerMap]) => [
            key,
            Array.from(innerMap.entries()).map(
                ([signerAddress, signature]) => ({
                    signerAddress,
                    signature
                })
            )
        ]);
    }

    public forEach(
        callback: (value: SignerAndSignature[], key: EncodedJoinChannel) => void
    ): void {
        this.map.forEach((innerMap, key) => {
            const signerAndSignatures = Array.from(innerMap.entries()).map(
                ([signerAddress, signature]) => ({
                    signerAddress,
                    signature
                })
            );
            callback(signerAndSignatures, key);
        });
    }
}
