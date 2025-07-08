import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import Storage from "@/storage";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import * as factory from "../factory";

describe("Storage", () => {
    let storage: Storage;

    let mockStateSnapshot: StateSnapshotStruct;

    beforeEach(() => {
        storage = new Storage();

        mockStateSnapshot = factory.stateSnapshot();
    });

    describe("Cached State Operations", () => {
        it("should handle cached on-chain state snapshot", () => {
            expect(storage.getCachedOnChainStateSnapshot()).to.be.undefined;

            const timestamp = Math.floor(Date.now() / 1000);
            storage.setCachedOnChainStateSnapshot(mockStateSnapshot, timestamp);

            const cached = storage.getCachedOnChainStateSnapshot();
            expect(cached).to.deep.equal({
                stateSnapshot: mockStateSnapshot,
                timestamp
            });
        });
    });
});
