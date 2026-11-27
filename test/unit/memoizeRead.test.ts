import { memoizeRead } from "@/utils/memoizeRead";
import { expect } from "chai";

describe("Unit: memoizeRead", function () {
    it("two calls before the read settles -> one read, both get its value", async function () {
        let reads = 0;
        const read = memoizeRead(async () => {
            reads += 1;
            return 7;
        });

        const [first, second] = await Promise.all([read(), read()]);

        expect([first, second]).to.deep.equal([7, 7]);
        expect(reads).to.equal(1);
    });

    it("a call after the read resolved -> the stored value, no new read", async function () {
        let reads = 0;
        const read = memoizeRead(async () => {
            reads += 1;
            return reads * 10;
        });
        await read();

        const later = await read();

        expect(later).to.equal(10);
        expect(reads).to.equal(1);
    });

    it("a read that rejects -> the caller gets the error, and the next call reads again", async function () {
        let reads = 0;
        const read = memoizeRead(async () => {
            reads += 1;
            if (reads === 1) throw new Error("chain read failed");
            return 5;
        });

        const failure = await read().then(
            () => undefined,
            (error: Error) => error.message
        );
        const retried = await read();

        expect(failure).to.equal("chain read failed");
        expect(retried).to.equal(5);
        expect(reads).to.equal(2);
    });

    it("two calls on a read that rejects -> both get the error from one read", async function () {
        let reads = 0;
        const read = memoizeRead(async () => {
            reads += 1;
            throw new Error("chain read failed");
        });

        const outcomes = await Promise.allSettled([read(), read()]);

        expect(outcomes.map((outcome) => outcome.status)).to.deep.equal([
            "rejected",
            "rejected"
        ]);
        expect(reads).to.equal(1);
    });
});
