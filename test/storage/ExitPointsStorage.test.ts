import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ExitPointsStorage } from "@/storage/ExitPointsStorage";
import { BlockHeight, ForkId } from "@/types/types";

describe("ExitPointsStorage", () => {
    let storage: ExitPointsStorage;
    let forkId1: ForkId;
    let forkId2: ForkId;

    beforeEach(() => {
        storage = new ExitPointsStorage();
        forkId1 = "fork-1";
        forkId2 = "fork-2";
    });

    describe("CREATE - storeExitPoint()", () => {
        it("should store exit point and return the set", () => {
            const blockHeight: BlockHeight = 100;
            const result = storage.storeExitPoint(forkId1, blockHeight);

            expect(result).to.be.instanceof(Set);
            expect(result.has(blockHeight)).to.be.true;
            expect(result.size).to.equal(1);
        });

        it("should insert across different forks", () => {
            const height1: BlockHeight = 100;
            const height2: BlockHeight = 200;

            const result1 = storage.storeExitPoint(forkId1, height1);
            const result2 = storage.storeExitPoint(forkId2, height2);

            expect(result1.has(height1)).to.be.true;
            expect(result1.has(height2)).to.be.false;
            expect(result2.has(height2)).to.be.true;
            expect(result2.has(height1)).to.be.false;
        });

        it("should handle duplicate insertions", () => {
            const blockHeight: BlockHeight = 100;

            const result1 = storage.storeExitPoint(forkId1, blockHeight);
            const result2 = storage.storeExitPoint(forkId1, blockHeight);

            expect(result1.size).to.equal(1);
            expect(result2.size).to.equal(1);
            expect(result1).to.equal(result2); // Same Set reference
            expect(result1.has(blockHeight)).to.be.true;
        });

        it("should add multiple exit points to same fork", () => {
            const heights = [100, 200, 300];

            heights.forEach((height) => {
                storage.storeExitPoint(forkId1, height);
            });

            const result = storage.storeExitPoint(forkId1, 400);
            expect(result.size).to.equal(4);
            heights.forEach((height) => {
                expect(result.has(height)).to.be.true;
            });
            expect(result.has(400)).to.be.true;
        });
    });

    describe("READ - getExitPointsInRange()", () => {
        beforeEach(() => {
            // fork1 has heights [100, 200, 300, 400, 500]
            [100, 200, 300, 400, 500].forEach((height) => {
                storage.storeExitPoint(forkId1, height);
            });
            // fork2 has heights [150, 250]
            [150, 250].forEach((height) => {
                storage.storeExitPoint(forkId2, height);
            });
        });

        describe("Non-existent fork", () => {
            it("should return empty array for non-existent fork id", () => {
                const result =
                    storage.getExitPointsInRange("non-existent-fork");
                expect(result).to.deep.equal([]);
            });
        });

        describe("Get all exit points", () => {
            it("should get all when both start and end are undefined", () => {
                const result = storage.getExitPointsInRange(forkId1);
                expect(result).to.have.lengthOf(5);
                expect(result).to.include.members([100, 200, 300, 400, 500]);
            });

            it("should return sorted results when getting all", () => {
                // Insert in random order to test sorting
                const newFork = "unsorted-fork";
                [300, 100, 500, 200, 400].forEach((height) => {
                    storage.storeExitPoint(newFork, height);
                });

                const result = storage.getExitPointsInRange(newFork);
                expect(result).to.deep.equal([100, 200, 300, 400, 500]);
            });
        });

        describe("Range queries with start undefined", () => {
            it("should get all from beginning when start is undefined", () => {
                const result = storage.getExitPointsInRange(
                    forkId1,
                    undefined,
                    350
                );
                expect(result).to.deep.equal([100, 200, 300]);
            });

            it("should get single element when start undefined and end is just after first", () => {
                const result = storage.getExitPointsInRange(
                    forkId1,
                    undefined,
                    101
                );
                expect(result).to.deep.equal([100]);
            });
        });

        describe("Range queries with end undefined", () => {
            it("should get all from start to end when end is undefined", () => {
                const result = storage.getExitPointsInRange(forkId1, 250);
                expect(result).to.deep.equal([300, 400, 500]);
            });

            it("should get all from exact match when end undefined", () => {
                const result = storage.getExitPointsInRange(forkId1, 300);
                expect(result).to.deep.equal([300, 400, 500]);
            });
        });

        describe("Invalid range scenarios", () => {
            it("should return empty array when end <= start", () => {
                const result1 = storage.getExitPointsInRange(forkId1, 300, 300);
                expect(result1).to.deep.equal([]);

                const result2 = storage.getExitPointsInRange(forkId1, 400, 300);
                expect(result2).to.deep.equal([]);
            });
        });

        describe("Range boundaries", () => {
            it("should handle start < actual smallest block height", () => {
                const result = storage.getExitPointsInRange(forkId1, 50, 250);
                expect(result).to.deep.equal([100, 200]);
            });

            it("should handle end > actual largest block height", () => {
                const result = storage.getExitPointsInRange(forkId1, 350, 1000);
                expect(result).to.deep.equal([400, 500]);
            });

            it("should handle both start and end outside actual range", () => {
                const result1 = storage.getExitPointsInRange(forkId1, 50, 80);
                expect(result1).to.deep.equal([]);

                const result2 = storage.getExitPointsInRange(forkId1, 600, 700);
                expect(result2).to.deep.equal([]);
            });
        });

        describe("Range inclusivity/exclusivity", () => {
            it("should be inclusive of start and inclusive of end", () => {
                // Range [200, 400] should include 200, 300 and 400
                const result = storage.getExitPointsInRange(forkId1, 200, 400);
                expect(result).to.deep.equal([200, 300, 400]);
            });

            it("should include exact start value", () => {
                const result = storage.getExitPointsInRange(forkId1, 300, 450);
                expect(result).to.include(300);
                expect(result).to.deep.equal([300, 400]);
            });

            it("should exclude exact end value", () => {
                const result = storage.getExitPointsInRange(forkId1, 200, 300);
                expect(result).to.deep.equal([200, 300]);
            });

            it("should work with single-element ranges", () => {
                const result = storage.getExitPointsInRange(forkId1, 300, 301);
                expect(result).to.deep.equal([300]);
            });

            it("should return empty for gap ranges", () => {
                const result = storage.getExitPointsInRange(forkId1, 350, 380);
                expect(result).to.deep.equal([]);
            });
        });
    });
});
