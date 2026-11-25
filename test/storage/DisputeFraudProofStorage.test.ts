import * as factory from "../factory";
import { DisputeFraudProofStorage } from "@/storage/DisputeFraudProofStorage";
import { expect } from "chai";
import { describe, it } from "mocha";

describe("DisputeFraudProofStorage", () => {
    it("keeps the first proof stored for a dispute", () => {
        const storage = new DisputeFraudProofStorage();
        const dispute = factory.dispute();
        const participant = factory.randomAddress();
        const first = {
            proofType: 0,
            participant,
            dispute,
            encodedProof: factory.hexString(24)
        };
        const firstHash = storage.storeFraudProof(first);

        const secondHash = storage.storeFraudProof({
            ...first,
            proofType: 1,
            encodedProof: factory.hexString(24)
        });

        expect(secondHash).to.equal(firstHash);
        expect(storage.getDisputeFraudProofForDispute(dispute)).to.deep.equal(
            first
        );
    });
});
