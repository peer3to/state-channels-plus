import { expect } from "chai";
import { Codec, Type } from "@/utils/Codec";

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

        describe("Error handling", () => {
            it("should throw error for invalid type in encode", () => {
                expect(() => {
                    Codec.encode({}, 999 as Type);
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
