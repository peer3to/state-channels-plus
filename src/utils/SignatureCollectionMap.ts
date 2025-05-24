import { AddressLike, SignatureLike } from "ethers";

//Temporarry solution until AM is refactored and this logic extracted
type SignerAndSignature = {
    signerAddress: string;
    signature: SignatureLike;
};

export class SignatureCollectionMap {
    // Replace array with a nested Map: signerAddress -> signature
    private map: Map<string, Map<string, SignatureLike>> = new Map();

    public tryInsert(key: string, value: SignerAndSignature): void {
        if (!this.map.has(key)) {
            this.map.set(key, new Map());
        }

        // Get the inner map and add the signature if not already present
        const innerMap = this.map.get(key)!;
        if (!innerMap.has(value.signerAddress)) {
            innerMap.set(value.signerAddress, value.signature);
        }
    }

    public didEveryoneSign(key: string, participants: AddressLike[]): boolean {
        const innerMap = this.map.get(key);
        if (!innerMap) return false;

        // Check if every participant has a signature
        return participants.every((participant) =>
            innerMap.has(participant.toString())
        );
    }

    public get(key: string): Map<string, SignatureLike> | undefined {
        return this.map.get(key);
    }

    public hasSignature(key: string, signerAddress: string): boolean {
        const innerMap = this.map.get(key);
        return innerMap ? innerMap.has(signerAddress) : false;
    }

    // Get just the signatures for a key
    public getSignatures(key: string): SignatureLike[] {
        const innerMap = this.map.get(key);
        if (!innerMap) return [];
        return Array.from(innerMap.values());
    }

    public has(key: string): boolean {
        return this.map.has(key);
    }

    public delete(key: string): boolean {
        return this.map.delete(key);
    }

    public clear(): void {
        this.map.clear();
    }

    public size(): number {
        return this.map.size;
    }

    public keys(): string[] {
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

    public entries(): [string, SignerAndSignature[]][] {
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
        callback: (value: SignerAndSignature[], key: string) => void
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
