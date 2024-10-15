import { AddressLike, SignatureLike } from "ethers";

//Temporarry solution until AM is refactored and this logic extracted
type SignerAndSignature = {
    signerAddress: string;
    signature: SignatureLike;
};

class SignatureCollectionMap {
    private map: Map<string, SignerAndSignature[]> = new Map<
        string,
        SignerAndSignature[]
    >();

    public tryInsert(key: string, value: SignerAndSignature): void {
        if (!this.map.has(key)) {
            this.map.set(key, [value]);
        }
        let array = this.get(key);
        for (let i = 0; i < array.length; i++) {
            if (array[i].signerAddress === value.signerAddress) {
                return;
            }
        }
        array.push(value);
    }
    public didEveryoneSign(key: string, participants: AddressLike[]): boolean {
        let array = this.get(key);
        for (let i = 0; i < participants.length; i++) {
            let found = false;
            for (let j = 0; j < array.length; j++) {
                if (array[j].signerAddress === participants[i].toString()) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }
        return true;
    }
    public get(key: string): SignerAndSignature[] {
        return this.map.get(key) || [];
    }

    public has(key: string): boolean {
        return this.map.has(key);
    }

    public remove(key: string): void {
        this.map.delete(key);
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
        return Array.from(this.map.values());
    }

    public entries(): [string, SignerAndSignature[]][] {
        return Array.from(this.map.entries());
    }

    public delete(key: string): boolean {
        return this.map.delete(key);
    }

    public forEach(
        callback: (value: SignerAndSignature[], key: string) => void
    ): void {
        this.map.forEach(callback);
    }
}

export default SignatureCollectionMap;
