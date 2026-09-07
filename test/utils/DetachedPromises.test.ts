import { DetachedPromises } from "@/utils/DetachedPromises";
import { expect } from "chai";

describe("DetachedPromises.observe", function () {
    it("collects fulfilled work without calling the error route", async function () {
        let routed = false;
        DetachedPromises.observe(Promise.resolve(7), () => {
            routed = true;
        });
        const results = await DetachedPromises.awaitAllAndClear();
        expect(results).to.deep.equal([{ status: "fulfilled", value: 7 }]);
        expect(routed).to.equal(false);
    });

    it("routes the original rejection once and preserves it in the drain", async function () {
        const failure = new Error("observed operation failed");
        const routed: unknown[] = [];
        DetachedPromises.observe(Promise.reject(failure), (error) => {
            routed.push(error);
        });
        const results = await DetachedPromises.awaitAllAndClear();
        expect(routed.length).to.equal(1);
        expect(routed[0]).to.equal(failure);
        expect(results.length).to.equal(1);
        expect(results[0].status).to.equal("rejected");
        if (results[0].status === "rejected")
            expect(results[0].reason).to.equal(failure);
        expect(DetachedPromises.size()).to.equal(0);
    });
});
