import { expect } from "chai";

import { BlockCalldataStorage } from "@/storage/BlockCalldataStorage";
import * as factory from "../factory";

describe("BlockCalldataStorage", function () {
    it("returns calldata only for the exact signed block hash", function () {
        const storage = new BlockCalldataStorage();
        const block = factory.block();
        storage.storeBlockCalldata({
            signedBlock: block.signedBlock,
            onChainTimestamp: 123
        });

        expect(
            storage.getMatchingBlockCalldata(block)?.onChainTimestamp
        ).to.equal(123);

        const competing = factory.block({
            transaction: block.blockStruct.transaction,
            previousBlockHash: block.previousBlockHash
        });
        expect(storage.getMatchingBlockCalldata(competing)).to.be.undefined;
    });
});
