import { expect } from "chai";
import { createEVM } from "@/evm";
import { ADD_PRECOMPILE_ADDRESS, createAddPrecompile } from "@/evm/precompiles";
import { toBeHex } from "ethers";
import { randomInt } from "crypto";
import { EVM } from "@ethereumjs/evm";

describe("Add Precompile", () => {
    let evm: EVM;

    before(async () => {
        const addPrecompile = await createAddPrecompile();
        evm = await createEVM([addPrecompile]);
    });

    it("should add two numbers correctly", async () => {
        const a = randomInt(0, 4096);
        const b = randomInt(0, 4096);
        const expectedSum = a + b;

        const aBytes = toBeHex(a, 32);
        const bBytes = toBeHex(b, 32);
        const inputData = aBytes.slice(2) + bBytes.slice(2);

        const {
            execResult: { exceptionError, returnValue }
        } = await evm.runCall({
            to: ADD_PRECOMPILE_ADDRESS,
            data: Buffer.from(inputData, "hex")
        });

        expect(exceptionError).to.be.undefined;

        // Convert result to number (it's left-aligned in 32 bytes)
        const sum = Buffer.from(returnValue).readUInt32BE(28); // Read last 4 bytes
        expect(sum).to.equal(expectedSum);
    });

    it("should handle zero values", async () => {
        const a = 0;
        const b = 0;

        const aBytes = toBeHex(a, 32);
        const bBytes = toBeHex(b, 32);
        const inputData = aBytes.slice(2) + bBytes.slice(2);

        const {
            execResult: { exceptionError, returnValue }
        } = await evm.runCall({
            to: ADD_PRECOMPILE_ADDRESS,
            data: Buffer.from(inputData, "hex")
        });

        expect(exceptionError).to.be.undefined;
        const sum = Buffer.from(returnValue).readUInt32BE(28);
        expect(sum).to.equal(0);
    });

    it("should handle maximum 32-bit values", async () => {
        const a = 0xffffffff;
        const b = 1;

        const aBytes = toBeHex(a, 32);
        const bBytes = toBeHex(b, 32);
        const inputData = aBytes.slice(2) + bBytes.slice(2);

        const {
            execResult: { exceptionError, returnValue }
        } = await evm.runCall({
            to: ADD_PRECOMPILE_ADDRESS,
            data: Buffer.from(inputData, "hex")
        });

        expect(exceptionError).to.be.undefined;
        const sum = Buffer.from(returnValue).readUInt32BE(28);
        expect(sum).to.equal(0);
    });

    it("should reject invalid input length", async () => {
        const invalidData = "1234567891bcde";

        await expect(
            evm.runCall({
                to: ADD_PRECOMPILE_ADDRESS,
                data: Buffer.from(invalidData, "hex")
            })
        ).to.be.rejectedWith("Invalid input length");
    });
});
