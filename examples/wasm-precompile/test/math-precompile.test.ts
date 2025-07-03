import { expect } from "chai";
import { createEVM } from "../src/evm/create";
import {
    CALCULATOR_PRECOMPILE_ADDRESS,
    createCalculatorPrecompile
} from "../src/precompiles/calculator-precompile";
import { randomInt } from "crypto";
import { EVM } from "@ethereumjs/evm";

const selector = {
    add: 0,
    multiply: 1,
    divide: 2
};

describe("Math Precompile", () => {
    let evm: EVM;

    before(async () => {
        const calculatorPrecompile = await createCalculatorPrecompile();
        evm = await createEVM([calculatorPrecompile]);
    });

    function createInputData(
        selector: number,
        a: number,
        b: number
    ): Uint8Array {
        const buffer = new ArrayBuffer(96);
        const view = new DataView(buffer);

        // Write values in big-endian format at the end of each 32-byte chunk
        view.setInt32(28, selector); // bytes 28-31
        view.setInt32(60, a); // bytes 60-63
        view.setInt32(92, b); // bytes 92-95

        return new Uint8Array(buffer);
    }

    function readResult(returnValue: Uint8Array): number {
        const view = new DataView(returnValue.buffer);
        return view.getInt32(28); // Read 4 bytes starting at position 28
    }

    describe("Addition", () => {
        it("should add two numbers correctly", async () => {
            const a = randomInt(0, 4096);
            const b = randomInt(0, 4096);
            const expectedSum = a + b;

            const inputData = createInputData(selector.add, a, b);

            const {
                execResult: { returnValue }
            } = await evm.runCall({
                to: CALCULATOR_PRECOMPILE_ADDRESS,
                data: inputData
            });

            expect(readResult(returnValue)).to.equal(expectedSum);
        });

        it("should handle specific case: 2472", async () => {
            const a = 2472;
            const b = 1000;
            const expectedSum = 3472;

            const inputData = createInputData(selector.add, a, b);

            const {
                execResult: { returnValue }
            } = await evm.runCall({
                to: CALCULATOR_PRECOMPILE_ADDRESS,
                data: inputData
            });

            expect(readResult(returnValue)).to.equal(expectedSum);
        });
    });

    describe("Multiplication", () => {
        it("should multiply two numbers correctly", async () => {
            const a = randomInt(0, 100);
            const b = randomInt(0, 100);
            const expectedProduct = a * b;

            const inputData = createInputData(selector.multiply, a, b);

            const {
                execResult: { returnValue }
            } = await evm.runCall({
                to: CALCULATOR_PRECOMPILE_ADDRESS,
                data: inputData
            });

            expect(readResult(returnValue)).to.equal(expectedProduct);
        });
    });

    describe("Division", () => {
        it("should divide two numbers correctly", async () => {
            const a = randomInt(1, 1000);
            const b = randomInt(1, 10);
            const expectedQuotient = Math.floor(a / b);

            const inputData = createInputData(selector.divide, a, b);

            const {
                execResult: { returnValue }
            } = await evm.runCall({
                to: CALCULATOR_PRECOMPILE_ADDRESS,
                data: inputData
            });

            expect(readResult(returnValue)).to.equal(expectedQuotient);
        });

        it("should handle division by zero", async () => {
            const inputData = createInputData(selector.divide, 42, 0);

            const {
                execResult: { returnValue }
            } = await evm.runCall({
                to: CALCULATOR_PRECOMPILE_ADDRESS,
                data: inputData
            });

            expect(readResult(returnValue)).to.equal(0);
        });
    });

    describe("Error cases", () => {
        it("should return zero for invalid function selector", async () => {
            const inputData = createInputData(99, 1, 1);

            const {
                execResult: { returnValue }
            } = await evm.runCall({
                to: CALCULATOR_PRECOMPILE_ADDRESS,
                data: inputData
            });

            expect(readResult(returnValue)).to.equal(0);
        });

        it("should return zero for invalid input length", async () => {
            const invalidData = new Uint8Array(50); // Less than 96 bytes

            const {
                execResult: { returnValue }
            } = await evm.runCall({
                to: CALCULATOR_PRECOMPILE_ADDRESS,
                data: invalidData
            });

            expect(readResult(returnValue)).to.equal(0);
        });
    });
});
