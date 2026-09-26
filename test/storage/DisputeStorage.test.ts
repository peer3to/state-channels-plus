import * as factory from "../factory";
import {
    DisputeConfirmationOrigin,
    DisputeStorage
} from "@/storage/DisputeStorage";
import { Hash } from "@/types/types";
import {
    DisputeConfirmationStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, beforeEach } from "mocha";

const SYNC = { origin: DisputeConfirmationOrigin.SYNC };
const CHAIN_EVENT = { origin: DisputeConfirmationOrigin.CHAIN_EVENT };

// A co-signature by a fresh signer over the dispute hash.
const coSignature = (disputeHash: Hash) =>
    factory.randomWallet().signMessageSync(ethers.getBytes(disputeHash));

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

    describe("CREATE - storeDisputeConfirmation()", () => {
        it("should store DisputeConfirmation with auto-computed hash", () => {
            const hash = storage.storeDisputeConfirmation(
                mockDisputeConfirmation,
                SYNC
            );

            expect(hash).to.equal(mockDisputeHash);
            const stored = storage.getDisputeConfirmation(hash);
            expect(stored).to.equal(mockDisputeConfirmation);
        });

        it("stores the first copy of a dispute with exactly its signatures", () => {
            const firstSignatures = [
                coSignature(mockDisputeHash),
                coSignature(mockDisputeHash)
            ];

            const hash = storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: firstSignatures
                },
                SYNC
            );

            expect(hash).to.equal(mockDisputeHash);
            expect(
                storage.getDisputeConfirmation(mockDisputeHash)?.signatures
            ).to.deep.equal(firstSignatures);
        });

        it("ignores a later sync copy that carries extra signatures", () => {
            const firstSignature = coSignature(mockDisputeHash);
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [firstSignature]
                },
                SYNC
            );

            const hash = storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [
                        firstSignature,
                        coSignature(mockDisputeHash),
                        coSignature(mockDisputeHash)
                    ]
                },
                SYNC
            );

            expect(hash).to.equal(mockDisputeHash);
            expect(
                storage.getDisputeConfirmation(mockDisputeHash)?.signatures
            ).to.deep.equal([firstSignature]);
        });

        it("does not grow the stored signatures across repeated sync copies", () => {
            const firstSignature = coSignature(mockDisputeHash);
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [firstSignature]
                },
                SYNC
            );

            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [coSignature(mockDisputeHash)]
                },
                SYNC
            );
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [coSignature(mockDisputeHash)]
                },
                SYNC
            );
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [coSignature(mockDisputeHash)]
                },
                SYNC
            );

            expect(
                storage.getDisputeConfirmation(mockDisputeHash)?.signatures
            ).to.deep.equal([firstSignature]);
        });

        it("replaces a stored sync copy with a chain event copy", () => {
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [
                        coSignature(mockDisputeHash),
                        coSignature(mockDisputeHash)
                    ]
                },
                SYNC
            );
            const chainSignature = coSignature(mockDisputeHash);

            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [chainSignature]
                },
                CHAIN_EVENT
            );

            expect(
                storage.getDisputeConfirmation(mockDisputeHash)?.signatures
            ).to.deep.equal([chainSignature]);
        });

        it("ignores a sync copy that arrives after a chain event copy", () => {
            const chainSignature = coSignature(mockDisputeHash);
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [chainSignature]
                },
                CHAIN_EVENT
            );

            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [coSignature(mockDisputeHash)]
                },
                SYNC
            );

            expect(
                storage.getDisputeConfirmation(mockDisputeHash)?.signatures
            ).to.deep.equal([chainSignature]);
        });

        it("keeps the first chain event copy when a second chain event copy arrives", () => {
            const firstChainSignature = coSignature(mockDisputeHash);
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [firstChainSignature]
                },
                CHAIN_EVENT
            );

            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [coSignature(mockDisputeHash)]
                },
                CHAIN_EVENT
            );

            expect(
                storage.getDisputeConfirmation(mockDisputeHash)?.signatures
            ).to.deep.equal([firstChainSignature]);
        });

        it("keeps copies for different dispute hashes independent", () => {
            const otherSignedDispute = factory.signedDispute();
            const otherDisputeHash = ethers.keccak256(
                otherSignedDispute.encodedDispute
            );
            const firstSignature = coSignature(mockDisputeHash);
            const otherSignature = coSignature(otherDisputeHash);
            storage.storeDisputeConfirmation(
                {
                    signedDispute: mockSignedDispute,
                    signatures: [firstSignature]
                },
                SYNC
            );

            storage.storeDisputeConfirmation(
                {
                    signedDispute: otherSignedDispute,
                    signatures: [otherSignature]
                },
                SYNC
            );

            expect(otherDisputeHash).to.not.equal(mockDisputeHash);
            expect(
                storage.getDisputeConfirmation(mockDisputeHash)?.signatures
            ).to.deep.equal([firstSignature]);
            expect(
                storage.getDisputeConfirmation(otherDisputeHash)?.signatures
            ).to.deep.equal([otherSignature]);
        });

        it("re-storing an identical sync confirmation leaves the stored copy unchanged", () => {
            const firstCopy = {
                signedDispute: mockSignedDispute,
                signatures: [coSignature(mockDisputeHash)]
            };
            storage.storeDisputeConfirmation(firstCopy, SYNC);

            const hash = storage.storeDisputeConfirmation(
                {
                    signedDispute: { ...mockSignedDispute },
                    signatures: [...firstCopy.signatures]
                },
                SYNC
            );

            expect(hash).to.equal(mockDisputeHash);
            expect(storage.getDisputeConfirmation(mockDisputeHash)).to.equal(
                firstCopy
            );
        });

        it("re-storing an identical chain event confirmation leaves the stored copy unchanged", () => {
            const firstCopy = {
                signedDispute: mockSignedDispute,
                signatures: [coSignature(mockDisputeHash)]
            };
            storage.storeDisputeConfirmation(firstCopy, CHAIN_EVENT);

            const hash = storage.storeDisputeConfirmation(
                {
                    signedDispute: { ...mockSignedDispute },
                    signatures: [...firstCopy.signatures]
                },
                CHAIN_EVENT
            );

            expect(hash).to.equal(mockDisputeHash);
            expect(storage.getDisputeConfirmation(mockDisputeHash)).to.equal(
                firstCopy
            );
        });
    });

    describe("READ - getDisputeConfirmation()", () => {
        beforeEach(() => {
            storage.storeDisputeConfirmation(mockDisputeConfirmation, SYNC);
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

            const hash1 = storage.storeDisputeConfirmation(
                { signedDispute: dispute1, signatures: [] },
                CHAIN_EVENT
            );
            const hash2 = storage.storeDisputeConfirmation(
                { signedDispute: dispute2, signatures: [] },
                CHAIN_EVENT
            );
            const hash3 = storage.storeDisputeConfirmation(
                { signedDispute: dispute3, signatures: [] },
                CHAIN_EVENT
            );

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

        it("should handle large signature arrays efficiently", () => {
            const largeSignatureArray = Array.from({ length: 100 }, () =>
                coSignature(mockDisputeHash)
            );
            const disputeWithManySignatures = {
                ...mockDisputeConfirmation,
                signatures: largeSignatureArray
            };

            const hash = storage.storeDisputeConfirmation(
                disputeWithManySignatures,
                CHAIN_EVENT
            );

            const stored = storage.getDisputeConfirmation(hash);
            expect(stored?.signatures).to.have.lengthOf(100);
            expect(stored?.signatures).to.deep.equal(largeSignatureArray);
        });
    });
});
