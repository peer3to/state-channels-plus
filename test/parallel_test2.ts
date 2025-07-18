import { expect } from "chai";

describe("Second Parallel Test File - Suite A", function () {
    this.timeout(10000);

    it("file2 test 1 - should sleep for 2.5 seconds", async function () {
        console.log("file2 test 1 start - " + new Date().toISOString());

        // Sleep for 2.5 seconds
        await new Promise((resolve) => setTimeout(resolve, 2500));

        console.log("file2 test 1 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });

    it("file2 test 2 - should execute immediately", async function () {
        console.log("file2 test 2 start - " + new Date().toISOString());

        console.log("file2 test 2 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });

    it("file2 test 3 - should sleep for 1.5 seconds", async function () {
        console.log("file2 test 3 start - " + new Date().toISOString());

        await new Promise((resolve) => setTimeout(resolve, 1500));

        console.log("file2 test 3 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });
});

describe("Second Parallel Test File - Suite B", function () {
    this.timeout(10000);

    it("file2 suite B test 1 - should sleep for 0.5 seconds", async function () {
        console.log("file2 suite B test 1 start - " + new Date().toISOString());

        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log("file2 suite B test 1 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });

    it("file2 suite B test 2 - should execute immediately", async function () {
        console.log("file2 suite B test 2 start - " + new Date().toISOString());

        console.log("file2 suite B test 2 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });
});
