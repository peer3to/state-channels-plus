import { ForceJoinStorage } from "@/storage/ForceJoinStorage";
import { expect } from "chai";
import { describe, it } from "mocha";

describe("ForceJoinStorage - join record", () => {
    it("a fresh storage holds no join", () => {
        expect(new ForceJoinStorage().getJoin()).to.equal(undefined);
    });

    it("a started join reads back with its initial fields, an update by its id changes it, and clear removes it", () => {
        const storage = new ForceJoinStorage();
        const join = storage.startJoin(7, 1_000);

        expect(storage.getJoin()).to.deep.equal({
            id: join.id,
            submissionHeight: 7,
            authorizationDeadline: 1_000,
            isForceJoinDeadlinePassed: false,
            isDisputeStarted: false
        });

        expect(
            storage.updateJoin(join.id, {
                countingStartsAt: 50,
                countingFromHeight: 9,
                latestCountedHeight: 12,
                isForceJoinDeadlinePassed: true,
                isDisputeStarted: true,
                isRetrying: true
            })
        ).to.equal(true);
        expect(storage.getJoin()).to.deep.equal({
            id: join.id,
            submissionHeight: 7,
            authorizationDeadline: 1_000,
            countingStartsAt: 50,
            countingFromHeight: 9,
            latestCountedHeight: 12,
            isForceJoinDeadlinePassed: true,
            isDisputeStarted: true,
            isRetrying: true
        });

        storage.clear();
        expect(storage.getJoin()).to.equal(undefined);
    });

    it("a second clear is harmless and the join stays absent", () => {
        const storage = new ForceJoinStorage();
        storage.startJoin(3, 500);

        storage.clear();
        storage.clear();

        expect(storage.getJoin()).to.equal(undefined);
    });

    it("an update for an earlier submission id returns false and leaves the newer join unchanged", () => {
        const storage = new ForceJoinStorage();
        const earlier = storage.startJoin(3, 500);
        const later = storage.startJoin(4, 900);
        const before = { ...later };

        expect(later.id).to.not.equal(earlier.id);
        expect(
            storage.updateJoin(earlier.id, {
                countingStartsAt: 60,
                isDisputeStarted: true
            })
        ).to.equal(false);
        expect(storage.getJoin()).to.deep.equal(before);
    });
});
