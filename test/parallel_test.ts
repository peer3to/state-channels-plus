import { expect } from "chai";

describe("Parallel vs Serial Test Execution", function () {
    this.timeout(10000); // 10 second timeout

    it("test 1 - should sleep for 3 seconds", async function () {
        console.log("test 1 start - " + new Date().toISOString());

        // Sleep for 3 seconds to simulate async work
        await new Promise((resolve) => setTimeout(resolve, 3000));

        console.log("test 1 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });

    it("test 2 - should execute immediately", async function () {
        console.log("test 2 start - " + new Date().toISOString());

        // No sleep, just immediate execution
        console.log("test 2 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });

    it("test 3 - should sleep for 2 seconds", async function () {
        console.log("test 3 start - " + new Date().toISOString());

        // Sleep for 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log("test 3 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });

    it("test 4 - should execute immediately", async function () {
        console.log("test 4 start - " + new Date().toISOString());

        // No sleep, just immediate execution
        console.log("test 4 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });
});

describe("Additional Parallel Test Suite", function () {
    this.timeout(10000);

    it("parallel suite test 1 - should sleep for 1 second", async function () {
        console.log(
            "parallel suite test 1 start - " + new Date().toISOString()
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));

        console.log("parallel suite test 1 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });

    it("parallel suite test 2 - should execute immediately", async function () {
        console.log(
            "parallel suite test 2 start - " + new Date().toISOString()
        );

        console.log("parallel suite test 2 end - " + new Date().toISOString());
        expect(true).to.be.true;
    });
});
