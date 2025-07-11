import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import { DisputeStorage } from "@/storage/DisputeStorage";
import {
    DisputeConfirmationStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Hash } from "@/types/types";
import * as factory from "../factory";

const sig = () => ethers.hexlify(ethers.randomBytes(65));

describe("DisputeStorage", () => {
    let storage: DisputeStorage;
    let mockSignedDispute: SignedDisputeStruct;
    let mockDisputeConfirmation: DisputeConfirmationStruct;
    let mockDisputeHash: Hash;

    beforeEach(() => {
        storage = new DisputeStorage();

        mockSignedDispute = factory.signedDispute();
        mockDisputeConfirmation = {
            signedDispute: mockSignedDispute,
            signatures: []
        };
        mockDisputeHash = ethers.keccak256(mockSignedDispute.encodedDispute);
    });

    describe("CREATE - storeDispute()", () => {
        it("should store SignedDispute with auto-computed hash and return hash with empty signatures", () => {
            const hash = storage.storeDispute(mockSignedDispute);

            expect(hash).to.equal(mockDisputeHash);
            const stored = storage.getDisputeConfirmation(hash);
            expect(stored?.signedDispute).to.equal(mockSignedDispute);
            expect(stored?.signatures).to.deep.equal([]);
        });

        it("should store SignedDispute with provided hash", () => {
            const customHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeDispute(mockSignedDispute, customHash);

            expect(hash).to.equal(customHash);
            const stored = storage.getDisputeConfirmation(customHash);
            expect(stored?.signedDispute).to.equal(mockSignedDispute);
            expect(stored?.signatures).to.deep.equal([]);
        });

        it("should return same hash on duplicate insert and preserve existing signatures", () => {
            // First store with empty signatures
            const hash1 = storage.storeDispute(
                mockSignedDispute,
                mockDisputeHash
            );
            expect(hash1).to.equal(mockDisputeHash);

            // Add some signatures to the existing dispute
            const existingDispute =
                storage.getDisputeConfirmation(mockDisputeHash);
            const signature1 = sig();
            const signature2 = sig();
            existingDispute!.signatures = [signature1, signature2];

            // Second store should preserve existing signatures
            const hash2 = storage.storeDispute(
                mockSignedDispute,
                mockDisputeHash
            );
            expect(hash2).to.equal(mockDisputeHash);

            const stored = storage.getDisputeConfirmation(mockDisputeHash);
            expect(stored?.signatures).to.deep.equal([signature1, signature2]);
        });
    });

    describe("CREATE - storeDisputeConfirmation()", () => {
        it("should store DisputeConfirmation with auto-computed hash", () => {
            const hash = storage.storeDisputeConfirmation(
                mockDisputeConfirmation
            );

            expect(hash).to.equal(mockDisputeHash);
            const stored = storage.getDisputeConfirmation(hash);
            expect(stored).to.equal(mockDisputeConfirmation);
        });

        it("should store DisputeConfirmation with provided hash", () => {
            const customHash = ethers.hexlify(ethers.randomBytes(32));
            const hash = storage.storeDisputeConfirmation(
                mockDisputeConfirmation,
                customHash
            );

            expect(hash).to.equal(customHash);
            const stored = storage.getDisputeConfirmation(customHash);
            expect(stored).to.equal(mockDisputeConfirmation);
        });

        it("should merge signatures with deduplication on duplicate insert", () => {
            // Create shared and unique signatures
            const sharedSignature = sig();
            const uniqueSignature1 = sig();
            const uniqueSignature2 = sig();

            // First dispute confirmation with shared + unique signature
            const firstDisputeConfirmation = {
                ...mockDisputeConfirmation,
                signatures: [sharedSignature, uniqueSignature1]
            };

            const hash1 = storage.storeDisputeConfirmation(
                firstDisputeConfirmation,
                mockDisputeHash
            );

            // Second dispute confirmation with same shared signature + different unique signature
            const secondDisputeConfirmation = {
                ...mockDisputeConfirmation,
                signatures: [sharedSignature, uniqueSignature2]
            };

            const hash2 = storage.storeDisputeConfirmation(
                secondDisputeConfirmation,
                mockDisputeHash
            );

            // Should return same hash
            expect(hash1).to.equal(hash2);

            const stored = storage.getDisputeConfirmation(hash1);

            // Should have 3 unique signatures (shared signature not duplicated)
            expect(stored?.signatures).to.have.lengthOf(3);
            expect(stored?.signatures).to.include.members([
                sharedSignature,
                uniqueSignature1,
                uniqueSignature2
            ]);

            // Verify no duplicates
            const signatureSet = new Set(stored?.signatures);
            expect(signatureSet.size).to.equal(stored?.signatures.length);
        });

        it("should handle empty signatures array", () => {
            const disputeWithEmptySignatures = {
                ...mockDisputeConfirmation,
                signatures: []
            };

            const hash = storage.storeDisputeConfirmation(
                disputeWithEmptySignatures,
                mockDisputeHash
            );

            const stored = storage.getDisputeConfirmation(hash);
            expect(stored?.signatures).to.deep.equal([]);
        });

        it("should preserve original SignedDispute when merging signatures", () => {
            // Store first dispute
            const hash1 = storage.storeDisputeConfirmation(
                mockDisputeConfirmation,
                mockDisputeHash
            );

            // Create a second dispute with different SignedDispute but same hash
            const differentSignedDispute = factory.signedDispute();
            const secondDispute = {
                signedDispute: differentSignedDispute,
                signatures: [sig()]
            };

            // Store second dispute with same hash
            const hash2 = storage.storeDisputeConfirmation(
                secondDispute,
                mockDisputeHash
            );

            expect(hash1).to.equal(hash2);

            const stored = storage.getDisputeConfirmation(hash1);
            // Should preserve the original SignedDispute
            expect(stored?.signedDispute).to.equal(mockSignedDispute);
            // Should have merged signatures
            expect(stored?.signatures.length).to.be.greaterThan(
                mockDisputeConfirmation.signatures.length
            );
        });
    });

    describe("READ - getDisputeConfirmation()", () => {
        beforeEach(() => {
            storage.storeDisputeConfirmation(
                mockDisputeConfirmation,
                mockDisputeHash
            );
        });

        it("should get dispute confirmation by hash", () => {
            const result = storage.getDisputeConfirmation(mockDisputeHash);
            expect(result).to.equal(mockDisputeConfirmation);
        });

        it("should return undefined for non-existent dispute", () => {
            const nonExistentHash = ethers.hexlify(ethers.randomBytes(32));
            expect(storage.getDisputeConfirmation(nonExistentHash)).to.be
                .undefined;
        });
    });

    describe("Edge cases and behavior", () => {
        it("should handle multiple different disputes", () => {
            const dispute1 = factory.signedDispute();
            const dispute2 = factory.signedDispute();
            const dispute3 = factory.signedDispute();

            const hash1 = storage.storeDispute(dispute1);
            const hash2 = storage.storeDispute(dispute2);
            const hash3 = storage.storeDispute(dispute3);

            // All hashes should be different
            expect(hash1).to.not.equal(hash2);
            expect(hash2).to.not.equal(hash3);
            expect(hash1).to.not.equal(hash3);

            // All disputes should be retrievable
            expect(
                storage.getDisputeConfirmation(hash1)?.signedDispute
            ).to.equal(dispute1);
            expect(
                storage.getDisputeConfirmation(hash2)?.signedDispute
            ).to.equal(dispute2);
            expect(
                storage.getDisputeConfirmation(hash3)?.signedDispute
            ).to.equal(dispute3);
        });

        it("should maintain signatures across different storage methods", () => {
            // Store with storeDispute first
            const hash1 = storage.storeDispute(
                mockSignedDispute,
                mockDisputeHash
            );

            // Add a signature through storeDisputeConfirmation
            const disputeWithSignature = {
                signedDispute: mockSignedDispute,
                signatures: [sig()]
            };

            const hash2 = storage.storeDisputeConfirmation(
                disputeWithSignature,
                mockDisputeHash
            );

            expect(hash1).to.equal(hash2);

            const stored = storage.getDisputeConfirmation(hash1);
            expect(stored?.signatures).to.have.lengthOf(1);
        });

        it("should handle large signature arrays efficiently", () => {
            const largeSignatureArray = Array.from({ length: 100 }, () =>
                sig()
            );
            const disputeWithManySignatures = {
                ...mockDisputeConfirmation,
                signatures: largeSignatureArray
            };

            const hash = storage.storeDisputeConfirmation(
                disputeWithManySignatures,
                mockDisputeHash
            );

            const stored = storage.getDisputeConfirmation(hash);
            expect(stored?.signatures).to.have.lengthOf(100);
            expect(stored?.signatures).to.deep.equal(largeSignatureArray);
        });
    });
});
