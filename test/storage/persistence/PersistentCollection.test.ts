import { PersistentCollection } from "@/storage/persistence";
import { expect } from "chai";

describe("PersistentCollection", function () {
    it("keeps map semantics without a disk: set, overwrite, delete and iteration order", () => {
        const collection = new PersistentCollection<
            string,
            "stateMachineStates"
        >("stateMachineStates");
        collection.set("a", "0x01");
        collection.set("b", "0x02");
        collection.set("c", "0x03");
        // an overwrite keeps the key's place, a delete then set moves it last
        collection.set("a", "0x0a");
        collection.delete("b");
        collection.set("b", "0x0b");

        expect([...collection.entries()]).to.deep.equal([
            ["a", "0x0a"],
            ["c", "0x03"],
            ["b", "0x0b"]
        ]);
        expect(collection.size).to.equal(3);
        expect(collection.has("c")).to.equal(true);
        expect(collection.delete("missing")).to.equal(false);
    });

    it("deletes the key when an update returns nothing", () => {
        const collection = new PersistentCollection<
            string,
            "stateMachineStates"
        >("stateMachineStates");
        collection.set("a", "0x01");

        expect(collection.update("a", (value) => `${value}02`)).to.equal(
            "0x0102"
        );
        expect(collection.update("a", () => undefined)).to.equal(undefined);
        expect(collection.has("a")).to.equal(false);
        expect(collection.update("b", (value) => value)).to.equal(undefined);
        expect(collection.size).to.equal(0);
    });

    it("holds values by reference", () => {
        const collection = new PersistentCollection<
            string,
            "participantSetChanges"
        >("participantSetChanges");
        const heights = new Set([1]);
        collection.set("fork", heights);
        heights.add(2);

        expect([...collection.get("fork")!]).to.deep.equal([1, 2]);
    });
});
