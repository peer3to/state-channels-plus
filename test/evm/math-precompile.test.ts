import { expect } from "chai";
import { CustomEVM } from "@/evm/CustomEVM";
import { MATH_PRECOMPILE_ADDRESS } from "@/evm/precompiles";
import { toBeHex } from "ethers";
import { randomInt } from "crypto";

const selector = {
    add: 0,
    multiply: 1,
    divide: 2
};

describe("Math Precompile", () => {
    let evm: CustomEVM;

    before(async () => {
        evm = await CustomEVM.create();
    });

    function createInputData(selector: number, a: number, b: number): string {
        const selectorBytes = toBeHex(selector, 32);
        const aBytes = toBeHex(a, 32);
        const bBytes = toBeHex(b, 32);
        return selectorBytes.slice(2) + aBytes.slice(2) + bBytes.slice(2);
    }

    describe("Addition", () => {
        it("should add two numbers correctly", async () => {
            const a = randomInt(0, 4096);
            const b = randomInt(0, 4096);
            const expectedSum = a + b;

            const inputData = createInputData(selector.add, a, b);

            const {
                execResult: { exceptionError, returnValue }
            } = await evm.runCall({
                to: MATH_PRECOMPILE_ADDRESS,
                data: Buffer.from(inputData, "hex")
            });

            expect(exceptionError).to.be.undefined;
            const result = Buffer.from(returnValue).readUInt32BE(28);
            expect(result).to.equal(expectedSum);
        });
    });

    describe("Multiplication", () => {
        it("should multiply two numbers correctly", async () => {
            const a = randomInt(0, 100);
            const b = randomInt(0, 100);
            const expectedProduct = a * b;

            const inputData = createInputData(selector.multiply, a, b);

            const {
                execResult: { exceptionError, returnValue }
            } = await evm.runCall({
                to: MATH_PRECOMPILE_ADDRESS,
                data: Buffer.from(inputData, "hex")
            });

            expect(exceptionError).to.be.undefined;
            const result = Buffer.from(returnValue).readUInt32BE(28);
            expect(result).to.equal(expectedProduct);
        });
    });

    describe("Division", () => {
        it("should divide two numbers correctly", async () => {
            const a = randomInt(1, 1000);
            const b = randomInt(1, 10);
            const expectedQuotient = Math.floor(a / b);

            const inputData = createInputData(selector.divide, a, b);

            const {
                execResult: { exceptionError, returnValue }
            } = await evm.runCall({
                to: MATH_PRECOMPILE_ADDRESS,
                data: Buffer.from(inputData, "hex")
            });

            expect(exceptionError).to.be.undefined;
            const result = Buffer.from(returnValue).readUInt32BE(28);
            expect(result).to.equal(expectedQuotient);
        });

        it("should handle division by zero", async () => {
            const inputData = createInputData(selector.divide, 42, 0);
            const expected_result = 0;

            const { execResult } = await evm.runCall({
                to: MATH_PRECOMPILE_ADDRESS,
                data: Buffer.from(inputData, "hex")
            });

            expect(execResult.exceptionError).to.be.undefined;
            const result = Buffer.from(execResult.returnValue).readUInt32BE(28);
            expect(result).to.equal(expected_result);
        });
    });

    it("should reject invalid function selector", async () => {
        const inputData = createInputData(99, 1, 1);

        await expect(
            evm.runCall({
                to: MATH_PRECOMPILE_ADDRESS,
                data: Buffer.from(inputData, "hex")
            })
        ).to.be.rejectedWith(Error, "Invalid function selector");
    });

    it("should reject invalid input length", async () => {
        const invalidData = "1234567890";

        await expect(
            evm.runCall({
                to: MATH_PRECOMPILE_ADDRESS,
                data: Buffer.from(invalidData, "hex")
            })
        ).to.be.rejectedWith(Error, "Invalid input length");
    });
});
