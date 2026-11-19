import {
    dispute,
    disputeFraudProof,
    fraudProof,
    randomAddress
} from "../factory";
import { DisputeFraudProofStorage } from "@/storage/DisputeFraudProofStorage";
import { FraudProofStorage } from "@/storage/FraudProofStorage";
import { expect } from "chai";

describe("Unit: FraudProofStorage", function () {
    it("stores a fraud proof and reads it back by content hash", function () {
        const storage = new FraudProofStorage();
        const proof = fraudProof();

        const proofHash = storage.storeFraudProof(proof);

        expect(storage.getFraudProofByHash(proofHash)).to.deep.equal(proof);
        expect(
            storage.getFraudProofsForParticipant(proof.participant as string)
        ).to.deep.equal([proof]);
    });

    it("re-storing the identical proof is a no-op", function () {
        const storage = new FraudProofStorage();
        const proof = fraudProof();

        const firstHash = storage.storeFraudProof(proof);
        const secondHash = storage.storeFraudProof({ ...proof });

        expect(secondHash).to.equal(firstHash);
        expect(storage.getFraudProofByHash(firstHash)).to.deep.equal(proof);
    });

    it("keeps the participant index consistent when the same encoded proof is re-stored under a different participant", function () {
        const storage = new FraudProofStorage();
        const participantA = randomAddress();
        const participantB = randomAddress();
        const original = fraudProof({ participant: participantA });
        const collidingRestore = {
            ...original,
            participant: participantB
        };

        const proofHash = storage.storeFraudProof(original);
        const restoreHash = storage.storeFraudProof(collidingRestore);

        expect(restoreHash).to.equal(proofHash);
        expect(
            storage.getFraudProofsForParticipant(participantA)
        ).to.deep.equal([original]);
        expect(
            storage.getFraudProofsForParticipant(participantB)
        ).to.deep.equal([]);
        expect(storage.getFraudProofByHash(proofHash)!.participant).to.equal(
            participantA
        );
    });

    it("indexes multiple distinct proofs for one participant", function () {
        const storage = new FraudProofStorage();
        const participant = randomAddress();
        const proofOne = fraudProof({ participant });
        const proofTwo = fraudProof({ participant });

        const hashOne = storage.storeFraudProof(proofOne);
        const hashTwo = storage.storeFraudProof(proofTwo);

        expect(hashOne).to.not.equal(hashTwo);
        expect(storage.getFraudProofByHash(hashOne)).to.deep.equal(proofOne);
        expect(storage.getFraudProofByHash(hashTwo)).to.deep.equal(proofTwo);
        expect(storage.getFraudProofsForParticipant(participant)).to.deep.equal(
            [proofOne, proofTwo]
        );
    });

    it("returns no proofs for a participant with no stored proof", function () {
        const storage = new FraudProofStorage();

        expect(
            storage.getFraudProofsForParticipant(randomAddress())
        ).to.deep.equal([]);
    });

    it("DisputeFraudProofStorage: second proof for the same dispute is dropped", function () {
        const storage = new DisputeFraudProofStorage();
        const theDispute = dispute();
        const firstProof = disputeFraudProof(theDispute);
        const secondProof = disputeFraudProof(theDispute, {
            participant: randomAddress()
        });

        storage.storeFraudProof(firstProof);
        storage.storeFraudProof(secondProof);

        expect(
            storage.getDisputeFraudProofForDispute(theDispute)
        ).to.deep.equal(firstProof);
    });
});
