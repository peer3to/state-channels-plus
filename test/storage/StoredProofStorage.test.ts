import * as factory from "../factory";
import Storage from "@/storage";
import { expect } from "chai";
import { describe, it } from "mocha";

describe("StoredProofStorage", () => {
    it("holds no stored proof before one is set", () => {
        const storedProofs = new Storage().storedProofs;

        expect(storedProofs.get(factory.hash())).to.equal(undefined);
    });

    it("returns the proof set for its fork", () => {
        const storedProofs = new Storage().storedProofs;
        const forkId = factory.hash();
        const proof = factory.storedProof(forkId, 2);

        storedProofs.set(forkId, proof);

        expect(storedProofs.get(forkId)).to.deep.equal(proof);
    });

    it("replaces the proof of the same fork with the later one", () => {
        const storedProofs = new Storage().storedProofs;
        const forkId = factory.hash();
        const earlier = factory.storedProof(forkId, 1);
        const later = factory.storedProof(forkId, 2);

        storedProofs.set(forkId, earlier);
        storedProofs.set(forkId, later);

        expect(storedProofs.get(forkId)).to.deep.equal(later);
    });

    it("drops the previous fork's proof when a proof of another fork is set", () => {
        const storedProofs = new Storage().storedProofs;
        const previousForkId = factory.hash();
        const nextForkId = factory.hash();
        const nextProof = factory.storedProof(nextForkId, 0);

        storedProofs.set(
            previousForkId,
            factory.storedProof(previousForkId, 1)
        );
        storedProofs.set(nextForkId, nextProof);

        expect(storedProofs.get(previousForkId)).to.equal(undefined);
        expect(storedProofs.get(nextForkId)).to.deep.equal(nextProof);
    });

    it("returns nothing for a fork other than the stored one", () => {
        const storedProofs = new Storage().storedProofs;
        const forkId = factory.hash();

        storedProofs.set(forkId, factory.storedProof(forkId, 1));

        expect(storedProofs.get(factory.hash())).to.equal(undefined);
    });

    it("keeps the stored proof unchanged when the caller mutates the value it set or read", () => {
        const storedProofs = new Storage().storedProofs;
        const forkId = factory.hash();
        const proof = factory.storedProof(forkId, 1);
        const expected = structuredClone(proof);

        storedProofs.set(forkId, proof);
        proof.hops[0].milestone.blockConfirmations.pop();
        storedProofs.get(forkId)!.finalizedSnapshot.blockHeight = 999n;

        expect(storedProofs.get(forkId)).to.deep.equal(expected);
    });
});
