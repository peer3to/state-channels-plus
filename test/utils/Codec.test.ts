import { expect } from "chai";
import { Codec, Type } from "@/utils/Codec";
import { DisputeFraudProofType } from "@/types/sol-enums";

import * as factory from "../factory";

describe("Codec", () => {
    describe("Round-trip encoding/decoding: decode(encode(T)) === T", () => {
        it("should encode and decode BlockStruct correctly", () => {
            const original = factory.block().blockStruct;
            const encoded = Codec.encode(original, Type.Block);
            const decoded = Codec.decode(encoded, Type.Block);

            expect(decoded).to.deep.equal(original);
        });

        it("should encode and decode JoinChannelStruct correctly", () => {
            const original = factory.joinChannel();

            const encoded = Codec.encode(original, Type.JoinChannel);
            const decoded = Codec.decode(encoded, Type.JoinChannel);

            expect(decoded).to.deep.equal(original);
        });

        it("should encode and decode SignedJoinChannelStruct correctly", () => {
            const original = {
                encodedJoinChannel: Codec.encode(
                    factory.joinChannel(),
                    Type.JoinChannel
                ),
                signature: `0x${"11".repeat(65)}`
            };

            const encoded = Codec.encode(original, Type.SignedJoinChannel);
            const decoded = Codec.decode(encoded, Type.SignedJoinChannel);

            expect(decoded).to.deep.equal(original);
        });

        it("should encode and decode JoinChannelConfirmationStruct correctly", () => {
            const original = {
                signedJoinChannel: {
                    encodedJoinChannel: Codec.encode(
                        factory.joinChannel(),
                        Type.JoinChannel
                    ),
                    signature: `0x${"11".repeat(65)}`
                },
                signatures: [`0x${"22".repeat(65)}`, `0x${"33".repeat(65)}`]
            };

            const encoded = Codec.encode(
                original,
                Type.JoinChannelConfirmation
            );
            const decoded = Codec.decode(encoded, Type.JoinChannelConfirmation);

            expect(decoded).to.deep.equal(original);
        });

        it("should encode and decode TransactionStruct correctly", () => {
            const original = factory.transaction();

            const encoded = Codec.encode(original, Type.Transaction);
            const decoded = Codec.decode(encoded, Type.Transaction);

            expect(decoded).to.deep.equal(original);
        });

        it("should encode and decode DisputeStruct correctly", () => {
            const original = factory.dispute();

            const encoded = Codec.encode(original, Type.Dispute);
            const decoded = Codec.decode(encoded, Type.Dispute);

            expect(decoded).to.deep.equal(original);
        });

        it("round-trips DisputeBlockAuthorNotParticipant proof", () => {
            const original = {
                blockIndexInUnfinalizedPartOfStateProof: 2n,
                previousBlock: factory.signedBlock(),
                previousStateSnapshot: factory.stateSnapshot().toStruct(),
                resultingStateSnapshot: factory.stateSnapshot().toStruct()
            };
            const encoded = Codec.encode(
                original,
                DisputeFraudProofType.DisputeBlockAuthorNotParticipant
            );
            expect(
                Codec.decode(
                    encoded,
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant
                )
            ).to.deep.equal(original);
        });

        it("round-trips DisputeInvalidBlockStructure proof", () => {
            const original = {
                blockIndexInUnfinalizedPartOfStateProof: 2n
            };
            const encoded = Codec.encode(
                original,
                DisputeFraudProofType.DisputeInvalidBlockStructure
            );
            expect(
                Codec.decode(
                    encoded,
                    DisputeFraudProofType.DisputeInvalidBlockStructure
                )
            ).to.deep.equal(original);
        });

        describe("Error handling", () => {
            it("should throw error for invalid type in encode", () => {
                expect(() => {
                    Codec.encode({} as any, 999 as Type);
                }).to.throw("No ethers type mapping found");
            });

            it("should throw error for invalid encoded data", () => {
                expect(() => {
                    Codec.decode("0xinvaliddata", Type.Block);
                }).to.throw();
            });
        });
    });
});
