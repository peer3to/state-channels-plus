import { expect } from "chai";
import { Signer } from "ethers";

import ManagedNonceSigner from "@/evm/signer/ManagedNonceSigner";

/**
 * Minimal stand-in for the inner ethers.Signer: records the nonces it is asked
 * to send and can be told to throw on a specific send. Cast to Signer for the
 * wrapper's constructor — only `provider`, `getNonce`, and `sendTransaction` are
 * exercised.
 */
class FakeSigner {
    provider = null;
    sentNonces: (number | undefined)[] = [];
    pendingNonceCalls = 0;

    constructor(
        private readonly baseline: number,
        private readonly throwOnCall: number | null
    ) {}

    async getNonce(blockTag?: string): Promise<number> {
        if (blockTag === "pending") this.pendingNonceCalls++;
        return this.baseline;
    }

    async sendTransaction(tx: { nonce?: number }): Promise<unknown> {
        const call = this.sentNonces.length + 1;
        this.sentNonces.push(tx.nonce);
        if (this.throwOnCall === call) {
            throw new Error(`fake send failure on call ${call}`);
        }
        return { hash: `0xhash${call}`, nonce: tx.nonce };
    }
}

const asSigner = (fake: FakeSigner) => fake as unknown as Signer;

describe("ManagedNonceSigner", () => {
    it("reuses the nonce after a failed send so no gap forms", async () => {
        // Baseline 0; the 2nd send throws (e.g. a pre-send estimateGas revert).
        const fake = new FakeSigner(0, 2);
        const signer = new ManagedNonceSigner(asSigner(fake));

        const results = await Promise.allSettled([
            signer.sendTransaction({ to: "0x01" }),
            signer.sendTransaction({ to: "0x02" }),
            signer.sendTransaction({ to: "0x03" })
        ]);

        // The mutex serializes assignment in call order: send 1 → nonce 0 (ok,
        // advance), send 2 → nonce 1 (throws, no advance), send 3 → nonce 1 again.
        expect(fake.sentNonces).to.deep.equal([0, 1, 1]);
        expect(results.map((r) => r.status)).to.deep.equal([
            "fulfilled",
            "rejected",
            "fulfilled"
        ]);

        // A subsequent send advances past the reused nonce — counter is intact.
        await signer.sendTransaction({ to: "0x04" });
        expect(fake.sentNonces).to.deep.equal([0, 1, 1, 2]);

        // Baseline is fetched from "pending" exactly once (lazy init).
        expect(fake.pendingNonceCalls).to.equal(1);
    });

    it("assigns sequential nonces from the pending baseline", async () => {
        const fake = new FakeSigner(5, null);
        const signer = new ManagedNonceSigner(asSigner(fake));

        await signer.sendTransaction({ to: "0x01" });
        await signer.sendTransaction({ to: "0x02" });
        await signer.sendTransaction({ to: "0x03" });

        expect(fake.sentNonces).to.deep.equal([5, 6, 7]);
    });
});
