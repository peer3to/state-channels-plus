import { dispute, randomAddress } from "../factory";
import { TimeoutStorage } from "@/storage/TimeoutStorage";
import type { ForkId } from "@/types/types";
import { expect } from "chai";

const forkId = dispute().input.forkId as ForkId;
const refused = {
    ...dispute().input.timeout,
    participant: randomAddress(),
    blockHeight: 2n,
    isForced: false
};

describe("Unit: TimeoutStorage", function () {
    it("deleteTimeout with the stored plain timeout → removed", function () {
        const storage = new TimeoutStorage();
        storage.storeTimeout(forkId, { ...refused });

        storage.deleteTimeout(forkId, refused);

        expect(storage.getTimeout(forkId)).to.equal(undefined);
    });

    it("a forced timeout stored over the plain one at the same height → survives deleteTimeout", function () {
        const storage = new TimeoutStorage();
        const forced = { ...refused, isForced: true };
        storage.storeTimeout(forkId, { ...refused });
        storage.storeTimeout(forkId, forced);

        storage.deleteTimeout(forkId, refused);

        expect(storage.getTimeout(forkId)).to.deep.equal(forced);
    });

    it("deleteTimeout at another height → the stored plain timeout stays", function () {
        const storage = new TimeoutStorage();
        const stored = { ...refused, blockHeight: 3n };
        storage.storeTimeout(forkId, stored);

        storage.deleteTimeout(forkId, refused);

        expect(storage.getTimeout(forkId)).to.deep.equal(stored);
    });

    it("a plain timeout for another participant at the same height → survives deleteTimeout", function () {
        const storage = new TimeoutStorage();
        const other = { ...refused, participant: randomAddress() };
        storage.storeTimeout(forkId, other);

        storage.deleteTimeout(forkId, refused);

        expect(storage.getTimeout(forkId)).to.deep.equal(other);
    });
});
